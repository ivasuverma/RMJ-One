"""Employee ID proofs keep working when the IDs category is turned off in
Documents (it only hides it from the Documents screen)."""
import io
import os

import pytest
import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _ids_cat(h):
    return next((c for c in requests.get(f"{API}/document-categories?all=1", headers=h, timeout=30).json() if c['key'] == 'ids'), None)


def test_id_proof_with_ids_turned_off():
    h = _owner()
    emps = requests.get(f"{API}/employees", headers=h, timeout=30).json()
    cat = _ids_cat(h)
    if not emps or not cat:
        pytest.skip('no employee or IDs category')
    emp = emps[0]
    body = {k: cat.get(k) for k in ('label', 'icon', 'visible_to_roles', 'can_record_roles')}
    requests.put(f"{API}/document-categories/{cat['id']}", headers=h, json={**body, 'active': False}, timeout=30)
    try:
        # hidden from the Documents screen
        assert 'ids' not in [c['key'] for c in requests.get(f"{API}/document-categories", headers=h, timeout=30).json()]
        r = requests.post(f"{API}/documents", headers=h, data={'category_key': 'ids', 'note': 'PAN card'},
                          files={'file': ('pan.jpg', io.BytesIO(b'\xff\xd8\xff\xe0' + b'0' * 200), 'image/jpeg')}, timeout=30)
        assert r.status_code == 200, r.text
        did = r.json()['id']
        r = requests.patch(f"{API}/documents/{did}/record", headers=h, json={
            'linked_ref_type': 'employee', 'linked_ref_id': emp['id'], 'linked_ref_label': emp['name'], 'note': 'PAN card'}, timeout=30)
        assert r.status_code == 200, r.text
        items = requests.get(f"{API}/documents?category=ids&status=done&linked_ref_type=employee&linked_ref_id={emp['id']}",
                             headers=h, timeout=30).json()['items']
        assert did in [d['id'] for d in items]
        assert requests.get(f"{API}/documents/{did}/file?full=1", headers=h, timeout=30).status_code == 200
        requests.delete(f"{API}/documents/{did}", headers=h, timeout=30)
    finally:
        requests.put(f"{API}/document-categories/{cat['id']}", headers=h, json={**body, 'active': cat.get('active', True)}, timeout=30)
