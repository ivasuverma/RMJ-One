"""RMJ One — Milestone 2B backend tests.

Covers: admin/accountant login, users CRUD (owner-only), shifts, holidays, ledger,
payroll compute/save/get/lock/unlock/pay/pdf, and RBAC boundaries.
"""
import os
import uuid
import datetime as dt
import pytest
import requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"


def _login(username: str, password: str):
    return requests.post(f"{API}/auth/login", json={'username': username, 'password': password}, timeout=30)


def _hdr(tok: str):
    return {'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'}


@pytest.fixture(scope='session')
def owner_tok():
    r = _login('owner', 'Owner@123')
    assert r.status_code == 200, r.text
    return r.json()['access_token']


@pytest.fixture(scope='session')
def admin_tok():
    r = _login('admin', 'Admin@123')
    assert r.status_code == 200, r.text
    return r.json()['access_token']


@pytest.fixture(scope='session')
def accountant_tok():
    r = _login('accountant', 'Accountant@123')
    assert r.status_code == 200, r.text
    return r.json()['access_token']


# ---------- Roles / Users ----------
class TestRolesAuth:
    def test_admin_login_role(self):
        r = _login('admin', 'Admin@123')
        assert r.status_code == 200, r.text
        j = r.json()
        assert j['user']['role'] == 'admin'
        assert 'access_token' in j
        assert '_id' not in str(j) and 'password_hash' not in str(j)

    def test_accountant_login_role(self):
        r = _login('accountant', 'Accountant@123')
        assert r.status_code == 200, r.text
        assert r.json()['user']['role'] == 'accountant'

    def test_wrong_password(self):
        assert _login('admin', 'wrong').status_code == 401

    def test_me_admin(self, admin_tok):
        r = requests.get(f"{API}/auth/me", headers=_hdr(admin_tok), timeout=30)
        assert r.status_code == 200
        assert r.json()['role'] == 'admin'
        assert 'password_hash' not in str(r.json())

    def test_me_accountant(self, accountant_tok):
        r = requests.get(f"{API}/auth/me", headers=_hdr(accountant_tok), timeout=30)
        assert r.status_code == 200
        assert r.json()['role'] == 'accountant'


class TestUsersMgmt:
    def test_list_users_owner_only(self, owner_tok, admin_tok, accountant_tok):
        r = requests.get(f"{API}/users", headers=_hdr(owner_tok), timeout=30)
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 3
        assert any(u['username'] == 'owner' for u in arr)
        assert any(u['username'] == 'admin' for u in arr)
        assert any(u['username'] == 'accountant' for u in arr)
        assert 'password_hash' not in str(arr)
        assert requests.get(f"{API}/users", headers=_hdr(admin_tok), timeout=30).status_code == 403
        assert requests.get(f"{API}/users", headers=_hdr(accountant_tok), timeout=30).status_code == 403

    def test_create_delete_admin_owner_only(self, owner_tok, admin_tok):
        # admin cannot
        payload = {'username': f'TEST_a_{uuid.uuid4().hex[:6]}', 'name': 'TEST admin',
                   'role': 'admin', 'password': 'Pass@123'}
        r = requests.post(f"{API}/users", headers=_hdr(admin_tok), json=payload, timeout=30)
        assert r.status_code == 403

        # owner can
        r2 = requests.post(f"{API}/users", headers=_hdr(owner_tok), json=payload, timeout=30)
        assert r2.status_code == 200, r2.text
        uid = r2.json()['id']
        assert r2.json()['role'] == 'admin'
        assert 'password_hash' not in str(r2.json())

        # PUT
        upd = requests.put(f"{API}/users/{uid}", headers=_hdr(owner_tok), json={'name': 'TEST renamed'}, timeout=30)
        assert upd.status_code == 200 and upd.json()['name'] == 'TEST renamed'

        # login with new user
        rl = _login(payload['username'], 'Pass@123')
        assert rl.status_code == 200

        # delete
        rd = requests.delete(f"{API}/users/{uid}", headers=_hdr(owner_tok), timeout=30)
        assert rd.status_code == 200

    def test_cannot_delete_owner(self, owner_tok):
        arr = requests.get(f"{API}/users", headers=_hdr(owner_tok), timeout=30).json()
        owner_user = next(u for u in arr if u['role'] == 'owner')
        r = requests.delete(f"{API}/users/{owner_user['id']}", headers=_hdr(owner_tok), timeout=30)
        assert r.status_code == 400


