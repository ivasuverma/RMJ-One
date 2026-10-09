"""A staff (accountant-type) login given Stock In/Out can attach sample photos;
without the module it still can't."""
import io
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _jpg() -> bytes:
    from PIL import Image
    b = io.BytesIO()
    Image.new('RGB', (40, 30), (180, 160, 120)).save(b, 'JPEG')
    return b.getvalue()


def test_accountant_with_samples_can_add_sample_photo():
    owner = _login('owner', 'Owner@123')
    acc = next(a for a in requests.get(f"{API}/access/accounts", headers=owner, timeout=30).json() if a.get('username') == 'accountant')
    before = acc.get('module_access')
    mods = sorted(set(acc.get('modules') or before or []) | {'samples'})
    try:
        assert requests.put(f"{API}/access/accounts/{acc['id']}", headers=owner, json={'module_access': mods}, timeout=30).status_code == 200
        h = _login('accountant', 'Accountant@123')
        r = requests.post(f"{API}/record-photos", headers=h, timeout=60, files={'file': ('s.jpg', _jpg(), 'image/jpeg')},
                          data={'ref_type': 'sample', 'ref_id': 'test-sample-photo-access'})
        assert r.status_code == 200, r.text
        requests.delete(f"{API}/record-photos/{r.json()['id']}", headers=owner, timeout=30)
        # without the module: refused
        assert requests.put(f"{API}/access/accounts/{acc['id']}", headers=owner, json={'module_access': [m for m in mods if m != 'samples']}, timeout=30).status_code == 200
        h = _login('accountant', 'Accountant@123')
        r = requests.post(f"{API}/record-photos", headers=h, timeout=60, files={'file': ('s.jpg', _jpg(), 'image/jpeg')},
                          data={'ref_type': 'sample', 'ref_id': 'test-sample-photo-access'})
        assert r.status_code == 403
    finally:
        requests.put(f"{API}/access/accounts/{acc['id']}", headers=owner, json={'module_access': before}, timeout=30)


def test_received_photo_type_is_kept_apart():
    """Stock In: the compulsory photo of what came back is its own type
    (sample_receive), listed separately from the photos taken at issue."""
    owner = _login('owner', 'Owner@123')
    rid = 'test-sample-receive-photo'
    r = requests.post(f"{API}/record-photos", headers=owner, timeout=60, files={'file': ('r.jpg', _jpg(), 'image/jpeg')},
                      data={'ref_type': 'sample_receive', 'ref_id': rid})
    assert r.status_code == 200, r.text
    try:
        got = requests.get(f"{API}/record-photos?ref_type=sample_receive&ref_id={rid}", headers=owner, timeout=30).json()
        assert [p['id'] for p in got] == [r.json()['id']]
        assert requests.get(f"{API}/record-photos?ref_type=sample&ref_id={rid}", headers=owner, timeout=30).json() == []
    finally:
        requests.delete(f"{API}/record-photos/{r.json()['id']}", headers=owner, timeout=30)
