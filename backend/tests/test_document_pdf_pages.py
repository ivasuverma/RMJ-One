"""PDF documents show on screen: the server counts the pages and draws each
one (and the grid thumbnail) as a JPEG."""
import io
import os

import requests
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _pdf(pages: int) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    for i in range(pages):
        c.drawString(72, 760, f'Page {i + 1}')
        c.showPage()
    c.save()
    return buf.getvalue()


def test_pdf_pages_and_thumbnail():
    h = _owner()
    cats = [c['key'] for c in requests.get(f"{API}/document-categories", headers=h, timeout=30).json()]
    r = requests.post(f"{API}/documents", headers=h, data={'category_key': cats[0], 'note': 'PDF pages test'},
                      files={'file': ('bill.pdf', io.BytesIO(_pdf(3)), 'application/pdf')}, timeout=30)
    assert r.status_code == 200, r.text
    did = r.json()['id']
    try:
        assert requests.get(f"{API}/documents/{did}/pages", headers=h, timeout=30).json()['pages'] == 3
        for q in ('thumb=1', 'page=0', 'page=2'):
            f = requests.get(f"{API}/documents/{did}/file?{q}", headers=h, timeout=60)
            assert f.status_code == 200 and f.headers['content-type'] == 'image/jpeg', q
            assert f.content[:2] == b'\xff\xd8'
        assert requests.get(f"{API}/documents/{did}/file?page=3", headers=h, timeout=30).status_code == 404
        # the whole file is still served as the PDF
        assert requests.get(f"{API}/documents/{did}/file?full=1", headers=h, timeout=30).headers['content-type'] == 'application/pdf'
    finally:
        requests.delete(f"{API}/documents/{did}", headers=h, timeout=30)
