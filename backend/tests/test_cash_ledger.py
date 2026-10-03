"""Cash Ledger (khata): people, cash you gave / got, balances, settle up."""
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_cash_ledger_flow():
    h = _login('owner', 'Owner@123')
    name = f'Khata test {os.urandom(3).hex()}'
    a = requests.post(f"{API}/khata", headers=h, json={'name': name, 'phone': '9800000000'}, timeout=30).json()
    aid = a['id']
    try:
        assert requests.post(f"{API}/khata", headers=h, json={'name': name.upper()}, timeout=30).status_code == 400
        for d, amt in (('gave', 5000), ('got', 2000), ('gave', 500)):
            r = requests.post(f"{API}/khata/{aid}/entries", headers=h, json={'direction': d, 'amount': amt, 'date': '2026-09-20'}, timeout=30)
            assert r.status_code == 200, r.text
        acc = requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()
        assert acc['account']['balance'] == 3500 and len(acc['entries']) == 3
        assert acc['entries'][0]['balance_after'] == 3500   # newest first, balance after each
        row = next(x for x in requests.get(f"{API}/khata", headers=h, timeout=30).json()['accounts'] if x['id'] == aid)
        assert row['balance'] == 3500
        # can't remove with money pending; settle brings it to zero
        assert requests.delete(f"{API}/khata/{aid}", headers=h, timeout=30).status_code == 400
        s = requests.post(f"{API}/khata/{aid}/settle", headers=h, timeout=30).json()
        assert s['direction'] == 'got' and s['amount'] == 3500
        assert requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()['account']['balance'] == 0
        # the store manager doesn't get the owner's khata unless given it
        assert requests.get(f"{API}/khata", headers=_login('admin', 'Admin@123'), timeout=30).status_code == 403
    finally:
        for e in requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json().get('entries', []):
            requests.delete(f"{API}/khata/{aid}/entries/{e['id']}", headers=h, timeout=30)
        requests.delete(f"{API}/khata/{aid}", headers=h, timeout=30)
