"""Home briefing (GET /home/summary): every section builds, access filters what each role
sees, quick-action order is saved per user, and the Settings › Home thresholds round-trip."""
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'

SECTIONS = ('header', 'rates', 'cash', 'quick_actions', 'needs_you', 'staff', 'owed', 'coming_up')


def _login(username, password, employee=False):
    path = 'employee-login' if employee else 'login'
    r = requests.post(f"{API}/auth/{path}", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_owner_gets_every_section():
    h = _login('owner', 'Owner@123')
    r = requests.get(f"{API}/home/summary?fresh=1", headers=h, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in SECTIONS:
        assert k in d, k
        # No section failed for the owner on the seeded data.
        assert not (isinstance(d[k], dict) and d[k].get('unavailable')), (k, d[k])
    assert d['header']['greeting'].startswith('Good ')
    assert isinstance(d['needs_you'], list)
    assert {t['key'] for t in d['quick_actions']['tiles']} >= {'cash_in', 'new_repair', 'issue_stock'}
    assert d['cash'] is not None and 'locations' in d['cash']
    # Second call inside 30 s comes from the per-user cache.
    assert requests.get(f"{API}/home/summary", headers=h, timeout=60).json()['cached'] is True


def test_access_filters_sections():
    emp = _login('rmj001', '1234', employee=True)
    d = requests.get(f"{API}/home/summary?fresh=1", headers=emp, timeout=60).json()
    # The seeded employee has no attendance/payroll/gold-loan access: those parts are absent.
    assert d['staff'] is None
    assert all(r['module'] not in ('gold_loans', 'attendance', 'rate_broadcast') for r in d['needs_you'])
    assert all(t['key'] not in ('new_loan', 'send_rates', 'advance') for t in d['quick_actions']['tiles'])

    acc = _login('accountant', 'Accountant@123')
    d = requests.get(f"{API}/home/summary?fresh=1", headers=acc, timeout=60).json()
    assert d['cash'] is not None                     # Cash Book is an accountant module
    assert d['rates']['broadcast'] is None           # Rate Broadcast is owner-only by default


def test_quick_action_order_saved_per_user():
    h = _login('owner', 'Owner@123')
    r = requests.put(f"{API}/home/quick-actions", headers=h, json={'order': ['new_repair', 'cash_in'], 'hidden': ['advance']}, timeout=30)
    assert r.status_code == 200, r.text
    keys = [t['key'] for t in r.json()['tiles']]
    assert keys[:2] == ['new_repair', 'cash_in'] and 'advance' not in keys
    again = requests.get(f"{API}/home/quick-actions", headers=h, timeout=30).json()
    assert [t['key'] for t in again['tiles']][:2] == ['new_repair', 'cash_in'] and again['hidden'] == ['advance']
    # Unknown keys are ignored; reset to the default order.
    assert requests.put(f"{API}/home/quick-actions", headers=h, json={'order': ['nope'], 'hidden': []}, timeout=30).status_code == 200


def test_home_settings_round_trip():
    h = _login('owner', 'Owner@123')
    base = requests.get(f"{API}/settings/home", headers=h, timeout=30).json()
    assert base['defaults']['sample_overdue_days'] == 3
    r = requests.put(f"{API}/settings/home", headers=h, json={'sample_overdue_days': 5, 'broadcast_deadline': '10:30'}, timeout=30)
    assert r.status_code == 200 and r.json()['settings']['sample_overdue_days'] == 5
    assert requests.put(f"{API}/settings/home", headers=h, json={'broadcast_deadline': '25:00'}, timeout=30).status_code == 422
    requests.put(f"{API}/settings/home", headers=h, json={'sample_overdue_days': 3, 'broadcast_deadline': '11:00'}, timeout=30)
    # Employees can't change them.
    emp = _login('rmj001', '1234', employee=True)
    assert requests.put(f"{API}/settings/home", headers=emp, json={'sample_overdue_days': 9}, timeout=30).status_code == 403
