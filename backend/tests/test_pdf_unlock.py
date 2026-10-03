"""Password-protected PDFs (bank statements): the app asks for the password and
the server removes it, before upload or for one already saved."""
import io
import os

import requests
from reportlab.lib import pdfencrypt
from reportlab.pdfgen import canvas

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _locked_pdf(password='1234') -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, encrypt=pdfencrypt.StandardEncryption(password, canPrint=1))
    c.drawString(72, 760, 'Statement of account')
    c.showPage()
    c.save()
    return buf.getvalue()


def test_unlock_before_upload():
    h = _owner()
    raw = _locked_pdf()
    bad = requests.post(f"{API}/documents/unlock-pdf", headers=h, data={'password': 'nope'},
                        files={'file': ('s.pdf', io.BytesIO(raw), 'application/pdf')}, timeout=30)
    assert bad.status_code == 400 and 'password' in bad.json()['detail'].lower()
    ok = requests.post(f"{API}/documents/unlock-pdf", headers=h, data={'password': '1234', 'remember': 'false'},
                       files={'file': ('s.pdf', io.BytesIO(raw), 'application/pdf')}, timeout=30)
    assert ok.status_code == 200 and ok.headers['content-type'] == 'application/pdf'
    assert ok.content.startswith(b'%PDF') and b'/Encrypt' not in ok.content


def test_unlock_saved_document():
    h = _owner()
    pw = 'Doc' + os.urandom(3).hex()   # one no saved password matches, so it stays locked on upload
    cats = [c['key'] for c in requests.get(f"{API}/document-categories", headers=h, timeout=30).json()]
    r = requests.post(f"{API}/documents", headers=h, data={'category_key': cats[0], 'note': 'Locked statement test'},
                      files={'file': ('s.pdf', io.BytesIO(_locked_pdf(pw)), 'application/pdf')}, timeout=30)
    assert r.status_code == 200, r.text
    did = r.json()['id']
    try:
        assert requests.get(f"{API}/documents/{did}/pages", headers=h, timeout=30).json()['locked'] is True
        assert requests.post(f"{API}/documents/{did}/unlock", headers=h, json={'password': 'x'}, timeout=30).status_code == 400
        u = requests.post(f"{API}/documents/{did}/unlock", headers=h, json={'password': pw, 'remember': False}, timeout=30)
        assert u.status_code == 200, u.text
        pages = requests.get(f"{API}/documents/{did}/pages", headers=h, timeout=30).json()
        assert pages['pages'] == 1 and pages['locked'] is False
        assert b'/Encrypt' not in requests.get(f"{API}/documents/{did}/file?original=1", headers=h, timeout=30).content
    finally:
        requests.delete(f"{API}/documents/{did}", headers=h, timeout=30)


def _saved(h):
    return requests.get(f"{API}/pdf-passwords", headers=h, timeout=30).json()


def test_password_remembered_and_owner_only():
    h = _owner()
    pw = 'Rmj' + os.urandom(3).hex()
    raw = _locked_pdf(pw)
    files = lambda: {'file': ('s.pdf', io.BytesIO(raw), 'application/pdf')}   # noqa: E731
    before = {r['id'] for r in _saved(h)}
    try:
        # unknown yet: needs the password
        assert requests.post(f"{API}/documents/unlock-pdf", headers=h, files=files(), timeout=30).status_code == 423
        # typed once (remember is on by default) ...
        assert requests.post(f"{API}/documents/unlock-pdf", headers=h, data={'password': pw}, files=files(), timeout=30).status_code == 200
        mine = [r for r in _saved(h) if r['password'] == pw]
        assert len(mine) == 1
        # ... then it unlocks with no password
        again = requests.post(f"{API}/documents/unlock-pdf", headers=h, files=files(), timeout=30)
        assert again.status_code == 200 and again.headers.get('x-unlocked-with') == 'saved'
        # staff can't read the list
        a = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "Admin@123"}, timeout=30)
        if a.status_code == 200:
            ah = {"Authorization": f"Bearer {a.json()['access_token']}"}
            assert requests.get(f"{API}/pdf-passwords", headers=ah, timeout=30).status_code == 403
    finally:
        for r in _saved(h):
            if r['id'] not in before:
                requests.delete(f"{API}/pdf-passwords/{r['id']}", headers=h, timeout=30)


def test_many_pages_at_once_dont_crash():
    """PDFium isn't thread-safe: a PDF's pages are requested together, and
    overlapping calls used to crash the whole server."""
    from concurrent.futures import ThreadPoolExecutor
    h = _owner()
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for i in range(6):
        c.drawString(72, 760, f'Page {i + 1}')
        c.showPage()
    c.save()
    cats = [c['key'] for c in requests.get(f"{API}/document-categories", headers=h, timeout=30).json()]
    did = requests.post(f"{API}/documents", headers=h, data={'category_key': cats[0], 'note': 'Concurrency test'},
                        files={'file': ('p.pdf', io.BytesIO(buf.getvalue()), 'application/pdf')}, timeout=30).json()['id']
    try:
        with ThreadPoolExecutor(12) as ex:
            codes = list(ex.map(lambda i: requests.get(f"{API}/documents/{did}/file?page={i % 6}", headers=h, timeout=60).status_code, range(36)))
        assert codes.count(200) == 36
        assert requests.get(f"{API}/", timeout=30).status_code == 200
    finally:
        requests.delete(f"{API}/documents/{did}", headers=h, timeout=30)