class TestEmployeeRBAC:
    def test_admin_can_create_employee(self, admin_tok, owner_tok):
        r = requests.post(f"{API}/employees", headers=_hdr(admin_tok),
                          json={'name': f'TEST_admin_emp_{uuid.uuid4().hex[:4]}', 'salary': 15000}, timeout=30)
        assert r.status_code == 200, r.text
        eid = r.json()['id']
        # cleanup
        requests.delete(f"{API}/employees/{eid}", headers=_hdr(owner_tok), timeout=30)

    def test_accountant_cannot_create_employee(self, accountant_tok):
        r = requests.post(f"{API}/employees", headers=_hdr(accountant_tok),
                          json={'name': 'TEST_forbidden', 'salary': 1000}, timeout=30)
        assert r.status_code == 403


# ---------- Shifts ----------
class TestShifts:
    def test_list_and_crud(self, owner_tok, admin_tok):
        # any authed can list
        r = requests.get(f"{API}/shifts", headers=_hdr(admin_tok), timeout=30)
        assert r.status_code == 200
        arr = r.json()
        names = {s['name'] for s in arr}
        assert {'General', 'Morning', 'Night'}.issubset(names)
        assert '_id' not in str(arr)

        # admin cannot create
        payload = {'name': f'TEST_shift_{uuid.uuid4().hex[:4]}', 'start': '14:00', 'end': '22:00'}
        r2 = requests.post(f"{API}/shifts", headers=_hdr(admin_tok), json=payload, timeout=30)
        assert r2.status_code == 403

        # owner can create + delete
        r3 = requests.post(f"{API}/shifts", headers=_hdr(owner_tok), json=payload, timeout=30)
        assert r3.status_code == 200
        sid = r3.json()['id']
        # verify persistence
        listed = requests.get(f"{API}/shifts", headers=_hdr(owner_tok), timeout=30).json()
        assert any(s['id'] == sid for s in listed)
        rd = requests.delete(f"{API}/shifts/{sid}", headers=_hdr(owner_tok), timeout=30)
        assert rd.status_code == 200


# ---------- Holidays ----------
class TestHolidays:
    def test_list_and_crud(self, owner_tok):
        r = requests.get(f"{API}/holidays", headers=_hdr(owner_tok), timeout=30)
        assert r.status_code == 200
        arr = r.json()
        names = ' '.join(h.get('name', '') for h in arr)
        assert 'Republic' in names and 'Independence' in names

        payload = {'name': f'TEST_hol_{uuid.uuid4().hex[:4]}', 'date': '2026-06-15'}
        r2 = requests.post(f"{API}/holidays", headers=_hdr(owner_tok), json=payload, timeout=30)
        assert r2.status_code == 200
        hid = r2.json()['id']
        rd = requests.delete(f"{API}/holidays/{hid}", headers=_hdr(owner_tok), timeout=30)
        assert rd.status_code == 200


# ---------- Ledger ----------
class TestLedger:
    def test_add_and_running_balance(self, owner_tok, accountant_tok):
        emps = requests.get(f"{API}/employees", headers=_hdr(owner_tok), timeout=30).json()
        target = next(e for e in emps if e['employee_code'] == 'RMJ002')
        eid = target['id']

        # snapshot closing before
        pre = requests.get(f"{API}/ledger/{eid}", headers=_hdr(owner_tok), timeout=30)
        assert pre.status_code == 200
        pre_close = float(pre.json().get('closing_balance', 0))

        # accountant can add
        r1 = requests.post(f"{API}/ledger/entries", headers=_hdr(accountant_tok), json={
            'employee_id': eid, 'entry_type': 'bonus', 'amount': 500, 'note': 'TEST bonus'
        }, timeout=30)
        assert r1.status_code == 200, r1.text
        r2 = requests.post(f"{API}/ledger/entries", headers=_hdr(accountant_tok), json={
            'employee_id': eid, 'entry_type': 'advance', 'amount': 200, 'note': 'TEST advance'
        }, timeout=30)
        assert r2.status_code == 200

        got = requests.get(f"{API}/ledger/{eid}", headers=_hdr(owner_tok), timeout=30)
        assert got.status_code == 200
        data = got.json()
        assert 'entries' in data and 'closing_balance' in data
        assert isinstance(data['entries'], list)
        # sorted newest first
        if len(data['entries']) >= 2:
            first_ts = data['entries'][0]['created_at']
            second_ts = data['entries'][1]['created_at']
            assert first_ts >= second_ts
        # running balance changed by +500 -200 = +300
        assert round(float(data['closing_balance']) - pre_close, 2) == 300.00

    def test_ledger_unknown_emp(self, owner_tok):
        r = requests.get(f"{API}/ledger/nonexistent-xyz", headers=_hdr(owner_tok), timeout=30)
        assert r.status_code == 404


