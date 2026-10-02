"""Fixes from the sample-data check.

- A day marked Leave on the attendance calendar is paid leave (same as an
  approved leave request), not an unpaid, uncounted day.
- A new gold loan isn't overdue just because interest has started.
- Saving a day with times reports the status the hours decided."""
import os
from datetime import date, timedelta

import pytest
import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _last_month_weekday():
    first = date.today().replace(day=1)
    d = first - timedelta(days=1)
    d = d.replace(day=15)
    while d.weekday() == 6:
        d -= timedelta(days=1)
    return d


def _row(h, d, emp_id):
    rows = requests.post(f"{API}/payroll/compute", headers=h, json={'year': d.year, 'month': d.month}, timeout=60).json()['rows']
    return next(r for r in rows if r['employee_id'] == emp_id)


def test_calendar_leave_is_paid_leave():
    h = _owner()
    emps = [e for e in requests.get(f"{API}/employees", headers=h, timeout=30).json() if e.get('status') == 'active']
    if not emps:
        pytest.skip('no active employee')
    emp = emps[0]
    d = _last_month_weekday()
    requests.put(f"{API}/attendance/day/{emp['id']}/{d.isoformat()}", headers=h, json={'status': 'absent'}, timeout=30)
    before = _row(h, d, emp['id'])
    requests.put(f"{API}/attendance/day/{emp['id']}/{d.isoformat()}", headers=h, json={'status': 'leave'}, timeout=30)
    after = _row(h, d, emp['id'])
    assert after['leave_days'] == before['leave_days'] + 1
    assert after['earned'] > before['earned']


def test_times_decide_and_report_status():
    h = _owner()
    emps = [e for e in requests.get(f"{API}/employees", headers=h, timeout=30).json() if e.get('status') == 'active']
    if not emps:
        pytest.skip('no active employee')
    d = _last_month_weekday() - timedelta(days=1)
    r = requests.put(f"{API}/attendance/day/{emps[0]['id']}/{d.isoformat()}", headers=h,
                     json={'status': 'present', 'check_in_time': '10:00', 'check_out_time': '13:00'}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()['status'] == 'half_day'   # 3 hours is under the half-day hours


def test_new_loan_not_overdue():
    h = _owner()
    tag = os.urandom(3).hex()
    r = requests.post(f"{API}/gold-loans", headers=h, json={
        'new_customer': {'name': f'Loan Test {tag}', 'mobile': f'7{int(tag, 16) % 10**9:09d}'},
        'description': 'Chain', 'weight': 10, 'principal': 50000, 'interest_rate_percent': 1.5,
    }, timeout=30)
    assert r.status_code == 200, r.text
    lid = r.json()['id']
    loan = next(l for l in requests.get(f"{API}/gold-loans", headers=h, timeout=30).json() if l['id'] == lid)
    assert loan['overdue'] is False
