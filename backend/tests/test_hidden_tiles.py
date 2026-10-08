"""Hidden tiles on the Work and Ledger tabs: anyone signed in reads the list,
only the owner changes it; Cash Ledger is hidden by default."""
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_hidden_tiles():
    owner, admin = _login('owner', 'Owner@123'), _login('admin', 'Admin@123')
    before = requests.get(f"{API}/hidden-tiles", headers=owner, timeout=30).json()['keys']
    try:
        assert requests.put(f"{API}/hidden-tiles", headers=admin, json={'keys': ['work:cash']}, timeout=30).status_code == 403
        r = requests.put(f"{API}/hidden-tiles", headers=owner, json={'keys': ['work:cash', 'ledger:cash-ledger', 'bad key', 'work:cash']}, timeout=30)
        assert r.status_code == 200 and r.json()['keys'] == ['ledger:cash-ledger', 'work:cash']
        assert requests.get(f"{API}/hidden-tiles", headers=admin, timeout=30).json()['keys'] == ['ledger:cash-ledger', 'work:cash']
    finally:
        requests.put(f"{API}/hidden-tiles", headers=owner, json={'keys': before}, timeout=30)
