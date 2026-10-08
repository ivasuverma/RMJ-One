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


def test_hidden_tile_also_leaves_home():
    """Hiding a tile (Gold Loans here) takes the module out of an admin's Home:
    no Needs-you or Coming-up rows for it, and its quick action stays but opens
    the entry form only. The owner, who chose it, still sees everything."""
    owner, admin = _login('owner', 'Owner@123'), _login('admin', 'Admin@123')
    before = requests.get(f"{API}/hidden-tiles", headers=owner, timeout=30).json()['keys']
    try:
        assert requests.put(f"{API}/hidden-tiles", headers=owner, json={'keys': before + ['work:loans']}, timeout=30).status_code == 200
        h = requests.get(f"{API}/home/summary?fresh=true", headers=admin, timeout=60).json()
        assert not [r for r in (h['needs_you'] or []) if isinstance(r, dict) and r.get('module') == 'gold_loans']
        assert not [i for i in ((h['coming_up'] or {}).get('items') or []) if i.get('module') == 'gold_loans']
        tiles = (h['quick_actions'] or {}).get('tiles') or []
        assert all(t.get('add_only') for t in tiles if t['module'] == 'gold_loans')
        assert not [t for t in tiles if t['module'] != 'gold_loans' and t.get('add_only')]
        o = requests.get(f"{API}/home/summary?fresh=true", headers=owner, timeout=60).json()
        assert not [t for t in ((o['quick_actions'] or {}).get('tiles') or []) if t.get('add_only')]
    finally:
        requests.put(f"{API}/hidden-tiles", headers=owner, json={'keys': before}, timeout=30)
