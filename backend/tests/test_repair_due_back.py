"""Repair issue to karigar: a required due-back date is saved on the issue and the
item, can be changed on edit, and bad dates are rejected."""
import os
import random

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_issue_with_due_back():
    h = _owner()
    tag = random.randint(10**8, 10**9 - 1)
    order = requests.post(f"{API}/repair-orders", headers=h, json={
        'new_customer': {'name': f'Due Test {tag}', 'mobile': f'7{tag}'},
        'items': [{'description': 'Ring resize', 'gross_weight': 3.2, 'needs_karigar': True}],
    }, timeout=30)
    assert order.status_code == 200, order.text
    item_id = order.json()['items'][0]['id']
    k = requests.post(f"{API}/karigars", headers=h, json={'name': f'Karigar {tag}', 'mobile': f'6{tag}'}, timeout=30)
    assert k.status_code == 200, k.text
    kid = k.json()['id']

    bad = requests.post(f"{API}/repair-items/{item_id}/issue", headers=h, json={'karigar_id': kid, 'due_back': '5 Oct'}, timeout=30)
    assert bad.status_code == 422
    missing = requests.post(f"{API}/repair-items/{item_id}/issue", headers=h, json={'karigar_id': kid}, timeout=30)
    assert missing.status_code == 400   # required when a karigar is picked

    r = requests.post(f"{API}/repair-items/{item_id}/issue", headers=h, json={'karigar_id': kid, 'due_back': '2026-10-05'}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()['karigar_due_back'] == '2026-10-05'

    txns = requests.get(f"{API}/repair-items/{item_id}", headers=h, timeout=30).json()['history']
    issue = next(t for t in txns if t['direction'] == 'issue')
    assert issue['due_back'] == '2026-10-05'

    e = requests.put(f"{API}/repair-items/{item_id}/transactions/{issue['id']}", headers=h,
                     json={'karigar_id': kid, 'note': '', 'due_back': '2026-10-08'}, timeout=30)
    assert e.status_code == 200, e.text
    item = requests.get(f"{API}/repair-items/{item_id}", headers=h, timeout=30).json()
    assert item['item']['karigar_due_back'] == '2026-10-08'
    assert next(t for t in item['history'] if t['direction'] == 'issue')['due_back'] == '2026-10-08'

    # Past its due-back date, it shows on Home under Needs you today.
    requests.put(f"{API}/repair-items/{item_id}/transactions/{issue['id']}", headers=h,
                 json={'karigar_id': kid, 'note': '', 'due_back': '2020-01-01'}, timeout=30)
    needs = requests.get(f"{API}/home/summary?fresh=1", headers=h, timeout=60).json()['needs_you']
    row = next(r for r in needs if r['key'] == 'repairs_with_karigar')
    assert 'late' in row['detail']
