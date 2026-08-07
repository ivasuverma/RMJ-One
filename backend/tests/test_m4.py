"""RMJ One M4 backend tests: Biometric + AI Assistant."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://rmj-nexus.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"


# ---------------- Fixtures ----------------
@pytest.fixture(scope='session')
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()['access_token']


@pytest.fixture(scope='session')
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "Admin@123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()['access_token']


@pytest.fixture(scope='session')
def accountant_token():
    r = requests.post(f"{API}/auth/login", json={"username": "accountant", "password": "Accountant@123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()['access_token']


@pytest.fixture(scope='session')
def emp_token():
    # RMJ005 Neha (active) — used for employee ACL checks
    r = requests.post(f"{API}/auth/employee-login", json={"employee_code": "RMJ005", "pin": "0005"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()['access_token']


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------------- Biometric Devices CRUD ----------------
class TestBiometricDevices:
    serial = f"TEST-SN-{uuid.uuid4().hex[:8].upper()}"
    secret = "supersecret-42"
    device_id = None

    def test_admin_cannot_create_device(self, admin_token):
        r = requests.post(f"{API}/biometric/devices", headers=hdr(admin_token),
                          json={"serial": "X-ADMIN", "label": "L", "secret": "s"}, timeout=10)
        assert r.status_code == 403, r.text

    def test_accountant_cannot_create_device(self, accountant_token):
        r = requests.post(f"{API}/biometric/devices", headers=hdr(accountant_token),
                          json={"serial": "X-ACC", "label": "L", "secret": "s"}, timeout=10)
        assert r.status_code == 403, r.text

    def test_owner_creates_device(self, owner_token):
        r = requests.post(f"{API}/biometric/devices", headers=hdr(owner_token),
                          json={"serial": self.serial, "label": "TEST_gate", "secret": self.secret}, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data['serial'] == self.serial
        assert data['label'] == "TEST_gate"
        assert 'secret' not in data, "Secret should be hidden in response"
        assert 'id' in data
        TestBiometricDevices.device_id = data['id']

    def test_duplicate_serial_400(self, owner_token):
        r = requests.post(f"{API}/biometric/devices", headers=hdr(owner_token),
                          json={"serial": self.serial, "label": "dup", "secret": "x"}, timeout=10)
        assert r.status_code == 400, r.text

    def test_list_devices_hides_secret(self, admin_token):
        r = requests.get(f"{API}/biometric/devices", headers=hdr(admin_token), timeout=10)
        assert r.status_code == 200
        devs = r.json()
        assert isinstance(devs, list) and len(devs) >= 1
        for d in devs:
            assert 'secret' not in d, "Secret must NOT be exposed in list"
        assert any(d['serial'] == self.serial for d in devs)


# ---------------- Biometric Push ----------------
class TestBiometricPush:
    """Uses device from TestBiometricDevices (same serial/secret) and RMJ005."""
    serial = TestBiometricDevices.serial
    secret = TestBiometricDevices.secret
    emp_code = "RMJ005"

    def test_push_wrong_secret_401(self):
        r = requests.post(f"{API}/biometric/push", json={
            "serial": self.serial, "secret": "WRONG", "user_id": self.emp_code, "event_type": "auto"
        }, timeout=10)
        assert r.status_code == 401
        # Check log entry
        # (Fetched below in test_logs_contain_rejected)

    def test_push_unknown_employee_404(self):
        r = requests.post(f"{API}/biometric/push", json={
            "serial": self.serial, "secret": self.secret, "user_id": "RMJ999", "event_type": "auto"
        }, timeout=10)
        assert r.status_code == 404

    def test_push_checkout_before_checkin_400(self):
        r = requests.post(f"{API}/biometric/push", json={
            "serial": self.serial, "secret": self.secret, "user_id": self.emp_code, "event_type": "check_out"
        }, timeout=10)
        assert r.status_code == 400

    def test_first_push_creates_checkin(self, owner_token):
        r = requests.post(f"{API}/biometric/push", json={
            "serial": self.serial, "secret": self.secret, "user_id": self.emp_code, "event_type": "auto"
        }, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # Accept either fresh check_in or already_checked_in (idempotent)
        assert body.get('ok') is True
        if body.get('skipped'):
            assert body.get('reason') == 'already_checked_in'
        else:
            assert body.get('action') == 'check_in'

    def test_second_push_creates_checkout(self, owner_token):
        r = requests.post(f"{API}/biometric/push", json={
            "serial": self.serial, "secret": self.secret, "user_id": self.emp_code, "event_type": "auto"
        }, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get('ok') is True
        assert body.get('action') == 'check_out' or body.get('reason') in ('already_checked_out',)

    def test_attendance_today_reflects_push(self, owner_token):
        r = requests.get(f"{API}/attendance/today", headers=hdr(owner_token), timeout=10)
        assert r.status_code == 200
        rows = r.json()
        row = next((x for x in rows if (x.get('employee') or {}).get('employee_code') == self.emp_code), None)
        assert row is not None, "RMJ005 not in today's attendance"
        att = row.get('attendance') or row
        # employee_code was matched, now check nested attendance
        # Response shape may vary; check either 'attendance' subobj or flat
        node = row.get('attendance') if isinstance(row.get('attendance'), dict) else row
        assert node.get('check_in') is not None, f"check_in missing for {self.emp_code}: {row}"
        assert node.get('check_out') is not None, f"check_out missing for {self.emp_code}: {row}"

    def test_device_last_seen_updated(self, owner_token):
        r = requests.get(f"{API}/biometric/devices", headers=hdr(owner_token), timeout=10)
        assert r.status_code == 200
        dev = next((d for d in r.json() if d['serial'] == self.serial), None)
        assert dev is not None
        assert dev.get('last_seen'), "last_seen should be populated after push"
        assert dev.get('status') == 'online'

    def test_logs_contain_rejected_and_accepted(self, owner_token):
        r = requests.get(f"{API}/biometric/logs?limit=100", headers=hdr(owner_token), timeout=10)
        assert r.status_code == 200
        logs = r.json()
        my_logs = [l for l in logs if l.get('serial') == self.serial]
        assert any(l.get('result') == 'rejected' and l.get('reason') == 'invalid_device_credentials' for l in my_logs)
        assert any(l.get('result') == 'rejected' and l.get('reason') == 'unknown_employee' for l in my_logs)
        assert any(l.get('result') == 'accepted' for l in my_logs)


# ---------------- Biometric Device Delete ----------------
class TestBiometricDelete:
    def test_admin_cannot_delete(self, admin_token):
        did = TestBiometricDevices.device_id
        if not did:
            pytest.skip("device_id not created")
        r = requests.delete(f"{API}/biometric/devices/{did}", headers=hdr(admin_token), timeout=10)
        assert r.status_code == 403

    def test_owner_deletes(self, owner_token):
        did = TestBiometricDevices.device_id
        if not did:
            pytest.skip("device_id not created")
        r = requests.delete(f"{API}/biometric/devices/{did}", headers=hdr(owner_token), timeout=10)
        assert r.status_code == 200
        # Verify gone
        r2 = requests.get(f"{API}/biometric/devices", headers=hdr(owner_token), timeout=10)
        assert r2.status_code == 200
        assert not any(d['id'] == did for d in r2.json())


# ---------------- AI Assistant ----------------
class TestAssistant:
    def test_employee_forbidden(self, emp_token):
        r = requests.post(f"{API}/assistant/ask", headers=hdr(emp_token),
                          json={"question": "hi"}, timeout=25)
        assert r.status_code == 403

    def test_ask_employee_count(self, owner_token):
        r = requests.post(f"{API}/assistant/ask", headers=hdr(owner_token),
                          json={"question": "How many employees do we have? Reply with just the number."},
                          timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert 'answer' in data and isinstance(data['answer'], str) and len(data['answer']) > 0
        assert any(ch.isdigit() for ch in data['answer']), f"Answer has no digit: {data['answer']}"

    def test_ask_specific_employee_code(self, admin_token):
        r = requests.post(f"{API}/assistant/ask", headers=hdr(admin_token),
                          json={"question": "What is Rahul's employee code?"}, timeout=30)
        assert r.status_code == 200, r.text
        ans = r.json().get('answer', '')
        assert 'RMJ001' in ans, f"Expected RMJ001 in answer, got: {ans}"

    def test_history(self, owner_token):
        r = requests.get(f"{API}/assistant/history", headers=hdr(owner_token), timeout=10)
        assert r.status_code == 200
        hist = r.json()
        assert isinstance(hist, list) and len(hist) >= 1
        assert 'question' in hist[0] and 'answer' in hist[0]
