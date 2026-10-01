"""Changing a day's attendance after that month's payroll was run refreshes the
person's saved (unpaid) payroll entry, so Payroll matches the calendar."""
import os
from datetime import date, timedelta

import pytest
import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_paid_off_after_payroll_run_updates_entry():
    h = _owner()
    last = date.today().replace(day=1) - timedelta(days=1)          # a finished month
    day = last.replace(day=10)
    if day.weekday() == 6:
        day = day + timedelta(days=1)
    emps = requests.get(f"{API}/employees?status=active", headers=h, timeout=30).json()
    emp = next((e for e in emps if (e.get('joining_date') or '0000')[:10] <= f"{last.year:04d}-{last.month:02d}-01"), None)
    if not emp:
        pytest.skip('no employee who was working that month')
    y, m, d = last.year, last.month, day.isoformat()
    lock = requests.get(f"{API}/payroll/{y}/{m}", headers=h, timeout=60).json()
    if lock.get('locked'):
        pytest.skip('that month is locked')

    requests.put(f"{API}/attendance/day/{emp['id']}/{d}", headers=h, json={'status': 'absent'}, timeout=30)
    assert requests.post(f"{API}/payroll/save", headers=h, json={'year': y, 'month': m}, timeout=120).status_code == 200
    row = next(r for r in requests.get(f"{API}/payroll/{y}/{m}", headers=h, timeout=60).json()['rows'] if r['employee_id'] == emp['id'])
    if row.get('paid'):
        pytest.skip('entry already paid')
    before_off, before_absent = row['weekly_off_days'], row['absent_days']

    r = requests.put(f"{API}/attendance/day/{emp['id']}/{d}", headers=h, json={'status': 'weekly_off'}, timeout=60)
    assert r.status_code == 200, r.text
    after = next(r for r in requests.get(f"{API}/payroll/{y}/{m}", headers=h, timeout=60).json()['rows'] if r['employee_id'] == emp['id'])
    assert after['weekly_off_days'] == before_off + 1
    assert after['absent_days'] == before_absent - 1
