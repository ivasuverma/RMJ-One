"""Cash Ledger (khata): people, cash you gave / got in any currency, balances
per currency, settle up - and it never touches the Cash Book or Home."""
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _shop_cash(h):
    """What the Cash Book counters and Home say about cash, to compare before/after."""
    counters = requests.get(f"{API}/cashbook/counters", headers=h, timeout=30).json()
    home = requests.get(f"{API}/home/summary?fresh=true", headers=h, timeout=60).json()
    return counters, home.get('cash')


def test_cash_ledger_flow_and_isolation():
    h = _login('owner', 'Owner@123')
    before = _shop_cash(h)
    name = f'Khata test {os.urandom(3).hex()}'
    a = requests.post(f"{API}/khata", headers=h, json={'name': name, 'phone': '9800000000'}, timeout=30).json()
    aid = a['id']
    try:
        assert a['currency'] == 'INR'
        assert requests.post(f"{API}/khata", headers=h, json={'name': name.upper()}, timeout=30).status_code == 400
        for d, amt, cur in (('gave', 5000, 'INR'), ('got', 2000, 'INR'), ('gave', 500, 'INR'), ('gave', 100, 'USD'), ('got', 30, 'usd')):
            r = requests.post(f"{API}/khata/{aid}/entries", headers=h,
                              json={'direction': d, 'amount': amt, 'currency': cur, 'date': '2026-09-20'}, timeout=30)
            assert r.status_code == 200, r.text
        assert requests.post(f"{API}/khata/{aid}/entries", headers=h, json={'direction': 'gave', 'amount': 1, 'currency': 'RUPEES'}, timeout=30).status_code == 400
        acc = requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()
        # each currency keeps its own balance - never converted
        assert acc['account']['balances'] == {'INR': 3500, 'USD': 70}
        assert acc['account']['currency'] == 'USD'          # next entry starts in the one used last
        newest = acc['entries'][0]
        assert newest['currency'] == 'USD' and newest['balance_after'] == 70
        row = next(x for x in requests.get(f"{API}/khata", headers=h, timeout=30).json()['accounts'] if x['id'] == aid)
        assert row['balances'] == {'INR': 3500, 'USD': 70}
        # can't remove with money pending; settle brings every currency to zero
        assert requests.delete(f"{API}/khata/{aid}", headers=h, timeout=30).status_code == 400
        s = requests.post(f"{API}/khata/{aid}/settle", headers=h, timeout=30).json()
        assert sorted((e['currency'], e['direction'], e['amount']) for e in s['entries']) == [('INR', 'got', 3500), ('USD', 'got', 70)]
        assert requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()['account']['balances'] == {}
        # the store manager doesn't get the owner's khata unless given it
        assert requests.get(f"{API}/khata", headers=_login('admin', 'Admin@123'), timeout=30).status_code == 403
        # no effect on any other module: the Cash Book and Home's cash are exactly as before
        assert _shop_cash(h) == before
    finally:
        for e in requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json().get('entries', []):
            requests.delete(f"{API}/khata/{aid}/entries/{e['id']}", headers=h, timeout=30)
        requests.delete(f"{API}/khata/{aid}", headers=h, timeout=30)
