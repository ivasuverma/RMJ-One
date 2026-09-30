"""Cash Receive/Pay Types: rename (carried onto past entries) and switch off/on."""
import os
import uuid

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    t = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30).json()['access_token']
    return {"Authorization": f"Bearer {t}"}


def test_rename_and_deactivate_type():
    h = _owner()
    tag = uuid.uuid4().hex[:6]
    old, new = f'TEST Tea {tag}', f'TEST Chai {tag}'
    counter = requests.post(f"{API}/cashbook/counters", headers=h, json={'name': f'TEST Types {tag}', 'opening_balance': 0}, timeout=30).json()
    qn = requests.post(f"{API}/cashbook/quick-names", headers=h, json={'name': old, 'entry_type': 'received'}, timeout=30).json()
    r = requests.post(f"{API}/cashbook/entries", headers=h, json={
        'date': '2026-09-30', 'counter_id': counter['id'], 'type': 'received', 'amount': 20, 'name': 'Walk-in', 'category': old,
    }, timeout=30)
    assert r.status_code == 200, r.text
    entry_id = r.json()['id']

    # Rename: the type and the entry that used it both change.
    r = requests.put(f"{API}/cashbook/quick-names/{qn['id']}", headers=h, json={'name': new}, timeout=30)
    assert r.status_code == 200 and r.json()['name'] == new, r.text
    day = requests.get(f"{API}/cashbook/day?date=2026-09-30&counter_id={counter['id']}", headers=h, timeout=30).json()
    assert next(e for e in day['entries'] if e['id'] == entry_id)['category'] == new

    # A name already in the same list is refused.
    other = requests.post(f"{API}/cashbook/quick-names", headers=h, json={'name': f'TEST Milk {tag}', 'entry_type': 'received'}, timeout=30).json()
    assert requests.put(f"{API}/cashbook/quick-names/{other['id']}", headers=h, json={'name': new.upper()}, timeout=30).status_code == 409

    # Switch off, then re-adding the same name switches it back on.
    assert requests.put(f"{API}/cashbook/quick-names/{qn['id']}", headers=h, json={'active': False}, timeout=30).json()['active'] is False
    again = requests.post(f"{API}/cashbook/quick-names", headers=h, json={'name': new, 'entry_type': 'received'}, timeout=30).json()
    assert again['id'] == qn['id'] and again['active'] is True

    for q in (qn, other):
        requests.delete(f"{API}/cashbook/quick-names/{q['id']}", headers=h, timeout=30)
