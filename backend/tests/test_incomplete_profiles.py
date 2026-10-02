"""Home "Needs you today" lists employees whose profile is missing details,
by name, and the Complete profiles screen says what each one is missing."""
import os
import uuid

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_incomplete_profile_listed_by_name():
    h = _owner()
    name = f'Profile Test {uuid.uuid4().hex[:6]}'
    r = requests.post(f"{API}/employees", headers=h, json={
        'name': name, 'mobile': f'9{uuid.uuid4().int % 10**9:09d}', 'salary': 10000, 'pan': 'ABCDE1234F'}, timeout=30)
    assert r.status_code == 200, r.text
    eid = r.json()['id']
    try:
        rows = requests.get(f"{API}/employees/incomplete", headers=h, timeout=30).json()['employees']
        me = next(x for x in rows if x['id'] == eid)
        assert 'Aadhaar' in me['missing'] and 'ID proof' in me['missing']
        assert 'PAN' not in me['missing'] and 'Mobile' not in me['missing']
        needs = requests.get(f"{API}/home/summary", headers=h, timeout=60).json()['needs_you']
        row = next(n for n in needs if n['key'] == 'profiles_incomplete')
        assert row['count'] >= 1 and row['detail']
    finally:
        requests.delete(f"{API}/employees/{eid}", headers=h, timeout=30)
