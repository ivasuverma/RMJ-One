"""Customers and karigars are identified by mobile number: a second one with
a number already saved (however it's formatted) is refused."""
import os
import random

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    t = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30).json()['access_token']
    return {"Authorization": f"Bearer {t}"}


def _num():
    return f"9{random.randint(100000000, 999999999)}"


def test_customer_mobile_is_unique():
    h = _owner()
    n = _num()
    r = requests.post(f"{API}/customers", headers=h, json={'name': 'TEST Uniq A', 'mobile': n}, timeout=30)
    assert r.status_code == 200, r.text
    a = r.json()
    # Same number written differently: refused, and names who has it.
    r = requests.post(f"{API}/customers", headers=h, json={'name': 'TEST Uniq B', 'mobile': f"+91 {n[:5]} {n[5:]}"}, timeout=30)
    assert r.status_code == 409 and 'TEST Uniq A' in r.json()['detail']
    # Also via a repair intake's New Customer.
    r = requests.post(f"{API}/repair-orders", headers=h, json={
        'new_customer': {'name': 'TEST Uniq C', 'mobile': n},
        'items': [{'description': 'ring', 'repair_type': '', 'gross_weight': 1, 'pc_count': 1}],
    }, timeout=30)
    assert r.status_code == 409, r.text
    # Editing another customer onto the number is refused; re-saving the owner's own number is fine.
    b = requests.post(f"{API}/customers", headers=h, json={'name': 'TEST Uniq D', 'mobile': _num()}, timeout=30).json()
    assert requests.put(f"{API}/customers/{b['id']}", headers=h, json={'name': 'TEST Uniq D', 'mobile': n}, timeout=30).status_code == 409
    assert requests.put(f"{API}/customers/{a['id']}", headers=h, json={'name': 'TEST Uniq A2', 'mobile': n}, timeout=30).status_code == 200


def test_karigar_mobile_is_unique():
    h = _owner()
    n = _num()
    r = requests.post(f"{API}/karigars", headers=h, json={'name': 'TEST KUniq A', 'mobile': n}, timeout=30)
    assert r.status_code == 200, r.text
    r = requests.post(f"{API}/karigars", headers=h, json={'name': 'TEST KUniq B', 'mobile': f"0{n}"}, timeout=30)
    assert r.status_code == 409 and 'TEST KUniq A' in r.json()['detail']
    # A customer may share a karigar's number — uniqueness is per kind.
    assert requests.post(f"{API}/customers", headers=h, json={'name': 'TEST KUniq Cust', 'mobile': n}, timeout=30).status_code == 200
