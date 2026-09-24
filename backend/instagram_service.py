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
Instagram Business Account — the signed-in user manages).
"""
import asyncio
import logging
import os
from datetime import datetime
from typing import Optional
from urllib.parse import urlencode

import httpx

from server import db, now_utc

logger = logging.getLogger('instagram')

GRAPH_VERSION = 'v21.0'
GRAPH_URL = f'https://graph.facebook.com/{GRAPH_VERSION}'
AUTH_URL = f'https://www.facebook.com/{GRAPH_VERSION}/dialog/oauth'
SCOPE = 'instagram_basic,pages_show_list,pages_read_engagement'
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
