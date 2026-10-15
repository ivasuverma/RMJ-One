"""Instagram feed for the public website (rmj.co.in) — via the Instagram
Graph API, mirroring drive_service.py's shape (3-legged OAuth, a token
stored in db.settings, a background loop that keeps a read cache fresh).

Flow: the owner connects the shop's Instagram once (Facebook Login, since
Instagram Graph API only works for a Business/Creator account linked to a
Facebook Page — see the routes in routers/instagram.py). That exchange
gives a long-lived Page Access Token for the linked Instagram Business
Account, which we store in db.settings (id='instagram') alongside the long-
lived USER token it was derived from (needed to extend the Page token again
before the user token's own ~60-day expiry — see _maybe_refresh_token).
instagram_loop() (started in server.py) periodically refreshes the token
when it's getting old and re-fetches the latest media into a small read
cache (db.settings id='instagram_media') that routers/public.py serves —
same "the DB doc IS the cache" pattern as gold_rate.py's gold_rate_live.

Requires three env vars (owner sets these from a Meta developer app — can
reuse the same app as META_WA_* in .env.example if one already exists, just
add the "Instagram Graph API" product to it):
    META_APP_ID, META_APP_SECRET, META_REDIRECT_URI
Scopes: instagram_basic (read the account + its media), pages_show_list and
pages_read_engagement (needed to find which Facebook Page — and so which
Instagram Business Account — the signed-in user manages), and
instagram_manage_insights (per-post reach/saves/shares/views and audience
breakdowns for the owner's audit export — see audit_export below; a
connection made before this scope was added still exports, just without
those numbers, until the owner taps Reconnect).
"""
import asyncio
import logging
import os
import re
from datetime import datetime
from typing import Optional
from urllib.parse import urlencode

import httpx

from server import db, now_utc

logger = logging.getLogger('instagram')

GRAPH_VERSION = 'v21.0'
GRAPH_URL = f'https://graph.facebook.com/{GRAPH_VERSION}'
AUTH_URL = f'https://www.facebook.com/{GRAPH_VERSION}/dialog/oauth'
SCOPE = 'instagram_basic,pages_show_list,pages_read_engagement,instagram_manage_insights'
MEDIA_FIELDS = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp'
MEDIA_LIMIT = 12

POLL_SECONDS = 30 * 60  # the feed doesn't need to be near-real-time
# Long-lived user tokens last ~60 days; re-exchange (extend) well before that
# so instagram_loop always has margin even if the shop server is off for a
# few days — see _maybe_refresh_token.
REFRESH_TOKEN_AFTER_DAYS = 45


def client_creds():
    return (os.environ.get('META_APP_ID'), os.environ.get('META_APP_SECRET'), os.environ.get('META_REDIRECT_URI'))


def env_ready() -> bool:
    app_id, app_secret, redirect = client_creds()
    return bool(app_id and app_secret and redirect)


async def get_config() -> dict:
    return await db.settings.find_one({'id': 'instagram'}, {'_id': 0}) or {}


async def is_connected() -> bool:
    cfg = await get_config()
    return bool(cfg.get('page_access_token') and cfg.get('ig_user_id'))


def auth_url(state: str) -> str:
    app_id, _, redirect = client_creds()
    params = {'client_id': app_id, 'redirect_uri': redirect, 'response_type': 'code', 'scope': SCOPE, 'state': state}
    return f'{AUTH_URL}?{urlencode(params)}'


class InstagramAuthError(RuntimeError):
    """Meta refused the saved sign-in, or the account isn't set up the way
    Instagram Graph API requires (not a Business/Creator account, no linked
    Facebook Page, ...) — carries a human-readable reason for Settings /
    the "reconnect" prompt."""


