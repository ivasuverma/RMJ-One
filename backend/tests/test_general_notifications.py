"""Settings › Notifications › General: whole-shop message switches, each saved
in the setting it always lived in — and other screens' saves don't undo them."""
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _sw(h, key):
    return next(x for x in requests.get(f"{API}/settings/general-notifications", headers=h, timeout=30).json()['switches'] if x['key'] == key)


def test_general_switch_saves_and_survives_template_save():
    h = _owner()
    keys = {x['key'] for x in requests.get(f"{API}/settings/general-notifications", headers=h, timeout=30).json()['switches']}
    assert {'wa_enabled', 'repair_ready_notice', 'chatbot_enabled', 'gold_auto_send', 'rb_weekly', 'rb_daily'} <= keys

    before = _sw(h, 'chatbot_rate_enabled')['on']
    r = requests.put(f"{API}/settings/general-notifications", headers=h, json={'key': 'chatbot_rate_enabled', 'on': not before}, timeout=30)
    assert r.status_code == 200, r.text
    assert _sw(h, 'chatbot_rate_enabled')['on'] is (not before)
    # the WhatsApp settings record shows the same value
    assert requests.get(f"{API}/settings/whatsapp", headers=h, timeout=30).json()['chatbot_rate_enabled'] is (not before)

    # saving wording on the WhatsApp screen doesn't put the switch back
    requests.put(f"{API}/settings/whatsapp", headers=h, json={'chatbot_rate_template': None}, timeout=30)
    assert _sw(h, 'chatbot_rate_enabled')['on'] is (not before)

    requests.put(f"{API}/settings/general-notifications", headers=h, json={'key': 'chatbot_rate_enabled', 'on': before}, timeout=30)
    assert requests.put(f"{API}/settings/general-notifications", headers=h, json={'key': 'nope', 'on': True}, timeout=30).status_code == 400
