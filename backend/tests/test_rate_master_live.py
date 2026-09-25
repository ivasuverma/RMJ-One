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


def test_buyback_percent_saved_and_previewed():
    tok = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30).json()['access_token']
    h = {"Authorization": f"Bearer {tok}"}
    items = requests.get(f"{API}/rate-master", headers=h, timeout=30).json()['items']
    body = [{**i, 'buy_percent': 89 if i['key'] == 'gold_22k' else None} for i in items]
    r = requests.put(f"{API}/rate-master", headers=h, json={'items': body}, timeout=30)
    assert r.status_code == 200, r.text
    saved = {i['key']: i for i in r.json()['items']}
    assert saved['gold_22k']['buy_percent'] == 89 and saved['gold_18k']['buy_percent'] is None
    assert saved['gold_24k']['buy_percent'] is None  # 24K buyback stays on the spread setting
    prev = requests.post(f"{API}/rate-master/preview", headers=h, json={'items': body, 'gold': 150000, 'silver': 240000}, timeout=30).json()
    by = {c['key']: c for c in prev['computed']}
    assert by['gold_22k']['buy_rate'] == 133500 and by['gold_18k']['buy_rate'] is None
    bad = [{**i, 'buy_percent': 250 if i['key'] == 'gold_18k' else None} for i in items]
    assert requests.put(f"{API}/rate-master", headers=h, json={'items': bad}, timeout=30).status_code == 400
    requests.put(f"{API}/rate-master", headers=h, json={'items': [{**i, 'buy_percent': None} for i in items]}, timeout=30)
