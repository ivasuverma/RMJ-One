"""Website visitor ticker: counts only, a visit counts once per 'new' ping."""
import os
import uuid

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def test_visit_counts():
    sid = uuid.uuid4().hex[:16]
    a = requests.post(f"{API}/public/visit", json={'sid': sid, 'new': True}, timeout=30)
    assert a.status_code == 200, a.text
    a = a.json()
    assert a['online'] >= 1 and a['today'] >= 1 and a['total'] >= a['today']
    b = requests.post(f"{API}/public/visit", json={'sid': sid, 'new': False}, timeout=30).json()
    assert b['today'] == a['today'] and b['total'] == a['total']        # a heartbeat doesn't count again
    assert requests.post(f"{API}/public/visit", json={'sid': 'bad id!'}, timeout=30).status_code == 422
