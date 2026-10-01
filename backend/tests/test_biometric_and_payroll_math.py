"""Biometric device (ADMS/iClock) intake and the core payroll day maths.

- A registered device's handshake marks it online; its ATTLOG upload is
  accepted; an unregistered device is rejected but still acked.
- Payroll: a half day pays exactly half of a present day."""
import os
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
import requests

BASE = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
API = BASE + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_device_handshake_and_attlog():
    h = _owner()
    serial = f'TEST{uuid.uuid4().hex[:8].upper()}'
    d = requests.post(f"{API}/biometric/devices", headers=h, json={'serial': serial, 'label': 'Test machine', 'secret': 'x'}, timeout=30)
    assert d.status_code == 200, d.text
    root = BASE   # the device protocol is served at the server root, LAN-only
    hs = requests.get(f"{root}/iclock/cdata?SN={serial}", timeout=30)
    assert hs.status_code == 200 and 'GET OPTION FROM' in hs.text
    dev = next(x for x in requests.get(f"{API}/biometric/devices", headers=h, timeout=30).json() if x['serial'] == serial)
    assert dev['status'] == 'online' and dev['last_seen']

    emps = requests.get(f"{API}/employees?status=active", headers=h, timeout=30).json()
    emp = next((e for e in emps if e.get('employee_code')), None)
    if not emp:
        pytest.skip('no employee with a code')
    ist = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30) - timedelta(minutes=5)
    body = f"{emp.get('biometric_id') or emp['employee_code']}\t{ist.strftime('%Y-%m-%d %H:%M:%S')}\t0\t1\t0\n"
    up = requests.post(f"{root}/iclock/cdata?SN={serial}&table=ATTLOG", data=body.encode(), timeout=30)
    assert up.status_code == 200 and up.text.startswith('OK: 1'), up.text

    # Unknown device: acked (so it stops retrying) but nothing is recorded as a punch.
    unk = requests.post(f"{root}/iclock/cdata?SN=NOPE{uuid.uuid4().hex[:6]}&table=ATTLOG", data=body.encode(), timeout=30)
    assert unk.status_code == 200 and unk.text.strip() == 'OK'

    requests.delete(f"{API}/biometric/devices/{dev['id']}", headers=h, timeout=30)


def test_half_day_pays_half():
    h = _owner()
    last = date.today().replace(day=1) - timedelta(days=1)
    y, m = last.year, last.month
    if requests.get(f"{API}/payroll/{y}/{m}", headers=h, timeout=60).json().get('locked'):
        pytest.skip('that month is locked')
    emps = requests.get(f"{API}/employees?status=active", headers=h, timeout=30).json()
    emp = next((e for e in emps if (e.get('joining_date') or '0000')[:10] <= f"{y:04d}-{m:02d}-01" and (e.get('base_salary') or 0) > 0), None)
    if not emp:
        pytest.skip('no salaried employee who was working that month')
    day = last.replace(day=14)
    while day.weekday() == 6:
        day += timedelta(days=1)
    d = day.isoformat()

    def earned():
        rows = requests.get(f"{API}/payroll/{y}/{m}", headers=h, timeout=60).json()['rows']
        return next(r for r in rows if r['employee_id'] == emp['id'])

    requests.put(f"{API}/attendance/day/{emp['id']}/{d}", headers=h, json={'status': 'present'}, timeout=30)
    full = earned()
    requests.put(f"{API}/attendance/day/{emp['id']}/{d}", headers=h, json={'status': 'half_day'}, timeout=30)
    half = earned()
    if full.get('paid') or half.get('paid'):
        pytest.skip('entry already paid')
    per_day = full['base_salary'] / full['total_days']
    assert abs((full['earned'] - half['earned']) - per_day / 2) < 1.0, (full['earned'], half['earned'], per_day)
