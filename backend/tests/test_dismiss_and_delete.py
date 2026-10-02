"""Swipe actions: hide a Needs-you row for today, delete notifications."""
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_hide_need_for_today_and_restore():
    h = _owner()
    s = requests.get(f"{API}/home/summary?fresh=1", headers=h, timeout=60).json()
    needs = s.get('needs_you')
    assert requests.post(f"{API}/home/needs/BAD KEY!/dismiss", headers=h, timeout=30).status_code in (400, 404)
    if isinstance(needs, list) and needs:
        key = needs[0]['key']
        assert requests.post(f"{API}/home/needs/{key}/dismiss", headers=h, timeout=30).status_code == 200
        s2 = requests.get(f"{API}/home/summary?fresh=1", headers=h, timeout=60).json()
        assert key not in [r['key'] for r in s2['needs_you']]
        assert s2['needs_hidden'] >= 1
    assert requests.post(f"{API}/home/needs/restore", headers=h, timeout=30).status_code == 200
    s3 = requests.get(f"{API}/home/summary?fresh=1", headers=h, timeout=60).json()
    assert s3.get('needs_hidden', 0) == 0


def test_delete_notifications():
    h = _owner()
    items = requests.get(f"{API}/notifications", headers=h, timeout=30).json()
    if items:
        nid = items[0]['id']
        assert requests.delete(f"{API}/notifications/{nid}", headers=h, timeout=30).status_code == 200
        assert nid not in [n['id'] for n in requests.get(f"{API}/notifications", headers=h, timeout=30).json()]
    assert requests.delete(f"{API}/notifications", headers=h, timeout=30).json()['ok'] is True
    assert requests.get(f"{API}/notifications", headers=h, timeout=30).json() == []
