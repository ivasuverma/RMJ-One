"""Documents: the OS button's Customer Outstanding folder (record + file a slip
there), select-and-delete, and the owner-only "delete older than N months"."""
import io
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _png() -> bytes:
    from PIL import Image
    b = io.BytesIO()
    Image.new('RGB', (40, 30), (200, 180, 120)).save(b, 'PNG')
    return b.getvalue()


def test_outstanding_folder_move_and_purge():
    owner = _login('owner', 'Owner@123')
    label = f'Test Slips {os.urandom(3).hex()}'
    cat = requests.post(f"{API}/document-categories", headers=owner, timeout=30,
                        json={'label': label, 'visible_to_roles': ['owner', 'admin'], 'can_record_roles': ['owner', 'admin']}).json()
    key = cat['key']
    os1 = requests.post(f"{API}/document-categories/outstanding", headers=owner, json={'from_key': key}, timeout=30).json()
    os2 = requests.post(f"{API}/document-categories/outstanding", headers=owner, json={'from_key': key}, timeout=30).json()
    assert os1 == os2 and 'outstanding' in (os1['key'] + os1['label']).lower()     # found or made once, then reused
    cid = f'test-os-{os.urandom(4).hex()}'
    d = requests.post(f"{API}/documents", headers=owner, timeout=60, files={'file': ('slip.png', _png(), 'image/png')},
                      data={'category_key': key, 'note': 'slip', 'client_id': cid}).json()
    try:
        assert requests.patch(f"{API}/documents/{d['id']}/record", headers=owner, json={'note': 'Anita', 'linked_ref_label': 'Anita'}, timeout=30).status_code == 200
        moved = requests.patch(f"{API}/documents/{d['id']}/category", headers=owner, json={'category_key': os1['key']}, timeout=30).json()
        assert moved['category_key'] == os1['key'] and moved['status'] == 'done'
        # purge: owner only; nothing in a folder is older than a month yet, so nothing goes
        admin = _login('admin', 'Admin@123')
        assert requests.get(f"{API}/documents/purge-preview", headers=admin, params={'category_key': key, 'months': 1}, timeout=30).status_code == 403
        assert requests.post(f"{API}/documents/purge", headers=admin, json={'category_key': key, 'months': 1}, timeout=30).status_code == 403
        pv = requests.get(f"{API}/documents/purge-preview", headers=owner, params={'category_key': os1['key'], 'months': 1}, timeout=30).json()
        assert pv['count'] >= 0 and len(pv['before']) == 10
        r = requests.post(f"{API}/documents/purge", headers=owner, json={'category_key': os1['key'], 'months': 1}, timeout=60).json()
        assert r['ok'] is True
        assert requests.get(f"{API}/documents/{d['id']}/file", headers=owner, timeout=30).status_code == 200   # a new one stays
        assert requests.post(f"{API}/documents/purge", headers=owner, json={'category_key': key, 'months': 0}, timeout=30).status_code == 422
        # select and delete: owner/admin only, gone everywhere
        acc = _login('accountant', 'Accountant@123')
        assert requests.post(f"{API}/documents/delete-many", headers=acc, json={'ids': [d['id']]}, timeout=30).status_code == 403
        r = requests.post(f"{API}/documents/delete-many", headers=admin, json={'ids': [d['id'], d['id'], 'nope']}, timeout=60).json()
        assert r['deleted'] == 1
        assert requests.get(f"{API}/documents/{d['id']}/file", headers=owner, timeout=30).status_code == 404
    finally:
        requests.delete(f"{API}/documents/{d['id']}", headers=owner, timeout=30)
        requests.delete(f"{API}/document-categories/{cat['id']}", headers=owner, timeout=30)


def test_list_from_to_dates():
    owner = _login('owner', 'Owner@123')
    from datetime import date, timedelta
    today = date.today()
    far = (today - timedelta(days=4000)).isoformat()
    r = requests.get(f"{API}/documents", headers=owner, params={'status': 'done', 'from_date': far, 'to_date': far}, timeout=30)
    assert r.status_code == 200 and r.json()['items'] == []
    r = requests.get(f"{API}/documents", headers=owner, params={'from_date': far, 'to_date': (today + timedelta(days=1)).isoformat()}, timeout=30)
    assert r.status_code == 200
    assert requests.get(f"{API}/documents", headers=owner, params={'from_date': '04-10-2026'}, timeout=30).status_code == 422
