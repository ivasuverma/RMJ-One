"""Home briefing (GET /home/summary): every section builds, access filters what each role
sees, quick-action order is saved per user, and the Settings › Home thresholds round-trip."""
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'

SECTIONS = ('header', 'rates', 'cash', 'quick_actions', 'needs_you', 'staff', 'owed', 'coming_up', 'notifications')


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
    st = d['notifications']['staff']   # always-visible Staff notifications row
    assert 0 <= st['on'] <= st['total']
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


def test_sections_hidden_per_user():
    h = _login('owner', 'Owner@123')
    try:
        r = requests.put(f"{API}/home/sections", headers=h, json={'hidden': ['owed', 'coming_up', 'nope']}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()['hidden'] == ['owed', 'coming_up']
        d = requests.get(f"{API}/home/summary", headers=h, timeout=60).json()
        assert d['owed'] is None and d['coming_up'] is None
        assert d['hidden_sections'] == ['owed', 'coming_up']
        assert d['cash'] is not None
        assert isinstance(d['notifications']['items'], list) and len(d['notifications']['items']) <= 5
    finally:
        requests.put(f"{API}/home/sections", headers=h, json={'hidden': []}, timeout=30)


def test_section_order_saved_per_user():
    h = _login('owner', 'Owner@123')
    try:
        r = requests.put(f"{API}/home/sections", headers=h, json={'hidden': [], 'order': ['notifications', 'needs_you', 'bogus']}, timeout=30)
        assert r.status_code == 200, r.text
        order = r.json()['order']
        assert order[:2] == ['notifications', 'needs_you'] and 'bogus' not in order and 'cash' in order
        assert requests.get(f"{API}/home/summary", headers=h, timeout=60).json()['section_order'] == order
        # Sending only `hidden` keeps the saved order.
        assert requests.put(f"{API}/home/sections", headers=h, json={'hidden': ['owed']}, timeout=30).json()['order'] == order
    finally:
        requests.put(f"{API}/home/sections", headers=h, json={'hidden': [], 'order': []}, timeout=30)
    emp = _login('rmj001', '1234', employee=True)
    e = requests.get(f"{API}/home/sections", headers=emp, timeout=30).json()
    assert 'punch' in e['order'] and 'cash' not in e['order']
    # The punch card can't be hidden.
    assert 'punch' not in requests.put(f"{API}/home/sections", headers=emp, json={'hidden': ['punch']}, timeout=30).json()['hidden']


def test_staff_notification_status_and_nudge():
    h = _login('owner', 'Owner@123')
    r = requests.get(f"{API}/notifications/staff-status", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert isinstance(d['staff'], list) and d['off'] == sum(1 for x in d['staff'] if not x['devices'])
    emp = _login('rmj001', '1234', employee=True)
    assert requests.get(f"{API}/notifications/staff-status", headers=emp, timeout=30).status_code == 403
    me = next(x for x in d['staff'] if x['name'])
    n = requests.post(f"{API}/notifications/staff-nudge", headers=h, json={'employee_ids': [me['id']]}, timeout=30)
    assert n.status_code == 200 and n.json()['reminded'] == 1
    again = requests.get(f"{API}/notifications/staff-status", headers=h, timeout=30).json()
    assert next(x for x in again['staff'] if x['id'] == me['id'])['nudged_at'] == n.json()['at']