async def exchange_code(code: str) -> dict:
    """Full connect flow after the OAuth redirect: short-lived user token ->
    long-lived user token -> the Facebook Page the user manages -> that
    Page's linked Instagram Business Account + its own Page Access Token
    (what actually reads the IG media). Raises InstagramAuthError with a
    reason meant to be shown directly to the owner on any step that fails."""
    app_id, app_secret, redirect = client_creds()
    async with httpx.AsyncClient(timeout=30) as h:
        r = await h.get(f'{GRAPH_URL}/oauth/access_token', params={
            'client_id': app_id, 'client_secret': app_secret, 'redirect_uri': redirect, 'code': code,
        })
        if r.status_code != 200:
            raise InstagramAuthError(_graph_error(r, 'Could not complete Instagram sign-in'))
        short_token = r.json().get('access_token')

        r2 = await h.get(f'{GRAPH_URL}/oauth/access_token', params={
            'grant_type': 'fb_exchange_token', 'client_id': app_id, 'client_secret': app_secret,
            'fb_exchange_token': short_token,
        })
        if r2.status_code != 200:
            raise InstagramAuthError(_graph_error(r2, 'Could not get a long-lived token'))
        user_token = r2.json().get('access_token')

        r3 = await h.get(f'{GRAPH_URL}/me/accounts', params={'access_token': user_token})
        if r3.status_code != 200:
            raise InstagramAuthError(_graph_error(r3, 'Could not list your Facebook Pages'))
        pages = r3.json().get('data') or []
        if not pages:
            raise InstagramAuthError('No Facebook Page found for this account — Instagram Graph API needs your Instagram to be a Business/Creator account linked to a Facebook Page.')

        ig = None
        for page in pages:
            r4 = await h.get(f"{GRAPH_URL}/{page['id']}", params={
                'fields': 'instagram_business_account{id,username}', 'access_token': page['access_token'],
            })
            if r4.status_code == 200:
                iba = r4.json().get('instagram_business_account')
                if iba:
                    ig = {'ig_user_id': iba['id'], 'ig_username': iba.get('username'),
                          'page_id': page['id'], 'page_access_token': page['access_token']}
                    break
        if not ig:
            raise InstagramAuthError('None of your Facebook Pages have an Instagram Business/Creator account linked — link one in Meta Business Suite, then reconnect.')

    return {**ig, 'user_long_lived_token': user_token, 'user_token_obtained_at': now_utc().isoformat()}


def _graph_error(r: httpx.Response, fallback: str) -> str:
    try:
        msg = (r.json().get('error') or {}).get('message')
    except Exception:
        msg = None
    return f'{fallback}: {msg}' if msg else fallback


async def _maybe_refresh_token(cfg: dict) -> dict:
    """Re-exchange the stored long-lived user token for a fresh one (resets
    its ~60-day clock) once it's old enough to be worth renewing, then
    re-derives the Page Access Token from it. A no-op — returns cfg
    unchanged — if not connected, too recently refreshed, or the refresh
    itself fails (next cycle just tries again; the still-valid old token
    keeps working meanwhile, same as Drive's lazy-refresh-on-expiry, just
    time-based here since Meta's long-lived tokens don't carry their own
    refresh_token grant)."""
    token = cfg.get('user_long_lived_token')
    obtained_at = cfg.get('user_token_obtained_at')
    if not token or not obtained_at:
        return cfg
    try:
        age_days = (now_utc() - datetime.fromisoformat(obtained_at)).days
    except Exception:
        age_days = 0
    if age_days < REFRESH_TOKEN_AFTER_DAYS:
        return cfg
    app_id, app_secret, _ = client_creds()
    try:
        async with httpx.AsyncClient(timeout=30) as h:
            r = await h.get(f'{GRAPH_URL}/oauth/access_token', params={
                'grant_type': 'fb_exchange_token', 'client_id': app_id, 'client_secret': app_secret,
                'fb_exchange_token': token,
            })
            r.raise_for_status()
            new_user_token = r.json()['access_token']
            r2 = await h.get(f"{GRAPH_URL}/{cfg['page_id']}", params={'fields': 'access_token', 'access_token': new_user_token})
            r2.raise_for_status()
            new_page_token = r2.json()['access_token']
        updated = {**cfg, 'user_long_lived_token': new_user_token, 'user_token_obtained_at': now_utc().isoformat(), 'page_access_token': new_page_token, 'auth_error': None}
        await db.settings.update_one({'id': 'instagram'}, {'$set': updated})
        logger.info('instagram token refreshed')
        return updated
    except Exception as e:
        logger.warning(f'instagram token refresh failed (will retry next cycle): {e}')
        return cfg


async def fetch_media(cfg: dict) -> list:
    async with httpx.AsyncClient(timeout=30) as h:
        r = await h.get(f"{GRAPH_URL}/{cfg['ig_user_id']}/media", params={
            'fields': MEDIA_FIELDS, 'limit': MEDIA_LIMIT, 'access_token': cfg['page_access_token'],
        })
    if r.status_code != 200:
        raise InstagramAuthError(_graph_error(r, 'Could not fetch Instagram media'))
    items = r.json().get('data') or []
    posts = []
    for it in items:
        image = it.get('thumbnail_url') or (it.get('media_url') if it.get('media_type') != 'VIDEO' else None)
        if not image:
            continue  # a video with no thumbnail (rare) — nothing to show in the rail
        posts.append({
            'id': it['id'], 'image': image, 'permalink': it.get('permalink'),
            'caption': (it.get('caption') or '')[:140], 'timestamp': it.get('timestamp'),
        })
    return posts


