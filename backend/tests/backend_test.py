"""RMJ One — backend regression tests (pytest)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://rmj-nexus.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope='session')
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()['access_token']


@pytest.fixture(scope='session')
def auth_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}


# ---- Auth ----
class TestAuth:
    def test_login_ok(self):
        r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert 'access_token' in data
        assert data['user']['role'] == 'owner'
        assert data['user']['username'] == 'owner'
        assert '_id' not in str(data)

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_me_ok(self, auth_headers):
        r = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert r.json()['role'] == 'owner'

    def test_me_missing_token(self):
        r = requests.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 401

    def test_me_invalid_token(self):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer garbage"}, timeout=30)
        assert r.status_code == 401


# ---- Dashboard ----
class TestDashboard:
    def test_dashboard_shape(self, auth_headers):
        r = requests.get(f"{API}/dashboard", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        # Payroll moved off the dashboard; it now summarises each business module.
        for k in ['todays_attendance', 'pending_approvals', 'repairs_summary', 'tasks_summary',
                  'samples_summary', 'cashbook_summary', 'business_summary', 'recent_activity', 'documents_pending']:
            assert k in d
        att = d['todays_attendance']
        for f in ['present', 'absent', 'late', 'half_day', 'missing_punch', 'leave', 'working']:
            assert f in att and isinstance(att[f], (int, float))
        for f in ['attendance_corrections', 'leave_requests']:
            assert f in d['pending_approvals']


# ---- Employees ----
class TestEmployees:
    def test_list_seeded(self, auth_headers):
        r = requests.get(f"{API}/employees", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 5
        assert all('_id' not in e and 'password_hash' not in e for e in arr)

    def test_list_search(self, auth_headers):
        r = requests.get(f"{API}/employees?q=Rahul", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        arr = r.json()
        assert any('Rahul' in e['name'] for e in arr)

    def test_list_filter_on_leave(self, auth_headers):
        r = requests.get(f"{API}/employees?status=on_leave", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        arr = r.json()
        assert all(e['status'] == 'on_leave' for e in arr)
        assert len(arr) >= 1

    def test_get_employee_with_timeline(self, auth_headers):
        r = requests.get(f"{API}/employees", headers=auth_headers, timeout=30)
        eid = r.json()[0]['id']
        r2 = requests.get(f"{API}/employees/{eid}", headers=auth_headers, timeout=30)
        assert r2.status_code == 200
        body = r2.json()
        assert 'employee' in body and 'timeline' in body
        assert isinstance(body['timeline'], list)

    def test_get_employee_404(self, auth_headers):
        r = requests.get(f"{API}/employees/does-not-exist-{uuid.uuid4()}", headers=auth_headers, timeout=30)
        assert r.status_code == 404

    def test_crud_flow(self, auth_headers):
        # create with just name -> auto code + joined timeline
        payload = {"name": f"TEST_Emp_{uuid.uuid4().hex[:6]}", "salary": 20000}
        r = requests.post(f"{API}/employees", headers=auth_headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        emp = r.json()
        assert emp['employee_code'].startswith('RMJ')
        eid = emp['id']

        # GET verifies persistence (the profile no longer returns a timeline)
        r2 = requests.get(f"{API}/employees/{eid}", headers=auth_headers, timeout=30)
        assert r2.status_code == 200
        assert r2.json()['employee']['name'] == payload['name']

        # Update salary
        upd = {**payload, "salary": 25000}
        r3 = requests.put(f"{API}/employees/{eid}", headers=auth_headers, json=upd, timeout=30)
        assert r3.status_code == 200
        assert float(r3.json()['salary']) == 25000

        r4 = requests.get(f"{API}/employees/{eid}", headers=auth_headers, timeout=30)
        assert float(r4.json()['employee']['salary']) == 25000

        # Delete
        r5 = requests.delete(f"{API}/employees/{eid}", headers=auth_headers, timeout=30)
        assert r5.status_code == 200

        r6 = requests.get(f"{API}/employees/{eid}", headers=auth_headers, timeout=30)
        assert r6.status_code == 404

    def test_delete_blocked_with_history(self, auth_headers):
        # Seeded RMJ001 has a bonus on its timeline — real history, so delete must refuse.
        emps = requests.get(f"{API}/employees", headers=auth_headers, timeout=30).json()
        rmj001 = next(e for e in emps if e['employee_code'] == 'RMJ001')
        r = requests.delete(f"{API}/employees/{rmj001['id']}", headers=auth_headers, timeout=30)
        assert r.status_code == 400

    def test_create_requires_owner(self, auth_headers):
        # sanity: owner token succeeds
        r = requests.post(f"{API}/employees", headers=auth_headers, json={"name": f"TEST_perm_{uuid.uuid4().hex[:4]}"}, timeout=30)
        assert r.status_code == 200
        # cleanup
        requests.delete(f"{API}/employees/{r.json()['id']}", headers=auth_headers, timeout=30)

    def test_no_mongo_id_leak(self, auth_headers):
        r = requests.get(f"{API}/employees", headers=auth_headers, timeout=30)
        for e in r.json():
            assert '_id' not in e
