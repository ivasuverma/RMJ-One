"""Over-limit cash alert: on for the cash counter, off for drawers/lockers by default, switchable per counter."""
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    t = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30).json()['access_token']
    return {"Authorization": f"Bearer {t}"}


def test_limit_alert_defaults_and_toggle():
    h = _owner()
    made = {}
    for name in ('TEST Cash Counter', 'TEST Drawer', 'TEST Locker'):
        r = requests.post(f"{API}/cashbook/counters", headers=h, json={'name': name, 'opening_balance': 0}, timeout=30)
        assert r.status_code == 200, r.text
        made[name] = r.json()
    assert made['TEST Cash Counter']['limit_alert'] is True
    assert made['TEST Drawer']['limit_alert'] is False
    assert made['TEST Locker']['limit_alert'] is False

    lid = made['TEST Locker']['id']
    assert requests.put(f"{API}/cashbook/counters/{lid}", headers=h, json={'limit_alert': True}, timeout=30).status_code == 200
    listed = {c['id']: c for c in requests.get(f"{API}/cashbook/counters", headers=h, timeout=30).json()}
    assert listed[lid]['limit_alert'] is True
    assert listed[made['TEST Drawer']['id']]['limit_alert'] is False
    for c in made.values():  # tidy up (empty counters can be closed)
        requests.put(f"{API}/cashbook/counters/{c['id']}", headers=h, json={'active': False}, timeout=30)
