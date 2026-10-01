"""Stock In/Out: part of an issue comes back, then the rest.

- Receiving part credits the karigar's gold balance for just that part and
  keeps the sample with the karigar.
- The final receive is measured against what is still out, and the total
  received covers both.
- Undoing a part removes its balance entry."""
import os
import uuid
from datetime import datetime, timedelta, timezone

import requests

BASE = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
API = BASE + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _bal(h, kid):
    return requests.get(f"{API}/karigars/{kid}/balance", headers=h, timeout=30).json()['weight_balance']


def test_part_then_rest():
    h = _owner()
    k = requests.post(f"{API}/karigars", headers=h, json={'name': f'Part test {uuid.uuid4().hex[:6]}', 'mobile': f'9{uuid.uuid4().int % 10**9:09d}'}, timeout=30)
    assert k.status_code == 200, k.text
    kid = k.json()['id']
    due = (datetime.now(timezone.utc) + timedelta(days=5)).strftime('%Y-%m-%d')
    r = requests.post(f"{API}/samples", headers=h, json={
        'karigar_id': kid, 'issue_type': 'Reference', 'due_date': due,
        'items': [{'description': 'Ten rings', 'weight': 50.0, 'pc_count': 10, 'purity': 92}],
    }, timeout=30)
    assert r.status_code == 200, r.text
    sid = r.json()[0]['id']
    start = _bal(h, kid)

    # too much for a part
    bad = requests.post(f"{API}/samples/{sid}/receive-part", headers=h, json={'weight': 50, 'pieces': 4}, timeout=30)
    assert bad.status_code == 400

    p = requests.post(f"{API}/samples/{sid}/receive-part", headers=h, json={'weight': 20.0, 'pieces': 4}, timeout=30)
    assert p.status_code == 200, p.text
    s = p.json()
    assert s['status'] == 'with_karigar' and len(s['partial_receipts']) == 1
    assert abs(_bal(h, kid) - (start - 20.0)) < 0.001

    # undo, then redo the part
    part_id = s['partial_receipts'][0]['id']
    u = requests.delete(f"{API}/samples/{sid}/receive-part/{part_id}", headers=h, timeout=30)
    assert u.status_code == 200 and u.json()['partial_receipts'] == []
    assert abs(_bal(h, kid) - start) < 0.001
    requests.post(f"{API}/samples/{sid}/receive-part", headers=h, json={'weight': 20.0, 'pieces': 4}, timeout=30)

    # the rest comes back 0.2 g short
    f = requests.post(f"{API}/samples/{sid}/receive", headers=h, json={'received_weight': 29.8}, timeout=30)
    assert f.status_code == 200, f.text
    s = f.json()
    assert s['status'] == 'received'
    assert abs(s['received_weight'] - 49.8) < 0.001 and abs(s['weight_diff'] + 0.2) < 0.001
    assert abs(_bal(h, kid) - (start - 49.8)) < 0.001

    requests.delete(f"{API}/samples/{sid}", headers=h, timeout=30)
