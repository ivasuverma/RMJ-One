"""An employee's own alerts (pay, tasks, attendance, work issued) are switched
only on that employee's profile — saved in their notif_prefs."""
import os

import pytest
import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_employee_alert_list_and_saving():
    h = _owner()
    alerts = requests.get(f"{API}/access/employee-alerts", headers=h, timeout=30).json()
    keys = {a['key'] for a in alerts}
    assert {'self_salary_paid', 'self_task_assigned', 'self_repair_issued', 'self_checked_in'} <= keys

    accts = requests.get(f"{API}/access/accounts", headers=h, timeout=30).json()
    emp = next((a for a in accts if a['account_type'] == 'employee'), None)
    if not emp:
        pytest.skip('no employee')
    before = (emp.get('notif_prefs_whatsapp') or {}).get('self_salary_paid')
    r = requests.put(f"{API}/access/accounts/{emp['id']}", headers=h, json={'notif_prefs_whatsapp': {'self_salary_paid': False}}, timeout=30)
    assert r.status_code == 200, r.text
    again = next(a for a in requests.get(f"{API}/access/accounts", headers=h, timeout=30).json() if a['id'] == emp['id'])
    assert again['notif_prefs_whatsapp'].get('self_salary_paid') is False
    if before is not False:   # put it back on (its default)
        requests.put(f"{API}/access/accounts/{emp['id']}", headers=h, json={'notif_prefs_whatsapp': {'self_salary_paid': True}}, timeout=30)

    # the old shop-wide endpoint is gone
    assert requests.get(f"{API}/settings/general-alerts", headers=h, timeout=30).status_code in (404, 405)
