"""Close the day: the counted cash is compared with the book, any difference is
recorded as one adjustment entry, the day is locked, and reopening (owner)
undoes both."""
import os
import uuid
from datetime import date, timedelta

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_close_count_lock_and_reopen():
    h = _owner()
    c = requests.post(f"{API}/cashbook/counters", headers=h,
                      json={'name': f'Close test {uuid.uuid4().hex[:6]}', 'opening_balance': 1000, 'limit_alert': False}, timeout=30)
    assert c.status_code == 200, c.text
    cid = c.json()['id']
    d = (date.today() - timedelta(days=1)).isoformat()
    e = requests.post(f"{API}/cashbook/entries", headers=h, json={'date': d, 'counter_id': cid, 'type': 'received', 'amount': 500, 'name': 'Sale'}, timeout=30)
    assert e.status_code == 200, e.text

    r = requests.post(f"{API}/cashbook/close", headers=h, json={'counter_id': cid, 'date': d, 'counted': 1450, 'note': 'Short by 50'}, timeout=30)
    assert r.status_code == 200, r.text
    cl = r.json()
    assert cl['expected'] == 1500 and cl['counted'] == 1450 and cl['difference'] == -50 and cl['adjustment_entry_id']

    day = requests.get(f"{API}/cashbook/day?date={d}&counter_id={cid}", headers=h, timeout=30).json()
    assert day['closure']['difference'] == -50 and day['closing_balance'] == 1450
    # Locked: no new entry, no edit, no second close.
    assert requests.post(f"{API}/cashbook/entries", headers=h, json={'date': d, 'counter_id': cid, 'type': 'paid', 'amount': 10, 'name': 'X'}, timeout=30).status_code == 400
    assert requests.put(f"{API}/cashbook/entries/{e.json()['id']}", headers=h, json={'amount': 600}, timeout=30).status_code == 400
    assert requests.post(f"{API}/cashbook/close", headers=h, json={'counter_id': cid, 'date': d, 'counted': 1450}, timeout=30).status_code == 400

    # Reopen: adjustment gone, entries allowed again.
    assert requests.delete(f"{API}/cashbook/close/{cid}/{d}", headers=h, timeout=30).status_code == 200
    day = requests.get(f"{API}/cashbook/day?date={d}&counter_id={cid}", headers=h, timeout=30).json()
    assert day['closure'] is None and day['closing_balance'] == 1500
    ok = requests.post(f"{API}/cashbook/entries", headers=h, json={'date': d, 'counter_id': cid, 'type': 'paid', 'amount': 10, 'name': 'X'}, timeout=30)
    assert ok.status_code == 200, ok.text
