"""M3 backend tests: attendance calendar/day-edit, payroll enhancements, reports, audit."""
import os
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://rmj-nexus.preview.emergentagent.com').rstrip('/')


def _login(username: str, password: str) -> str:
    r = requests.post(f'{BASE_URL}/api/auth/login', json={'username': username, 'password': password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()['access_token']


def _emp_login(code: str, pin: str) -> tuple:
    r = requests.post(f'{BASE_URL}/api/auth/employee-login', json={'employee_code': code, 'pin': pin}, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    return j['access_token'], j['user']


@pytest.fixture(scope='module')
def owner_h():
    return {'Authorization': f'Bearer {_login("owner", "Owner@123")}'}


@pytest.fixture(scope='module')
def admin_h():
    return {'Authorization': f'Bearer {_login("admin", "Admin@123")}'}


@pytest.fixture(scope='module')
def acc_h():
    return {'Authorization': f'Bearer {_login("accountant", "Accountant@123")}'}


@pytest.fixture(scope='module')
def emp1():
    tok, u = _emp_login('RMJ001', '0001')
    return {'h': {'Authorization': f'Bearer {tok}'}, 'user': u}


@pytest.fixture(scope='module')
def emp2():
    tok, u = _emp_login('RMJ002', '0002')
    return {'h': {'Authorization': f'Bearer {tok}'}, 'user': u}


@pytest.fixture(scope='module')
def emp_id_by_code(owner_h):
    r = requests.get(f'{BASE_URL}/api/employees', headers=owner_h, timeout=30)
    return {e['employee_code']: e['id'] for e in r.json()}


# ============= AUTH / REGRESSION =============
class TestAuthRoles:
    def test_owner_login(self):
        r = requests.post(f'{BASE_URL}/api/auth/login', json={'username': 'owner', 'password': 'Owner@123'})
        assert r.status_code == 200 and r.json()['user']['role'] == 'owner'

    def test_admin_login(self):
        r = requests.post(f'{BASE_URL}/api/auth/login', json={'username': 'admin', 'password': 'Admin@123'})
        assert r.status_code == 200 and r.json()['user']['role'] == 'admin'

    def test_accountant_login(self):
        r = requests.post(f'{BASE_URL}/api/auth/login', json={'username': 'accountant', 'password': 'Accountant@123'})
        assert r.status_code == 200 and r.json()['user']['role'] == 'accountant'

    def test_employee_login(self):
        r = requests.post(f'{BASE_URL}/api/auth/employee-login', json={'employee_code': 'RMJ001', 'pin': '0001'})
        assert r.status_code == 200 and r.json()['user']['role'] == 'employee'


# ============= ATTENDANCE CALENDAR =============
class TestCalendar:
    def test_calendar_feb_2026_28_days(self, admin_h, emp_id_by_code):
        eid = emp_id_by_code['RMJ001']
        r = requests.get(f'{BASE_URL}/api/attendance/calendar/{eid}?year=2026&month=2', headers=admin_h)
        assert r.status_code == 200
        j = r.json()
        assert 'days' in j and len(j['days']) == 28
        d = j['days'][0]
        for key in ('date', 'status', 'is_sunday', 'holiday_name', 'check_in', 'check_out'):
            assert key in d

    def test_calendar_employee_own(self, emp1, emp_id_by_code):
        eid = emp_id_by_code['RMJ001']
        r = requests.get(f'{BASE_URL}/api/attendance/calendar/{eid}?year=2026&month=2', headers=emp1['h'])
        assert r.status_code == 200

    def test_calendar_employee_other_forbidden(self, emp1, emp_id_by_code):
        eid = emp_id_by_code['RMJ002']
        r = requests.get(f'{BASE_URL}/api/attendance/calendar/{eid}?year=2026&month=2', headers=emp1['h'])
        assert r.status_code == 403


class TestDayEdit:
    D = '2026-02-15'

    def test_admin_upserts_day(self, admin_h, emp_id_by_code):
        eid = emp_id_by_code['RMJ001']
        body = {'status': 'present', 'check_in_time': '10:15', 'check_out_time': '19:30'}
        r = requests.put(f'{BASE_URL}/api/attendance/day/{eid}/{self.D}', json=body, headers=admin_h)
        assert r.status_code == 200, r.text
        # Verify calendar reflects times
        r2 = requests.get(f'{BASE_URL}/api/attendance/calendar/{eid}?year=2026&month=2', headers=admin_h)
        day = next(d for d in r2.json()['days'] if d['date'] == self.D)
        assert day['status'] == 'present'
        assert day['check_in'] is not None and day['check_out'] is not None

    def test_employee_cannot_put_day(self, emp1, emp_id_by_code):
        eid = emp_id_by_code['RMJ001']
        r = requests.put(f'{BASE_URL}/api/attendance/day/{eid}/2026-02-16',
                          json={'status': 'present'}, headers=emp1['h'])
        assert r.status_code == 403


class TestCalendarCorrection:
    D = '2026-02-20'

    def test_employee_create_calendar_correction(self, emp1):
        body = {'date': self.D, 'desired_check_in': '10:05', 'desired_check_out': '19:45',
                'reason_type': 'forgot_check_in', 'note': 'traffic'}
        r = requests.post(f'{BASE_URL}/api/attendance/corrections/calendar', json=body, headers=emp1['h'])
        assert r.status_code == 200, r.text
        j = r.json()
        assert j['status'] == 'pending' and j['desired_check_in'] == '10:05'
        TestCalendarCorrection.cid = j['id']

    def test_owner_approve_reflects_in_calendar(self, owner_h, emp1, emp_id_by_code):
        cid = TestCalendarCorrection.cid
        r = requests.post(f'{BASE_URL}/api/attendance/corrections/{cid}/decide',
                          json={'action': 'approve'}, headers=owner_h)
        assert r.status_code == 200
        eid = emp_id_by_code['RMJ001']
        r2 = requests.get(f'{BASE_URL}/api/attendance/calendar/{eid}?year=2026&month=2', headers=owner_h)
        day = next(d for d in r2.json()['days'] if d['date'] == self.D)
        assert day['check_in'] is not None
        assert day['check_out'] is not None


# ============= PAYROLL =============
class TestPayroll:
    def test_compute_has_opening_balance(self, acc_h):
        r = requests.post(f'{BASE_URL}/api/payroll/compute', json={'year': 2026, 'month': 2}, headers=acc_h)
        assert r.status_code == 200, r.text
        j = r.json()
        assert 'rows' in j and len(j['rows']) > 0
        for row in j['rows']:
            assert 'opening_balance' in row

    def test_opening_balance_from_prior_month(self, owner_h, acc_h, emp_id_by_code):
        eid = emp_id_by_code['RMJ003']
        # Add ledger entry in prior month (Jan 2026)
        r = requests.post(f'{BASE_URL}/api/ledger/entries', json={
            'employee_id': eid, 'entry_type': 'advance', 'amount': 1000,
            'date': '2026-01-15T10:00:00', 'note': 'prior month advance'
        }, headers=owner_h)
        assert r.status_code == 200
        # Add entry in Feb 2026 (should not affect opening balance)
        r = requests.post(f'{BASE_URL}/api/ledger/entries', json={
            'employee_id': eid, 'entry_type': 'advance', 'amount': 500,
            'date': '2026-02-10T10:00:00', 'note': 'in-month advance'
        }, headers=owner_h)
        assert r.status_code == 200
        # Compute payroll for Feb 2026
        r = requests.post(f'{BASE_URL}/api/payroll/compute', json={'year': 2026, 'month': 2}, headers=acc_h)
        row = next(x for x in r.json()['rows'] if x['employee_id'] == eid)
        # opening includes prior-month advance (negative)
        assert row['opening_balance'] <= -1000  # at least -1000 (advance)
        # in-month advance shows up in row['advance']
        assert row['advance'] >= 500

    def test_save_and_update_entry(self, acc_h, owner_h, emp_id_by_code):
        # Unlock in case previously locked
        requests.post(f'{BASE_URL}/api/payroll/2026/2/unlock', headers=owner_h)
        r = requests.post(f'{BASE_URL}/api/payroll/save', json={'year': 2026, 'month': 2}, headers=acc_h)
        assert r.status_code == 200
        # Get saved entries
        r = requests.get(f'{BASE_URL}/api/payroll/2026/2', headers=acc_h)
        rows = r.json()['rows']
        entry_id = rows[0]['id']
        TestPayroll.entry_id = entry_id
        # Update with overrides
        upd = {'bonus_override': 500, 'fine_override': 100, 'manual_deduction_override': 50,
               'note': 'override test', 'payment_mode': 'upi'}
        r = requests.put(f'{BASE_URL}/api/payroll/entry/{entry_id}', json=upd, headers=acc_h)
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated['bonus'] == 500 and updated['fine'] == 100
        assert updated['payment_mode'] == 'upi' and updated['note'] == 'override test'
        # net_salary should have been recomputed
        assert 'net_salary' in updated

    def test_update_locked_month_400(self, acc_h, owner_h):
        # Lock
        r = requests.post(f'{BASE_URL}/api/payroll/2026/2/lock', headers=owner_h)
        assert r.status_code == 200
        r = requests.put(f'{BASE_URL}/api/payroll/entry/{TestPayroll.entry_id}',
                          json={'bonus_override': 999}, headers=acc_h)
        assert r.status_code == 400
        # Unlock for cleanup
        requests.post(f'{BASE_URL}/api/payroll/2026/2/unlock', headers=owner_h)

    def test_pdf_contains_sections(self, acc_h):
        r = requests.get(f'{BASE_URL}/api/payroll/entry/{TestPayroll.entry_id}/pdf', headers=acc_h)
        assert r.status_code == 200
        assert r.headers.get('content-type', '').startswith('application/pdf')
        body = r.content
        assert body[:4] == b'%PDF'
        # Extract text (reportlab compresses streams, so we need to decode)
        from io import BytesIO
        from pypdf import PdfReader
        reader = PdfReader(BytesIO(body))
        text = '\n'.join(p.extract_text() or '' for p in reader.pages)
        assert 'EARNINGS' in text, f'EARNINGS missing in PDF text: {text[:500]}'
        assert 'DEDUCTIONS' in text, f'DEDUCTIONS missing in PDF text'
        assert 'Payment mode' in text, f'Payment mode missing in PDF text'


# ============= REPORTS =============
class TestReports:
    def test_attendance_pdf(self, owner_h):
        r = requests.get(f'{BASE_URL}/api/reports/attendance/pdf?from_date=2026-02-01&to_date=2026-02-28', headers=owner_h)
        assert r.status_code == 200 and r.headers['content-type'].startswith('application/pdf')
        assert r.content[:4] == b'%PDF'

    def test_late_pdf(self, owner_h):
        r = requests.get(f'{BASE_URL}/api/reports/late/pdf?from_date=2026-02-01&to_date=2026-02-28', headers=owner_h)
        assert r.status_code == 200 and r.content[:4] == b'%PDF'

    def test_missing_punch_pdf(self, owner_h):
        r = requests.get(f'{BASE_URL}/api/reports/missing_punch/pdf?from_date=2026-02-01&to_date=2026-02-28', headers=owner_h)
        assert r.status_code == 200 and r.content[:4] == b'%PDF'

    def test_leave_pdf(self, owner_h):
        r = requests.get(f'{BASE_URL}/api/reports/leave/pdf?from_date=2026-02-01&to_date=2026-02-28', headers=owner_h)
        assert r.status_code == 200 and r.content[:4] == b'%PDF'

    def test_payroll_pdf(self, owner_h):
        r = requests.get(f'{BASE_URL}/api/reports/payroll/pdf?year=2026&month=2', headers=owner_h)
        assert r.status_code == 200 and r.content[:4] == b'%PDF'

    def test_payroll_pdf_missing_year_month_400(self, owner_h):
        r = requests.get(f'{BASE_URL}/api/reports/payroll/pdf', headers=owner_h)
        assert r.status_code == 400

    def test_ledger_pdf(self, owner_h, emp_id_by_code):
        eid = emp_id_by_code['RMJ001']
        r = requests.get(f'{BASE_URL}/api/reports/ledger/pdf?employee_id={eid}', headers=owner_h)
        assert r.status_code == 200 and r.content[:4] == b'%PDF'

    def test_ledger_pdf_missing_emp_400(self, owner_h):
        r = requests.get(f'{BASE_URL}/api/reports/ledger/pdf', headers=owner_h)
        assert r.status_code == 400

    def test_unknown_report_400(self, owner_h):
        r = requests.get(f'{BASE_URL}/api/reports/unknown/pdf', headers=owner_h)
        assert r.status_code == 400


# ============= AUDIT =============
class TestAudit:
    def test_owner_can_view_audit(self, owner_h):
        r = requests.get(f'{BASE_URL}/api/audit/logs', headers=owner_h)
        assert r.status_code == 200
        logs = r.json()
        assert isinstance(logs, list)
        # After previous tests we should have audit entries
        actions = [l.get('action') for l in logs]
        # At least one from earlier tests
        assert any(a for a in actions), f'audit logs empty: {logs}'

    def test_admin_cannot_view_audit(self, admin_h):
        r = requests.get(f'{BASE_URL}/api/audit/logs', headers=admin_h)
        assert r.status_code == 403

    def test_accountant_cannot_view_audit(self, acc_h):
        r = requests.get(f'{BASE_URL}/api/audit/logs', headers=acc_h)
        assert r.status_code == 403