async def _store_media(posts: Optional[list], username: Optional[str], error: Optional[str]) -> None:
    """Same discipline as gold_rate.py's _store_live_rate: error/fetched_at
    always get written (they describe the latest attempt), but `posts` is
    only overwritten on a successful fetch — a transient failure leaves the
    website showing the last known-good feed instead of going blank."""
    fields = {'id': 'instagram_media', 'fetched_at': now_utc().isoformat(), 'error': error}
    if posts is not None:
        fields['posts'] = posts
        fields['username'] = username
    await db.settings.update_one({'id': 'instagram_media'}, {'$set': fields}, upsert=True)


async def refresh_media() -> dict:
    """Fetch-and-cache primitive, callable on demand (e.g. a future manual
    refresh button) or from instagram_loop below."""
    cfg = await get_config()
    if not cfg.get('page_access_token') or not cfg.get('ig_user_id'):
        return {'ok': False, 'error': 'not connected'}
    cfg = await _maybe_refresh_token(cfg)
    try:
        posts = await fetch_media(cfg)
        await _store_media(posts, cfg.get('ig_username'), None)
        await db.settings.update_one({'id': 'instagram', 'auth_error': {'$nin': [None, '']}}, {'$set': {'auth_error': None}})
        return {'ok': True, 'count': len(posts)}
    except InstagramAuthError as e:
        await _store_media(None, None, str(e))
        await db.settings.update_one({'id': 'instagram'}, {'$set': {'auth_error': str(e)}})
        return {'ok': False, 'error': str(e)}
    except Exception as e:
        await _store_media(None, None, str(e)[:300])
        return {'ok': False, 'error': str(e)[:300]}


async def instagram_loop():
    """Same shape as gold_rate_loop: sleep on boot, then poll forever,
    catching every exception so one bad cycle never kills the loop."""
    await asyncio.sleep(60)
    while True:
        try:
            if await is_connected():
                await refresh_media()
        except Exception as e:
            logger.warning(f'instagram loop error: {e}')
        await asyncio.sleep(POLL_SECONDS)


# ---------------------------------------------------------------------------
# Owner's audit export — every recent post with its numbers, as one JSON file
# the owner downloads from Settings > Instagram and hands to whoever is
# reviewing the account (posting cadence, captions/hashtags, what earns
# reach). Read-only against Meta; nothing is stored.

AUDIT_MEDIA_FIELDS = 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count'
AUDIT_ACCOUNT_FIELDS = 'username,name,biography,website,followers_count,follows_count,media_count'
# Asked for in one call per post; `views` is asked for separately because
# Meta rejects the whole call if any one metric isn't valid for that post.
AUDIT_POST_METRICS = 'reach,saved,shares,total_interactions'
AUDIT_MAX_POSTS = 200
HASHTAG_RE = re.compile(r'#(\w+)', re.UNICODE)


async def _graph_get(h: httpx.AsyncClient, path: str, params: dict) -> tuple[Optional[dict], Optional[str]]:
    r = await h.get(f'{GRAPH_URL}/{path}', params=params)
    if r.status_code != 200:
        return None, _graph_error(r, 'Meta refused the request')
    return r.json(), None


def _metric_values(data: Optional[dict]) -> dict:
    out = {}
    for m in (data or {}).get('data') or []:
        vals = m.get('values') or []
        if vals:
            out[m['name']] = vals[0].get('value')
        elif 'total_value' in m:
            out[m['name']] = (m.get('total_value') or {}).get('value')
    return out


async def _post_insights(h: httpx.AsyncClient, media_id: str, token: str) -> tuple[dict, Optional[str]]:
    data, err = await _graph_get(h, f'{media_id}/insights', {'metric': AUDIT_POST_METRICS, 'access_token': token})
    metrics = _metric_values(data)
    views, _ = await _graph_get(h, f'{media_id}/insights', {'metric': 'views', 'access_token': token})
    metrics.update(_metric_values(views))
    return metrics, err


async def _audience(h: httpx.AsyncClient, ig_user_id: str, token: str) -> dict:
    out = {}
    for breakdown in ('city', 'age', 'gender'):
        data, err = await _graph_get(h, f'{ig_user_id}/insights', {
            'metric': 'follower_demographics', 'period': 'lifetime', 'metric_type': 'total_value',
            'breakdown': breakdown, 'access_token': token,
        })
        if err:
            out[breakdown] = {'error': err}
            continue
        rows = []
        for m in (data or {}).get('data') or []:
            for b in ((m.get('total_value') or {}).get('breakdowns') or []):
                for res in b.get('results') or []:
                    rows.append({'value': ', '.join(res.get('dimension_values') or []), 'followers': res.get('value')})
        out[breakdown] = sorted(rows, key=lambda r: -(r['followers'] or 0))
    return out


