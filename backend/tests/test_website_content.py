"""Website page editor — texts, photos, section visibility and the shop's own sections."""
import html
import io
import os
import pathlib

import pytest
import requests
from PIL import Image

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"
SITE = pathlib.Path(__file__).resolve().parents[2] / 'website' / 'index.html'


@pytest.fixture(scope='module')
def admin():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "Admin@123"}, timeout=30)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _jpg():
    buf = io.BytesIO()
    Image.new('RGB', (900, 600), (180, 140, 60)).save(buf, 'JPEG')
    return buf.getvalue()


def test_defaults_match_the_site(admin):
    """Every editable default must still be on rmj.co.in, next to its id — otherwise an
    edit in the app would silently not show up (or 'reset' would change the wording)."""
    page = requests.get(f"{API}/website/content", headers=admin, timeout=30).json()['page']
    src = html.unescape(SITE.read_text(encoding='utf-8'))
    for sec in page:
        for f in sec['fields']:
            assert f['default'] in src, f"{f['key']} default is not in index.html"
            if f['key'].startswith('finder_'):
                continue  # finder copy lives in the FINDER script list
            assert f'data-cms="{f["key"]}"' in src, f"{f['key']} has no data-cms element"
        for i in sec['images']:
            path = i['default_url'].replace('https://rmj.co.in/', '')
            # finder photos are written as IMG + filename in the script
            assert (path.rsplit('/', 1)[1] if i['key'].startswith('finder_') else path) in src
            if not i['key'].startswith('finder_'):
                assert f'data-cms-img="{i["key"]}"' in src
        if sec['hideable']:
            assert f'data-cms-section="{sec["key"]}"' in src


def test_edit_and_reset_text(admin):
    r = requests.put(f"{API}/website/content/texts", headers=admin, json={'texts': {'about_title': 'Our family story.'}}, timeout=30)
    assert r.status_code == 200, r.text
    assert requests.get(f"{API}/public/website/content", timeout=30).json()['texts']['about_title'] == 'Our family story.'
    requests.put(f"{API}/website/content/texts", headers=admin, json={'texts': {'about_title': ''}}, timeout=30)
    assert 'about_title' not in requests.get(f"{API}/public/website/content", timeout=30).json()['texts']
    assert requests.put(f"{API}/website/content/texts", headers=admin, json={'texts': {'nope': 'x'}}, timeout=30).status_code == 400
    assert requests.put(f"{API}/website/content/texts", headers=admin, json={'texts': {'about_title': 'x' * 500}}, timeout=30).status_code == 400


def test_hide_section(admin):
    assert requests.put(f"{API}/website/content/sections/about/visible", headers=admin, json={'visible': False}, timeout=30).status_code == 200
    assert 'about' in requests.get(f"{API}/public/website/content", timeout=30).json()['hidden']
    requests.put(f"{API}/website/content/sections/about/visible", headers=admin, json={'visible': True}, timeout=30)
    assert requests.put(f"{API}/website/content/sections/visit/visible", headers=admin, json={'visible': False}, timeout=30).status_code == 400


def test_page_photo(admin):
    r = requests.post(f"{API}/website/content/images/about_photo", headers=admin, files={'file': ('a.jpg', _jpg(), 'image/jpeg')}, timeout=30)
    assert r.status_code == 200, r.text
    url = requests.get(f"{API}/public/website/content", timeout=30).json()['images']['about_photo']
    img = requests.get(f"{BASE_URL}{url}", timeout=30)
    assert img.status_code == 200 and img.headers['content-type'] == 'image/jpeg'
    assert requests.delete(f"{API}/website/content/images/about_photo", headers=admin, timeout=30).status_code == 200
    assert requests.get(f"{BASE_URL}{url}", timeout=30).status_code == 404


def test_own_section(admin):
    assert requests.post(f"{API}/website/sections", headers=admin, json={'title': ''}, timeout=30).status_code == 400
    s = requests.post(f"{API}/website/sections", headers=admin, json={'title': 'Bridal collection', 'text': 'Line one\nLine two'}, timeout=30).json()
    s = requests.post(f"{API}/website/sections/{s['id']}/photos", headers=admin, files={'file': ('p.jpg', _jpg(), 'image/jpeg')},
                      data={'caption': 'Polki set'}, timeout=30).json()
    assert len(s['photos']) == 1 and s['photos'][0]['caption'] == 'Polki set'
    pub = requests.get(f"{API}/public/website/content", timeout=30).json()['sections']
    assert any(x['title'] == 'Bridal collection' and x['photos'] for x in pub)
    requests.patch(f"{API}/website/sections/{s['id']}", headers=admin, json={'visible': False}, timeout=30)
    assert not any(x['id'] == s['id'] for x in requests.get(f"{API}/public/website/content", timeout=30).json()['sections'])
    photo_url = s['photos'][0]['url']
    assert requests.delete(f"{API}/website/sections/{s['id']}", headers=admin, timeout=30).status_code == 200
    assert requests.get(f"{BASE_URL}{photo_url}", timeout=30).status_code == 404


def test_staff_cannot_edit():
    r = requests.post(f"{API}/auth/employee-login", json={"username": "rmj001", "password": "1234"}, timeout=30)
    if r.status_code != 200:
        pytest.skip('employee login not available')
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert requests.get(f"{API}/website/content", headers=h, timeout=30).status_code == 403


def test_employee_with_website_module_can_edit():
    owner = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30).json()['access_token']}
    accounts = requests.get(f"{API}/access/accounts", headers=owner, timeout=30).json()
    emp = next(a for a in accounts if a.get('username') == 'rmj002')
    before = emp.get('module_access')
    r = requests.put(f"{API}/access/accounts/{emp['id']}", headers=owner,
                     json={'module_access': sorted(set(emp['resolved_modules']) | {'website'})}, timeout=30)
    assert r.status_code == 200, r.text
    try:
        tok = requests.post(f"{API}/auth/employee-login", json={"username": "rmj002", "password": "2345"}, timeout=30).json()['access_token']
        h = {"Authorization": f"Bearer {tok}"}
        assert requests.get(f"{API}/website/content", headers=h, timeout=30).status_code == 200
        assert requests.get(f"{API}/website/pieces", headers=h, timeout=30).status_code == 200
    finally:
        requests.put(f"{API}/access/accounts/{emp['id']}", headers=owner, json={'module_access': before}, timeout=30)


def test_logo_and_name_size_settings(admin):
    h = admin
    c = requests.get(f"{API}/website/content", headers=h, timeout=30).json()
    assert c['brand'] == {'logo': 100, 'name': 85} and c['brand_range'] == [60, 140]
    assert requests.put(f"{API}/website/content/brand", headers=h, json={'logo': 200, 'name': 90}, timeout=30).status_code == 400
    r = requests.put(f"{API}/website/content/brand", headers=h, json={'logo': 120, 'name': 70}, timeout=30)
    assert r.status_code == 200 and r.json()['brand'] == {'logo': 120, 'name': 70}
    assert requests.get(f"{API}/public/website/content", timeout=30).json()['brand'] == {'logo': 120, 'name': 70}
    requests.put(f"{API}/website/content/brand", headers=h, json={'logo': 100, 'name': 85}, timeout=30)
