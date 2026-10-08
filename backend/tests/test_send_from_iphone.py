"""'Send to RMJ One' from the iPhone Share menu: a personal link that can only
upload documents, as its owner, into Pending."""
import io
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _owner():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "Owner@123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_inbox_link():
    h = _owner()
    cats = [c['key'] for c in requests.get(f"{API}/document-categories", headers=h, timeout=30).json()]
    key = requests.post(f"{API}/upload-link/me", headers=h, timeout=30).json()['key']
    name = f'iphone-{os.urandom(3).hex()}.jpg'
    try:
        r = requests.post(f"{API}/inbox/{key}?c={cats[0]}", timeout=30,
                          files={'file': (name, io.BytesIO(b'\xff\xd8\xff\xe0' + b'0' * 300), 'image/jpeg')})
        assert r.status_code == 200 and r.text.startswith('Saved to RMJ One'), r.text
        docs = requests.get(f"{API}/documents?status=pending&category={cats[0]}", headers=h, timeout=30).json()['items']
        mine = [d for d in docs if d['file']['orig_name'] == name]
        assert len(mine) == 1 and mine[0]['category_key'] == cats[0]
        me = requests.get(f"{API}/upload-link/me", headers=h, timeout=30).json()
        assert me['exists'] and me['uses'] >= 1
        # a wrong key, and the old key after a new one is made, are refused
        assert requests.post(f"{API}/inbox/rmjnope", files={'file': ('x.jpg', io.BytesIO(b'x'), 'image/jpeg')}, timeout=30).status_code == 401
        requests.post(f"{API}/upload-link/me", headers=h, timeout=30)
        assert requests.post(f"{API}/inbox/{key}", files={'file': ('x.jpg', io.BytesIO(b'x'), 'image/jpeg')}, timeout=30).status_code == 401
        for d in mine:
            requests.delete(f"{API}/documents/{d['id']}", headers=h, timeout=30)
    finally:
        requests.delete(f"{API}/upload-link/me", headers=h, timeout=30)


def test_shortcut_asks_for_category():
    """The shortcut lists the categories (one name per line, no Customer
    Outstanding) and sends the picked name as the form field `category`."""
    h = _owner()
    cats = [c for c in requests.get(f"{API}/document-categories", headers=h, timeout=30).json() if 'outstanding' not in c['label'].lower()]
    key = requests.post(f"{API}/upload-link/me", headers=h, timeout=30).json()['key']
    try:
        r = requests.get(f"{API}/inbox/{key}/categories", timeout=30)
        assert r.status_code == 200
        names = r.text.split('\n')
        assert cats[-1]['label'] in names and not [n for n in names if 'outstanding' in n.lower()]
        assert requests.get(f"{API}/inbox/rmjnope/categories", timeout=30).status_code == 401
        target = cats[-1]
        name = f'iphone-{os.urandom(3).hex()}.jpg'
        r = requests.post(f"{API}/inbox/{key}", timeout=30, data={'category': target['label']},
                          files={'file': (name, io.BytesIO(b'\xff\xd8\xff\xe0' + b'0' * 300), 'image/jpeg')})
        assert r.status_code == 200 and target['label'] in r.text, r.text
        docs = requests.get(f"{API}/documents?status=pending&category={target['key']}", headers=h, timeout=30).json()['items']
        mine = [d for d in docs if d['file']['orig_name'] == name]
        assert len(mine) == 1
        for d in mine:
            requests.delete(f"{API}/documents/{d['id']}", headers=h, timeout=30)
    finally:
        requests.delete(f"{API}/upload-link/me", headers=h, timeout=30)
