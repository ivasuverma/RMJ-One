"""Custom broadcast lists and in-app templates (routers/broadcasts.py)."""
import io
import os

import requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _photo(owner) -> str:
    from PIL import Image
    buf = io.BytesIO()
    Image.new('RGB', (900, 600), (180, 140, 50)).save(buf, 'PNG')
    r = requests.post(f"{API}/broadcasts/media", headers=owner, files={'file': ('p.png', buf.getvalue(), 'image/png')}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()['id']


def test_lists_are_owner_only():
    assert requests.get(f"{API}/broadcasts/lists", headers=_login('admin', 'Admin@123'), timeout=30).status_code == 403


def test_list_lifecycle_keeps_rate_lists_separate():
    owner = _login('owner', 'Owner@123')
    r = requests.post(f"{API}/broadcasts/lists", headers=owner, json={'name': 'Bridal Test'}, timeout=30)
    assert r.status_code == 200, r.text
    lid = r.json()['id']
    try:
        assert requests.post(f"{API}/broadcasts/lists", headers=owner, json={'name': 'bridal test'}, timeout=30).status_code == 400
        csv = "Name,Mobile\nAnu,9812399001\nBina,9812399002\nBad,12\n"
        d = requests.post(f"{API}/broadcasts/lists/{lid}/import", headers=owner,
                          files={'file': ('l.csv', csv.encode(), 'text/csv')}, timeout=30).json()
        assert d == {'added': 2, 'already': 0, 'opted_out': 0, 'invalid': 1}
        assert requests.post(f"{API}/broadcasts/lists/{lid}/members", headers=owner, json={'mobile': '9812399001'}, timeout=30).status_code == 400
        assert requests.post(f"{API}/broadcasts/lists/{lid}/members", headers=owner, json={'mobile': '9812399003', 'name': 'Chitra'}, timeout=30).status_code == 200
        lists = requests.get(f"{API}/broadcasts/lists", headers=owner, timeout=30).json()
        assert next(x for x in lists if x['id'] == lid)['count'] == 3
        members = requests.get(f"{API}/rate-broadcast/subscribers?list_id={lid}", headers=owner, timeout=30).json()
        assert {m['mobile'] for m in members} == {'9812399001', '9812399002', '9812399003'}
        # list-only people don't get the rate and don't show on the rate lists
        rate = requests.get(f"{API}/rate-broadcast/subscribers?q=98123990", headers=owner, timeout=30).json()
        assert rate == []
        weekly = requests.get(f"{API}/rate-broadcast/subscribers?plan=weekly&q=98123990", headers=owner, timeout=30).json()
        assert weekly == []
        # adding one of them to the rate list upgrades the same record
        r = requests.post(f"{API}/rate-broadcast/subscribers", headers=owner, json={'mobile': '9812399002', 'plan': 'daily'}, timeout=30)
        assert r.status_code == 200 and r.json()['plan'] == 'daily'
        # removing a list-only member deletes them; the upgraded one stays
        sid = next(m['id'] for m in members if m['mobile'] == '9812399003')
        assert requests.delete(f"{API}/broadcasts/lists/{lid}/members/{sid}", headers=owner, timeout=30).status_code == 200
        assert requests.get(f"{API}/rate-broadcast/subscribers?list_id={lid}", headers=owner, timeout=30).json().__len__() == 2
        # sending needs Meta (not configured in CI)
        r = requests.post(f"{API}/rate-broadcast/send", headers=owner, json={'audience': 'list', 'list_id': lid}, timeout=30)
        assert r.status_code == 400
    finally:
        assert requests.delete(f"{API}/broadcasts/lists/{lid}", headers=owner, timeout=30).status_code == 200
    assert requests.get(f"{API}/rate-broadcast/subscribers?q=9812399001", headers=owner, timeout=30).json() == []
    kept = requests.get(f"{API}/rate-broadcast/subscribers?q=9812399002", headers=owner, timeout=30).json()
    assert kept and kept[0]['plan'] == 'daily' and kept[0]['lists'] == []
    requests.delete(f"{API}/rate-broadcast/subscribers/{kept[0]['id']}", headers=owner, timeout=30)


def test_media_is_public():
    owner = _login('owner', 'Owner@123')
    mid = _photo(owner)
    r = requests.get(f"{API}/public/broadcast-media/{mid}", timeout=30)
    assert r.status_code == 200 and r.headers['content-type'] == 'image/jpeg'


def test_template_validation():
    owner = _login('owner', 'Owner@123')

    def post(body):
        return requests.post(f"{API}/broadcasts/templates", headers=owner, json=body, timeout=30)
    base = {'label': 'Diwali offer', 'kind': 'text', 'body': 'Hi {{1}}, our Diwali collection is here!'}
    bad = [
        {**base, 'body': '{{1}}, hello'},                                       # starts with the name
        {**base, 'body': 'Hi {{2}} there'},                                     # only {{1}}
        {**base, 'buttons': [{'type': 'quick_reply', 'text': 'x' * 26}]},      # label too long
        {**base, 'buttons': [{'type': 'url', 'text': 'Visit', 'url': 'rmj.co.in'}]},
        {**base, 'buttons': [{'type': 'quick_reply', 'text': str(i)} for i in range(4)]},
        {**base, 'kind': 'image'},                                              # no photo
        {**base, 'kind': 'carousel', 'cards': []},
    ]
    for b in bad:
        assert post(b).status_code == 400, b
    mid = _photo(owner)
    cards = [{'media_id': mid, 'body': 'Ring', 'button': {'type': 'quick_reply', 'text': 'Interested'}},
             {'media_id': mid, 'body': 'Necklace', 'button': {'type': 'url', 'text': 'See', 'url': 'https://rmj.co.in'}}]
    assert 'same kind' in post({**base, 'kind': 'carousel', 'cards': cards}).json()['detail']
    # a valid template still needs the Meta line, which CI doesn't have
    good = {**base, 'kind': 'image', 'media_id': mid, 'buttons': [{'type': 'quick_reply', 'text': '👍'}, {'type': 'quick_reply', 'text': '👎'}]}
    r = post(good)
    assert r.status_code == 400 and 'not set up' in r.json()['detail']
    assert requests.get(f"{API}/broadcasts/templates", headers=owner, timeout=30).json() == []
    r = requests.post(f"{API}/rate-broadcast/send", headers=owner, json={'audience': 'weekly', 'template_id': 'nope'}, timeout=30)
    assert r.status_code == 400
