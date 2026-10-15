"""Owner's Instagram audit export (instagram_service.audit_export): paging,
hashtags, per-post insights, and a missing insights permission reported
once instead of failing the export. Meta is faked at _graph_get, so this
never calls the real Graph API."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import instagram_service  # noqa: E402

BASE = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://127.0.0.1:8001').rstrip('/') + '/api'

CFG = {'page_access_token': 'tok', 'ig_user_id': 'IG1', 'page_id': 'P1'}
POSTS = [
    {'id': 'm1', 'caption': 'Lion kada, 22 grams #ludhianajewellers #goldkada', 'media_type': 'VIDEO',
     'media_product_type': 'REELS', 'permalink': 'https://instagram.com/p/m1', 'timestamp': '2026-10-10T10:00:00+0000',
     'like_count': 40, 'comments_count': 3},
    {'id': 'm2', 'caption': None, 'media_type': 'IMAGE', 'media_product_type': 'FEED',
     'permalink': 'https://instagram.com/p/m2', 'timestamp': '2026-10-08T10:00:00+0000', 'like_count': 12, 'comments_count': 0},
    {'id': 'm3', 'caption': 'Bride #ludhianabride', 'media_type': 'VIDEO', 'media_product_type': 'REELS',
     'permalink': 'https://instagram.com/p/m3', 'timestamp': '2026-10-01T10:00:00+0000', 'like_count': 300, 'comments_count': 25},
]


def fake_graph(insights_allowed: bool):
    async def _graph_get(h, path, params):
        if path == 'IG1':
            return {'username': 'rammurtijewellers', 'followers_count': 1349, 'media_count': 3}, None
        if path == 'IG1/media':
            # two pages: m1,m2 then m3
            if params.get('after') == 'c1':
                return {'data': POSTS[2:], 'paging': {'cursors': {'after': 'c2'}}}, None
            return {'data': POSTS[:2], 'paging': {'cursors': {'after': 'c1'}, 'next': 'more'}}, None
        if path.endswith('/insights') and path.startswith('m'):
            if not insights_allowed:
                return None, 'Meta refused the request: (#10) Application does not have permission for this action'
            if params['metric'] == 'views':
                return {'data': [{'name': 'views', 'values': [{'value': 999}]}]}, None
            return {'data': [{'name': 'reach', 'values': [{'value': 500}]}, {'name': 'saved', 'values': [{'value': 7}]}]}, None
        if path == 'IG1/insights':
            if not insights_allowed:
                return None, 'no permission'
            return {'data': [{'total_value': {'breakdowns': [{'results': [
                {'dimension_values': ['Ludhiana, Punjab'], 'value': 600},
                {'dimension_values': ['Delhi'], 'value': 90},
            ]}]}}]}, None
        raise AssertionError(f'unexpected call {path}')
    return _graph_get


@pytest.fixture
def connected(monkeypatch):
    async def get_config():
        return dict(CFG)

    async def no_refresh(cfg):
        return cfg
    monkeypatch.setattr(instagram_service, 'get_config', get_config)
    monkeypatch.setattr(instagram_service, '_maybe_refresh_token', no_refresh)


def test_export_pages_posts_and_reads_insights(connected, monkeypatch):
    monkeypatch.setattr(instagram_service, '_graph_get', fake_graph(True))
    out = asyncio.run(instagram_service.audit_export(100))
    assert out['account']['followers_count'] == 1349
    assert [p['id'] for p in out['posts']] == ['m1', 'm2', 'm3']
    m1 = out['posts'][0]
    assert m1['type'] == 'REELS' and m1['likes'] == 40 and m1['comments'] == 3
    assert m1['hashtags'] == ['ludhianajewellers', 'goldkada']
    assert m1['reach'] == 500 and m1['saved'] == 7 and m1['views'] == 999
    assert out['posts'][1]['caption'] == '' and out['posts'][1]['hashtags'] == []
    assert out['insights_error'] is None
    assert out['audience']['city'][0] == {'value': 'Ludhiana, Punjab', 'followers': 600}


def test_export_respects_limit(connected, monkeypatch):
    monkeypatch.setattr(instagram_service, '_graph_get', fake_graph(True))
    out = asyncio.run(instagram_service.audit_export(2))
    assert [p['id'] for p in out['posts']] == ['m1', 'm2']


def test_missing_insights_permission_still_exports(connected, monkeypatch):
    monkeypatch.setattr(instagram_service, '_graph_get', fake_graph(False))
    out = asyncio.run(instagram_service.audit_export(100))
    assert len(out['posts']) == 3
    assert out['posts'][2]['likes'] == 300 and 'reach' not in out['posts'][2]
    assert 'Reconnect' in out['insights_error']
    assert out['audience']['city'] == {'error': 'no permission'}


def test_not_connected_raises(monkeypatch):
    async def get_config():
        return {}
    monkeypatch.setattr(instagram_service, 'get_config', get_config)
    with pytest.raises(instagram_service.InstagramAuthError):
        asyncio.run(instagram_service.audit_export())


def _token(username, password):
    r = requests.post(f'{BASE}/auth/login', json={'username': username, 'password': password})
    r.raise_for_status()
    return r.json()['access_token']


def test_endpoint_is_owner_only_and_needs_connection():
    admin = _token('admin', 'Admin@123')
    r = requests.get(f'{BASE}/instagram/audit-export', headers={'Authorization': f'Bearer {admin}'})
    assert r.status_code == 403
    owner = _token('owner', 'Owner@123')
    r = requests.get(f'{BASE}/instagram/audit-export', headers={'Authorization': f'Bearer {owner}'})
    assert r.status_code == 400  # Instagram is never connected on a test database
