"""Settings > General notifications: per-alert push / WhatsApp switches."""
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _get(h, key):
    alerts = requests.get(f"{API}/settings/general-alerts", headers=h, timeout=30).json()['alerts']
    return next(a for a in alerts if a['key'] == key)


def test_switches_save_and_customer_notice_has_no_push():
    h = _owner()
    before = _get(h, 'salary_paid')
    r = requests.put(f"{API}/settings/general-alerts", headers=h, json={'key': 'salary_paid', 'channel': 'whatsapp', 'on': False}, timeout=30)
    assert r.status_code == 200, r.text
    assert _get(h, 'salary_paid')['whatsapp'] is False
    requests.put(f"{API}/settings/general-alerts", headers=h, json={'key': 'salary_paid', 'channel': 'whatsapp', 'on': before['whatsapp']}, timeout=30)

    assert _get(h, 'repair_ready_notice')['push'] is None
    bad = requests.put(f"{API}/settings/general-alerts", headers=h, json={'key': 'repair_ready_notice', 'channel': 'push', 'on': True}, timeout=30)
    assert bad.status_code == 400
