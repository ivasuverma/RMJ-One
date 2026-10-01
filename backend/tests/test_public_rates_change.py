"""The public rates feed carries the change since the rate last moved, for the
website and the app's Live Rates page."""
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def test_public_rates_has_change_fields():
    r = requests.get(f"{API}/public/rates", timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ('gold_change', 'gold_changed_at', 'silver_change', 'silver_changed_at'):
        assert k in d, k
    if d['gold_change'] is not None:
        assert isinstance(d['gold_change'], int)
