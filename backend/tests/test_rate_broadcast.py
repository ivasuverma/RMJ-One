"""Weekly rate broadcast — subscriber list, import, settings, send guards."""
import os

import pytest
import requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope='module')
def owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope='module')
def admin():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "Admin@123"}, timeout=30)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


CSV = (
    "Customer Name,Mobile No.,City\n"
    "Rahul Test,+91 98765-00001,Ludhiana\n"
    "Priya Test,09876500002,Ludhiana\n"
    "Bad Number,12345,x\n"
    "Rahul Again,9876500001,\n"
)


class TestRateBroadcast:
    def test_owner_only(self, admin):
        assert requests.get(f"{API}/rate-broadcast/overview", headers=admin, timeout=30).status_code == 403

    def test_import_csv(self, owner):
        r = requests.post(f"{API}/rate-broadcast/subscribers/import", headers=owner,
                          files={'file': ('list.csv', CSV.encode(), 'text/csv')}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['added'] == 2 and d['invalid'] == 1 and d['already_there'] == 1
        subs = requests.get(f"{API}/rate-broadcast/subscribers", headers=owner, timeout=30).json()
        mobiles = {s['mobile'] for s in subs}
        assert {'9876500001', '9876500002'} <= mobiles

    def test_reimport_is_idempotent(self, owner):
        r = requests.post(f"{API}/rate-broadcast/subscribers/import", headers=owner,
                          files={'file': ('list.csv', CSV.encode(), 'text/csv')}, timeout=30).json()
        assert r['added'] == 0

    def test_manual_add_and_duplicate(self, owner):
        r = requests.post(f"{API}/rate-broadcast/subscribers", headers=owner, json={'name': 'Walk-in', 'mobile': '98765 00003'}, timeout=30)
        assert r.status_code == 200 and r.json()['mobile'] == '9876500003'
        assert requests.post(f"{API}/rate-broadcast/subscribers", headers=owner, json={'mobile': '9876500003'}, timeout=30).status_code == 400
        assert requests.post(f"{API}/rate-broadcast/subscribers", headers=owner, json={'mobile': '123'}, timeout=30).status_code == 400

    def test_remove(self, owner):
        subs = requests.get(f"{API}/rate-broadcast/subscribers", headers=owner, timeout=30).json()
        sid = next(s['id'] for s in subs if s['mobile'] == '9876500003')
        assert requests.delete(f"{API}/rate-broadcast/subscribers/{sid}", headers=owner, timeout=30).status_code == 200

    def test_settings_validation(self, owner):
        ok = {'weekly_enabled': True, 'weekday': 0, 'time': '11:00', 'daily_enabled': True,
              'daily_time': '11:30', 'daily_skip_sunday': True, 'daily_limit': 250}
        r = requests.put(f"{API}/rate-broadcast/settings", headers=owner, json=ok, timeout=30)
        assert r.status_code == 200 and r.json()['weekly_enabled'] is True and r.json()['daily_time'] == '11:30'
        assert requests.put(f"{API}/rate-broadcast/settings", headers=owner, json={**ok, 'time': '25:00'}, timeout=30).status_code == 400
        assert requests.put(f"{API}/rate-broadcast/settings", headers=owner, json={**ok, 'daily_time': '9'}, timeout=30).status_code == 400
        assert requests.put(f"{API}/rate-broadcast/settings", headers=owner, json={**ok, 'weekday': 7}, timeout=30).status_code == 400
        requests.put(f"{API}/rate-broadcast/settings", headers=owner, json={**ok, 'weekly_enabled': False, 'daily_enabled': False}, timeout=30)

    def test_overview_and_send_guard(self, owner):
        ov = requests.get(f"{API}/rate-broadcast/overview", headers=owner, timeout=30).json()
        assert ov['counts']['weekly'] >= 2  # imported customers are the weekly list
        assert 'https://rmj.co.in' in ov['preview']
        assert ov['buttons'] == ['See live rates', 'Call the shop', 'Stop updates']
        assert ov['photo_custom'] is False and ov['photo_url'].startswith('https://rmj.co.in/')
        # CI has no Meta line configured, so a send must be refused, not attempted.
        assert requests.post(f"{API}/rate-broadcast/send", headers=owner, json={'audience': 'weekly'}, timeout=30).status_code == 400

    def test_photo_upload_and_reset(self, owner):
        import io
        from PIL import Image
        buf = io.BytesIO()
        Image.new('RGB', (800, 600), (200, 160, 60)).save(buf, 'JPEG')
        r = requests.post(f"{API}/rate-broadcast/photo", headers=owner, files={'file': ('p.jpg', buf.getvalue(), 'image/jpeg')}, timeout=30)
        assert r.status_code == 200 and r.json()['photo_custom'] is True
        img = requests.get(f"{BASE_URL}/api/public/rate-broadcast/photo", timeout=30)
        assert img.status_code == 200 and img.headers['content-type'] == 'image/jpeg'
        r = requests.delete(f"{API}/rate-broadcast/photo", headers=owner, timeout=30)
        assert r.json()['photo_custom'] is False
        assert requests.get(f"{BASE_URL}/api/public/rate-broadcast/photo", timeout=30).status_code == 404

    def test_public_subscribe_link(self):
        r = requests.get(f"{BASE_URL}/api/public/rate-broadcast/subscribe", timeout=30)
        assert r.status_code == 200 and r.json()['url'] is None  # no Meta line in CI
