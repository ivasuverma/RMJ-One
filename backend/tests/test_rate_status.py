"""Rate → WhatsApp Status switch (posted alongside the channel, once a day)."""
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'
KEYS = ('gold_margin', 'silver_margin', 'gold_buy_margin', 'silver_buy_margin', 'template', 'refresh_enabled',
        'refresh_interval_min', 'refresh_start', 'refresh_end', 'auto_send_enabled', 'auto_send_time', 'skip_weekend_fetch')


def test_status_switch_saves_and_defaults_on():
    t = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30).json()['access_token']
    h = {"Authorization": f"Bearer {t}"}
    g = requests.get(f"{API}/settings/gold-rate", headers=h, timeout=30).json()
    assert g['status_enabled'] is True  # on by default
    body = {k: g[k] for k in KEYS}
    r = requests.put(f"{API}/settings/gold-rate/config", headers=h, json={**body, 'status_enabled': False}, timeout=30)
    assert r.status_code == 200, r.text
    assert requests.get(f"{API}/settings/gold-rate", headers=h, timeout=30).json()['status_enabled'] is False
    # a save that doesn't mention it leaves it alone
    requests.put(f"{API}/settings/gold-rate/config", headers=h, json=body, timeout=30)
    assert requests.get(f"{API}/settings/gold-rate", headers=h, timeout=30).json()['status_enabled'] is False
    requests.put(f"{API}/settings/gold-rate/config", headers=h, json={**body, 'status_enabled': True}, timeout=30)


def test_samples_analytics_is_reachable():
    """/samples/analytics used to be declared after /samples/{sample_id}, so
    'analytics' was taken as a sample id and it always 404'd."""
    import datetime
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = requests.get(f"{API}/samples/analytics", params={'period': 'week', 'date': datetime.date.today().isoformat()}, headers=h, timeout=30)
    assert r.status_code == 200, r.text
