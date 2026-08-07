"""RMJ One — Milestone 2A backend tests (auth-pin, settings, attendance, corrections, leaves).

Uses public EXPO_PUBLIC_BACKEND_URL. Idempotent where possible; check-in per-employee-per-day
is unique so we rotate employees when needed to keep tests re-runnable.
"""
import os
import uuid
import base64
import pytest
import requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"

# Store default (matches seed)
STORE_LAT = 28.6139
STORE_LNG = 77.2090


def _big_selfie() -> str:
    payload = base64.b64encode(os.urandom(120)).decode()
    return f"data:image/jpeg;base64,{payload}" + "A" * 50


@pytest.fixture(scope='session')
def owner_headers():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


def _login_emp(code: str, pin: str):
    r = requests.post(f"{API}/auth/employee-login", json={"employee_code": code, "pin": pin}, timeout=30)
    return r


# ------- Store settings -------
class TestStoreSettings:
    def test_get_defaults(self, owner_headers):
        r = requests.get(f"{API}/settings/store", headers=owner_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get('latitude') is not None and d.get('longitude') is not None
        assert d.get('radius_m') is not None
        assert '_id' not in str(d)

    def test_put_owner_updates(self, owner_headers):
        # Read current -> write same to avoid drift, then verify
        cur = requests.get(f"{API}/settings/store", headers=owner_headers, timeout=30).json()
        body = {
            'name': cur.get('name', 'Ram Murti Jewellers'),
            'latitude': STORE_LAT, 'longitude': STORE_LNG,
            'radius_m': 150, 'work_start': '10:00', 'work_end': '19:30', 'grace_min': 15,
        }
        r = requests.put(f"{API}/settings/store", headers=owner_headers, json=body, timeout=30)
        assert r.status_code == 200, r.text
        got = r.json()
        assert got['radius_m'] == 150 and got['work_start'] == '10:00'
        # refetch
        r2 = requests.get(f"{API}/settings/store", headers=owner_headers, timeout=30).json()
        assert r2['radius_m'] == 150


# ------- Employee PIN login -------
class TestEmployeeLogin:
    def test_login_ok(self):
        r = _login_emp('RMJ001', '0001')
        assert r.status_code == 200, r.text
        u = r.json()
        assert u['user']['role'] == 'employee'
        assert u['user']['employee_code'] == 'RMJ001'
        assert 'pin_hash' not in str(u) and '_id' not in str(u)

    def test_login_wrong_pin(self):
        r = _login_emp('RMJ001', '9998')
        assert r.status_code == 401

    def test_login_unknown_code(self):
        r = _login_emp('RMJ999', '0000')
        assert r.status_code == 401


# ------- Owner sets PIN -------
class TestSetPin:
    def test_set_pin_ok_and_login(self, owner_headers):
        # find RMJ005
        emps = requests.get(f"{API}/employees", headers=owner_headers, timeout=30).json()
        target = next(e for e in emps if e['employee_code'] == 'RMJ005')
        r = requests.post(f"{API}/employees/{target['id']}/set-pin", headers=owner_headers, json={"pin": "4321"}, timeout=30)
        assert r.status_code == 200
        # login with new pin
        r2 = _login_emp('RMJ005', '4321')
        assert r2.status_code == 200
        # restore back to 0005 for other tests
        r3 = requests.post(f"{API}/employees/{target['id']}/set-pin", headers=owner_headers, json={"pin": "0005"}, timeout=30)
        assert r3.status_code == 200

    def test_set_pin_bad_length(self, owner_headers):
        emps = requests.get(f"{API}/employees", headers=owner_headers, timeout=30).json()
        target = emps[0]
        r = requests.post(f"{API}/employees/{target['id']}/set-pin", headers=owner_headers, json={"pin": "12"}, timeout=30)
        assert r.status_code == 400
        r2 = requests.post(f"{API}/employees/{target['id']}/set-pin", headers=owner_headers, json={"pin": "abcd"}, timeout=30)
        assert r2.status_code == 400


# ------- Attendance flows -------
def _emp_headers(code, pin):
    tok = _login_emp(code, pin).json()['access_token']
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


class TestAttendance:
    def test_me_today_default_empty_or_obj(self):
        h = _emp_headers('RMJ003', '0003')
        r = requests.get(f"{API}/attendance/me/today", headers=h, timeout=30)
        assert r.status_code == 200
        # It's an object (may be empty {} or an attendance doc if this ran earlier today)
        assert isinstance(r.json(), dict)

    def test_check_in_missing_selfie(self):
        h = _emp_headers('RMJ003', '0003')
        r = requests.post(f"{API}/attendance/check-in", headers=h, json={
            'latitude': STORE_LAT, 'longitude': STORE_LNG, 'selfie': ''
        }, timeout=30)
        assert r.status_code == 400

    def test_check_in_outside_geofence(self):
        h = _emp_headers('RMJ003', '0003')
        r = requests.post(f"{API}/attendance/check-in", headers=h, json={
            'latitude': 19.0760, 'longitude': 72.8777, 'selfie': _big_selfie()
        }, timeout=30)
        assert r.status_code == 400
        assert 'Outside' in r.json().get('detail', '')

    def test_full_check_in_and_check_out(self, owner_headers):
        # Use RMJ002 for full flow; may already have data today — handle both.
        h = _emp_headers('RMJ002', '0002')
        payload = {'latitude': STORE_LAT, 'longitude': STORE_LNG, 'selfie': _big_selfie()}
        r = requests.post(f"{API}/attendance/check-in", headers=h, json=payload, timeout=30)
        if r.status_code == 400 and 'Already' in r.json().get('detail', ''):
            pass  # already checked in earlier today
        else:
            assert r.status_code == 200, r.text
            assert r.json().get('ok') is True

        # Owner view today
        rt = requests.get(f"{API}/attendance/today", headers=owner_headers, timeout=30)
        assert rt.status_code == 200
        rows = rt.json()
        row = next(x for x in rows if x['employee_code'] == 'RMJ002')
        assert 'status' in row and 'is_late' in row and 'working_hours' in row
        assert row['status'] in ('present', 'half_day')

        # Check-out
        rc = requests.post(f"{API}/attendance/check-out", headers=h, json=payload, timeout=30)
        assert rc.status_code in (200, 400)  # 400 if already checked out
        if rc.status_code == 200:
            assert 'working_hours' in rc.json()

        # Live events
        rl = requests.get(f"{API}/attendance/live", headers=owner_headers, timeout=30)
        assert rl.status_code == 200
        assert isinstance(rl.json(), list)

    def test_check_out_without_check_in_fails(self):
        # Use RMJ005 fresh — if this fails intermittently because someone checked-in earlier, it's still valid
        h = _emp_headers('RMJ005', '0005')
        # first ensure NO check-in for me today by peeking
        me = requests.get(f"{API}/attendance/me/today", headers=h, timeout=30).json()
        if me.get('check_in'):
            pytest.skip('RMJ005 already checked in today; skipping negative check-out test')
        r = requests.post(f"{API}/attendance/check-out", headers=h, json={
            'latitude': STORE_LAT, 'longitude': STORE_LNG, 'selfie': _big_selfie()
        }, timeout=30)
        assert r.status_code == 400


# ------- Corrections -------
class TestCorrections:
    def test_create_list_decide(self, owner_headers):
        h = _emp_headers('RMJ003', '0003')
        # create
        r = requests.post(f"{API}/attendance/corrections", headers=h, json={
            'reason_type': 'forgot_check_in', 'note': 'TEST correction'
        }, timeout=30)
        assert r.status_code == 200, r.text
        cid = r.json()['id']
        assert r.json()['status'] == 'pending'

        # employee list -> sees own
        rl = requests.get(f"{API}/attendance/corrections", headers=h, timeout=30)
        assert rl.status_code == 200
        assert any(x['id'] == cid for x in rl.json())

        # owner sees pending
        ro = requests.get(f"{API}/attendance/corrections?status=pending", headers=owner_headers, timeout=30)
        assert ro.status_code == 200
        assert any(x['id'] == cid for x in ro.json())

        # approve
        rd = requests.post(f"{API}/attendance/corrections/{cid}/decide", headers=owner_headers, json={'action': 'approve'}, timeout=30)
        assert rd.status_code == 200
        assert rd.json()['status'] == 'approved'

        # decide again -> 400
        rd2 = requests.post(f"{API}/attendance/corrections/{cid}/decide", headers=owner_headers, json={'action': 'approve'}, timeout=30)
        assert rd2.status_code == 400


# ------- Leaves -------
class TestLeaves:
    def test_create_and_approve(self, owner_headers):
        h = _emp_headers('RMJ003', '0003')
        r = requests.post(f"{API}/leaves", headers=h, json={
            'from_date': '2026-02-01', 'to_date': '2026-02-02',
            'leave_type': 'casual', 'reason': 'TEST leave'
        }, timeout=30)
        assert r.status_code == 200, r.text
        lid = r.json()['id']

        rl = requests.get(f"{API}/leaves", headers=h, timeout=30)
        assert rl.status_code == 200 and any(x['id'] == lid for x in rl.json())

        rd = requests.post(f"{API}/leaves/{lid}/decide", headers=owner_headers, json={'action': 'approve'}, timeout=30)
        assert rd.status_code == 200 and rd.json()['status'] == 'approved'

        # Timeline event added on employee
        emps = requests.get(f"{API}/employees", headers=owner_headers, timeout=30).json()
        eid = next(e for e in emps if e['employee_code'] == 'RMJ003')['id']
        prof = requests.get(f"{API}/employees/{eid}", headers=owner_headers, timeout=30).json()
        assert any(t['type'] == 'leave' for t in prof['timeline'])


# ------- Dashboard reflects live -------
class TestDashboardCounts:
    def test_pending_approvals_present(self, owner_headers):
        r = requests.get(f"{API}/dashboard", headers=owner_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert 'attendance_corrections' in d['pending_approvals']
        assert 'leave_requests' in d['pending_approvals']
        assert isinstance(d['todays_attendance']['missing_punch'], int)