async def audit_export(limit: int = 100) -> dict:
    """Builds the owner's audit file. Raises InstagramAuthError if not
    connected or Meta refuses the basic media read; per-post insights that
    fail (usually: connected before instagram_manage_insights was added)
    are reported once in `insights_error` instead of failing the export."""
    cfg = await get_config()
    if not cfg.get('page_access_token') or not cfg.get('ig_user_id'):
        raise InstagramAuthError('Instagram is not connected.')
    cfg = await _maybe_refresh_token(cfg)
    token, ig_id = cfg['page_access_token'], cfg['ig_user_id']
    limit = max(1, min(limit, AUDIT_MAX_POSTS))

    async with httpx.AsyncClient(timeout=30) as h:
        account, err = await _graph_get(h, ig_id, {'fields': AUDIT_ACCOUNT_FIELDS, 'access_token': token})
        if err:
            raise InstagramAuthError(err)

        media, after = [], None
        while len(media) < limit:
            params = {'fields': AUDIT_MEDIA_FIELDS, 'limit': min(50, limit - len(media)), 'access_token': token}
            if after:
                params['after'] = after
            page, err = await _graph_get(h, f'{ig_id}/media', params)
            if err:
                raise InstagramAuthError(err)
            media.extend(page.get('data') or [])
            after = ((page.get('paging') or {}).get('cursors') or {}).get('after')
            if not after or not (page.get('paging') or {}).get('next'):
                break
        media = media[:limit]

        insights_error = None
        posts = []
        for it in media:
            caption = it.get('caption') or ''
            metrics, ierr = await _post_insights(h, it['id'], token)
            insights_error = insights_error or ierr
            posts.append({
                'id': it['id'],
                'timestamp': it.get('timestamp'),
                'type': it.get('media_product_type') or it.get('media_type'),  # REELS / FEED / STORY
                'media_type': it.get('media_type'),  # IMAGE / VIDEO / CAROUSEL_ALBUM
                'permalink': it.get('permalink'),
                'caption': caption,
                'hashtags': HASHTAG_RE.findall(caption),
                'likes': it.get('like_count'),
                'comments': it.get('comments_count'),
                **metrics,
            })

        audience = await _audience(h, ig_id, token)

    return {
        'exported_at': now_utc().isoformat(),
        'account': account,
        'post_count': len(posts),
        'insights_error': (f'{insights_error} — tap Reconnect in Settings > Instagram to allow insights.' if insights_error else None),
        'audience': audience,
        'posts': posts,
    }


# ---------------------------------------------------------------------------
# Queued audit export — the export makes a few hundred Graph API calls and
# can take minutes, too long to keep the app open waiting on one request.
# The owner taps "Prepare", this runs in the background, keeps the finished
# file in db.settings (id='instagram_audit_job'), and notifies the owner
# (in-app bell, push, WhatsApp — server.notify_user) when it's ready.

AUDIT_JOB_ID = 'instagram_audit_job'
AUDIT_JOB_STALE_MINUTES = 30  # a 'running' job older than this died with a server restart


async def get_audit_job(include_data: bool = False) -> dict:
    proj = {'_id': 0} if include_data else {'_id': 0, 'data': 0}
    return await db.settings.find_one({'id': AUDIT_JOB_ID}, proj) or {}


def _job_is_live(job: dict) -> bool:
    if job.get('status') != 'running' or not job.get('started_at'):
        return False
    try:
        age = (now_utc() - datetime.fromisoformat(job['started_at'])).total_seconds() / 60
    except Exception:
        return False
    return age < AUDIT_JOB_STALE_MINUTES


async def start_audit_job(user_id: str, limit: int = 100) -> dict:
    """Queues one export; a second tap while one is running just returns it."""
    job = await get_audit_job()
    if _job_is_live(job):
        return job
    fields = {'id': AUDIT_JOB_ID, 'status': 'running', 'started_at': now_utc().isoformat(),
              'finished_at': None, 'error': None, 'post_count': None, 'requested_by': user_id}
    await db.settings.update_one({'id': AUDIT_JOB_ID}, {'$set': fields, '$unset': {'data': ''}}, upsert=True)
    asyncio.create_task(_run_audit_job(user_id, limit))
    return fields


async def _run_audit_job(user_id: str, limit: int) -> None:
    from server import notify_user
    try:
        data = await audit_export(limit)
        await db.settings.update_one({'id': AUDIT_JOB_ID}, {'$set': {
            'status': 'ready', 'finished_at': now_utc().isoformat(), 'post_count': data['post_count'], 'data': data,
        }})
        await notify_user(user_id, 'Instagram audit file is ready',
                          f"{data['post_count']} posts. Download it from Settings › Instagram.", '/settings/instagram')
    except Exception as e:
        msg = str(e)[:300] or 'Export failed'
        await db.settings.update_one({'id': AUDIT_JOB_ID}, {'$set': {
            'status': 'failed', 'finished_at': now_utc().isoformat(), 'error': msg,
        }})
        await notify_user(user_id, 'Instagram audit file failed', msg, '/settings/instagram')
