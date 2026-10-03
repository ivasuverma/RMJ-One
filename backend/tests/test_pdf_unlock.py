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
    ok = requests.post(f"{API}/documents/unlock-pdf", headers=h, data={'password': '1234'},
                       files={'file': ('s.pdf', io.BytesIO(raw), 'application/pdf')}, timeout=30)
    assert ok.status_code == 200 and ok.headers['content-type'] == 'application/pdf'
    assert ok.content.startswith(b'%PDF') and b'/Encrypt' not in ok.content


def test_unlock_saved_document():
    h = _owner()
    cats = [c['key'] for c in requests.get(f"{API}/document-categories", headers=h, timeout=30).json()]
    r = requests.post(f"{API}/documents", headers=h, data={'category_key': cats[0], 'note': 'Locked statement test'},
                      files={'file': ('s.pdf', io.BytesIO(_locked_pdf()), 'application/pdf')}, timeout=30)
    assert r.status_code == 200, r.text
    did = r.json()['id']
    try:
        assert requests.get(f"{API}/documents/{did}/pages", headers=h, timeout=30).json()['locked'] is True
        assert requests.post(f"{API}/documents/{did}/unlock", headers=h, json={'password': 'x'}, timeout=30).status_code == 400
        u = requests.post(f"{API}/documents/{did}/unlock", headers=h, json={'password': '1234'}, timeout=30)
        assert u.status_code == 200, u.text
        pages = requests.get(f"{API}/documents/{did}/pages", headers=h, timeout=30).json()
        assert pages['pages'] == 1 and pages['locked'] is False
        assert b'/Encrypt' not in requests.get(f"{API}/documents/{did}/file?original=1", headers=h, timeout=30).content
    finally:
        requests.delete(f"{API}/documents/{did}", headers=h, timeout=30)
