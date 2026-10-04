"""Delete old Cash Book entries (owner only): entries before 1 week / 1 month
go, but every counter's balance stays exactly the same."""
import os
import uuid
from datetime import date, timedelta

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _login(username, password):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _balances(h):
    r = requests.get(f"{API}/cashbook/counters", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    return {c['id']: c['closing_balance'] for c in r.json()}


def test_purge_is_owner_only():
    h = _login('admin', 'Admin@123')
    assert requests.get(f"{API}/cashbook/purge-preview?period=week", headers=h, timeout=30).status_code == 403
    assert requests.post(f"{API}/cashbook/purge", headers=h, json={'period': 'week'}, timeout=30).status_code == 403


def test_purge_keeps_balances():
    h = _login('owner', 'Owner@123')
    assert requests.post(f"{API}/cashbook/purge", headers=h, json={'period': 'year'}, timeout=30).status_code == 400

    c = requests.post(f"{API}/cashbook/counters", headers=h,
                      json={'name': f'Purge test {uuid.uuid4().hex[:6]}', 'opening_balance': 1000, 'limit_alert': False}, timeout=30)
    assert c.status_code == 200, c.text
    cid = c.json()['id']
    old = (date.today() - timedelta(days=60)).isoformat()
    new = date.today().isoformat()
    for d, t, amt in [(old, 'received', 500), (old, 'paid', 200), (new, 'received', 50)]:
        e = requests.post(f"{API}/cashbook/entries", headers=h, json={'date': d, 'counter_id': cid, 'type': t, 'amount': amt, 'name': 'X'}, timeout=30)
        assert e.status_code == 200, e.text

    p = requests.get(f"{API}/cashbook/purge-preview?period=month", headers=h, timeout=30)
    assert p.status_code == 200, p.text
    assert {'before', 'entries', 'photos'} <= set(p.json()) and p.json()['entries'] >= 2

    before = _balances(h)
    assert before[cid] == 1350
    r = requests.post(f"{API}/cashbook/purge", headers=h, json={'period': 'month'}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()['deleted'] >= 2
    assert _balances(h) == before

    day = requests.get(f"{API}/cashbook/day?date={old}&counter_id={cid}", headers=h, timeout=30).json()
    assert not day.get('entries')
