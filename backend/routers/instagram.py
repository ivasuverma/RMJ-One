"""Instagram feed connect flow for the public website — mirrors the Google
Drive routes in documents.py (status / auth-url / callback / disconnect),
see instagram_service.py for the actual OAuth + fetch logic."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse

from server import db, now_utc, require_owner, log_audit

router = APIRouter()


@router.get('/instagram/status')
async def instagram_status(user=Depends(require_owner)):
    import instagram_service
    cfg = await instagram_service.get_config()
    return {
        'connected': bool(cfg.get('page_access_token') and cfg.get('ig_user_id')),
        'username': cfg.get('ig_username'),
        'env_ready': instagram_service.env_ready(),
        'connected_at': cfg.get('connected_at'),
        'auth_error': cfg.get('auth_error'),
    }


@router.get('/instagram/auth-url')
async def instagram_auth_url(user=Depends(require_owner)):
    import instagram_service
    if not instagram_service.env_ready():
        raise HTTPException(status_code=400, detail='Instagram credentials not configured on the server (META_APP_ID / META_APP_SECRET / META_REDIRECT_URI).')
    state = str(uuid.uuid4())
    await db.settings.update_one({'id': 'instagram'}, {'$set': {'id': 'instagram', 'oauth_state': state}}, upsert=True)
    return {'url': instagram_service.auth_url(state)}


@router.get('/instagram/callback')
async def instagram_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    """Facebook redirects the owner's browser here after consent. No bearer
    token — validated by the one-time `state` we issued, same as Drive's
    callback. Returns a plain HTML page."""
    import instagram_service

    def page(msg: str, ok: bool) -> HTMLResponse:
        color = '#5FB07E' if ok else '#E5695B'
        return HTMLResponse(f"<html><body style='background:#0B0B0C;color:#F4F3EF;font-family:-apple-system,sans-serif;text-align:center;padding:60px'>"
                            f"<div style='font-size:44px;color:{color}'>{'✓' if ok else '✕'}</div>"
                            f"<h2>{msg}</h2><p style='color:#B7B6B0'>You can close this tab and return to RMJ One.</p></body></html>")

    if error or not code:
        return page('Instagram was not connected.', False)
    cfg = await instagram_service.get_config()
    if not state or state != cfg.get('oauth_state'):
        return page('Link expired — please start again from Settings.', False)
    try:
        connected = await instagram_service.exchange_code(code)
    except instagram_service.InstagramAuthError as e:
        return page(str(e), False)
    except Exception:
        return page('Could not complete the Instagram sign-in.', False)
    await db.settings.update_one({'id': 'instagram'}, {'$set': {
        **connected, 'connected_at': now_utc().isoformat(), 'oauth_state': None, 'auth_error': None,
    }}, upsert=True)
    await instagram_service.refresh_media()  # populate the feed cache right away, don't wait for the next poll
    return page(f"Instagram connected (@{connected.get('ig_username') or ''}).", True)


@router.post('/instagram/disconnect')
async def instagram_disconnect(user=Depends(require_owner)):
    await db.settings.update_one({'id': 'instagram'}, {'$set': {
        'page_access_token': None, 'user_long_lived_token': None, 'ig_user_id': None, 'ig_username': None,
        'page_id': None, 'connected_at': None, 'auth_error': None,
    }})
    await db.settings.update_one({'id': 'instagram_media'}, {'$set': {'posts': [], 'username': None}})
    await log_audit(user, 'instagram.disconnect', 'settings', 'instagram', '')
    return {'ok': True}
