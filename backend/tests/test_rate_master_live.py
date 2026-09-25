"""In-app live purity rates (22K / 18K / 14K) — signed-in only."""
import os

import requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"


def test_live_purities_need_login():
    assert requests.get(f"{API}/rate-master/live", timeout=30).status_code in (401, 403)


def test_live_purities_shape():
    tok = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "Admin@123"}, timeout=30).json()['access_token']
    r = requests.get(f"{API}/rate-master/live", headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    assert r.status_code == 200, r.text
    items = r.json()['items']
    # Empty until the first live fetch; otherwise only the lower gold purities, never 24K or silver.
    assert all(i['key'].startswith('gold_') and i['key'] != 'gold_24k' for i in items)