# ---------- Payroll ----------
class TestPayroll:
    @pytest.fixture(scope='class')
    def period(self):
        # use a period far from current to keep test data isolated
        return {'year': 2025, 'month': 11}

    def test_compute_rows_shape(self, accountant_tok, period):
        r = requests.post(f"{API}/payroll/compute", headers=_hdr(accountant_tok), json=period, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert 'rows' in d and 'total_net' in d
        assert isinstance(d['rows'], list) and len(d['rows']) >= 5
        keys = {'employee_id', 'name', 'base_salary', 'present_days', 'half_days',
                'sunday_work', 'leave_days', 'effective_days', 'earned', 'bonus',
                'advance', 'fine', 'manual_deduction', 'net_salary'}
        assert keys.issubset(set(d['rows'][0].keys()))

    def test_admin_cannot_compute_or_save(self, admin_tok, period):
        r = requests.post(f"{API}/payroll/compute", headers=_hdr(admin_tok), json=period, timeout=30)
        assert r.status_code == 403
        r2 = requests.post(f"{API}/payroll/save", headers=_hdr(admin_tok), json=period, timeout=30)
        assert r2.status_code == 403

    def test_save_get_lock_reject_resave_unlock(self, owner_tok, accountant_tok, period):
        y, m = period['year'], period['month']

        # ensure unlocked before saving; owner can always unlock (may 404 return-ok)
        requests.post(f"{API}/payroll/{y}/{m}/unlock", headers=_hdr(owner_tok), timeout=30)

        # accountant can save
        rs = requests.post(f"{API}/payroll/save", headers=_hdr(accountant_tok), json=period, timeout=60)
        assert rs.status_code == 200, rs.text
        assert rs.json().get('ok') is True

        # GET returns saved rows
        rg = requests.get(f"{API}/payroll/{y}/{m}", headers=_hdr(accountant_tok), timeout=30)
        assert rg.status_code == 200
        gd = rg.json()
        assert gd.get('saved') is True and gd.get('locked') is False
        assert len(gd['rows']) >= 5
        entry_id = gd['rows'][0]['id']

        # Re-save allowed while unlocked
        rs2 = requests.post(f"{API}/payroll/save", headers=_hdr(accountant_tok), json=period, timeout=60)
        assert rs2.status_code == 200

        # Lock
        rl = requests.post(f"{API}/payroll/{y}/{m}/lock", headers=_hdr(accountant_tok), timeout=30)
        assert rl.status_code == 200

        # Re-save blocked
        rs3 = requests.post(f"{API}/payroll/save", headers=_hdr(accountant_tok), json=period, timeout=30)
        assert rs3.status_code == 400

        # Accountant cannot unlock (owner-only)
        ru = requests.post(f"{API}/payroll/{y}/{m}/unlock", headers=_hdr(accountant_tok), timeout=30)
        assert ru.status_code == 403

        # Owner unlocks
        ru2 = requests.post(f"{API}/payroll/{y}/{m}/unlock", headers=_hdr(owner_tok), timeout=30)
        assert ru2.status_code == 200

        # Post-unlock state
        rg2 = requests.get(f"{API}/payroll/{y}/{m}", headers=_hdr(owner_tok), timeout=30).json()
        assert rg2['locked'] is False

    def test_mark_paid_and_timeline(self, owner_tok, accountant_tok, period):
        y, m = period['year'], period['month']
        rg = requests.get(f"{API}/payroll/{y}/{m}", headers=_hdr(accountant_tok), timeout=30).json()
        # pick an unpaid entry
        unpaid = [r for r in rg['rows'] if not r.get('paid')]
        assert unpaid, 'no unpaid entries to test with'
        entry = unpaid[0]
        eid = entry['id']
        emp_id = entry['employee_id']

        rp = requests.post(f"{API}/payroll/entry/{eid}/pay", headers=_hdr(accountant_tok), timeout=30)
        assert rp.status_code == 200
        assert rp.json().get('paid') is True

        # timeline event added
        prof = requests.get(f"{API}/employees/{emp_id}", headers=_hdr(owner_tok), timeout=30).json()
        assert any(t['type'] == 'salary' for t in prof['timeline'])

    def test_pdf_returned(self, accountant_tok, period):
        y, m = period['year'], period['month']
        rg = requests.get(f"{API}/payroll/{y}/{m}", headers=_hdr(accountant_tok), timeout=30).json()
        eid = rg['rows'][0]['id']
        r = requests.get(f"{API}/payroll/entry/{eid}/pdf", headers=_hdr(accountant_tok), timeout=60)
        assert r.status_code == 200
        assert r.headers.get('content-type', '').startswith('application/pdf')
        assert len(r.content) > 500
        assert r.content[:4] == b'%PDF'

    def test_preview_when_no_saved(self, owner_tok):
        # use a distant future period unlikely to have saved rows
        r = requests.get(f"{API}/payroll/2030/6", headers=_hdr(owner_tok), timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d['saved'] is False
        assert isinstance(d['rows'], list) and len(d['rows']) >= 5
