"""Public, unauthenticated endpoints meant to be reachable by anyone on the
internet — currently just the live gold/silver rates page (see
frontend/app/rates.tsx). Nothing here requires login; keep it that way, and
keep it read-only (or, for the rate-target subscribe endpoint, write-only to
its own narrow collection) — this is the one place in the API a stranger can
call without a token."""
from datetime import timedelta

from fastapi import APIRouter
from pydantic import BaseModel, Field
from server import db, now_utc

router = APIRouter()


@router.get('/public/rates')
async def public_rates():
    """Backs the public rates page. Always 200s with whatever's known, even
    if nothing's been fetched yet (every field null) or the last fetch
    failed (gold/silver stay at their last good value — see gold_rate.py's
    _store_live_rate, which only overwrites gold_rate/silver_rate on a
    successful fetch) — a public page going blank/erroring is worse than it
    quietly showing the last known-good numbers with their real timestamp."""
    live = await db.settings.find_one({'id': 'gold_rate_live'}, {'_id': 0}) or {}
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    return {
        'store_name': store.get('name') or 'Ram Murti Jewellers',
        'fetched_at': live.get('fetched_at'),
        'gold_sell': live.get('gold_rate'),
        'gold_buy': live.get('gold_buy_rate'),
        'silver_sell': live.get('silver_rate'),
        'silver_buy': live.get('silver_buy_rate'),
        'xau_usd': live.get('xau_usd'),
        'xag_usd': live.get('xag_usd'),
        'usd_inr': live.get('usd_inr'),
        # Change since the rate last moved (null until it has changed once).
        'gold_change': _change(live.get('gold_rate'), live.get('prev_gold_rate')),
        'gold_changed_at': live.get('gold_changed_at'),
        'silver_change': _change(live.get('silver_rate'), live.get('prev_silver_rate')),
        'silver_changed_at': live.get('silver_changed_at'),
    }


def _change(now, prev):
    return round(now - prev) if now is not None and prev is not None else None


@router.get('/public/instagram')
async def public_instagram():
    """Backs the website's Instagram rail (website/index.html) — same
    always-200 discipline as /public/rates: whatever's cached, even an
    empty list before the shop ever connects Instagram or if the last
    fetch failed (see instagram_service.py's _store_media, which never
    wipes the last known-good posts on a transient failure)."""
    cache = await db.settings.find_one({'id': 'instagram_media'}, {'_id': 0}) or {}
    return {
        'username': cache.get('username'),
        'fetched_at': cache.get('fetched_at'),
        'posts': cache.get('posts') or [],
    }


# ---------------- Visitor ticker (website) ----------------
# The website pings this once when it opens and then every minute while it's
# open. Only counts are kept: one row per day with that day's visits, a
# running total, and a short-lived row per open tab (a random id the browser
# makes up — no IP, no name, nothing about who it is) to show "here now".
LIVE_WINDOW = timedelta(minutes=2)


class VisitIn(BaseModel):
    sid: str = Field(pattern=r'^[A-Za-z0-9_-]{8,40}$')   # random per tab
    new: bool = False                                      # first open of the day on this device


def _ist_day() -> str:
    return (now_utc() + timedelta(hours=5, minutes=30)).date().isoformat()


@router.post('/public/visit')
async def public_visit(body: VisitIn):
    now = now_utc()
    day = _ist_day()
    await db.site_live.update_one({'sid': body.sid}, {'$set': {'sid': body.sid, 'at': now.isoformat()}}, upsert=True)
    if body.new:
        await db.site_visits.update_one({'id': day}, {'$inc': {'count': 1}}, upsert=True)
        await db.site_visits.update_one({'id': 'total'}, {'$inc': {'count': 1}}, upsert=True)
    cutoff = (now - LIVE_WINDOW).isoformat()
    await db.site_live.delete_many({'at': {'$lt': cutoff}})
    online = await db.site_live.count_documents({})
    today = (await db.site_visits.find_one({'id': day}, {'_id': 0, 'count': 1}) or {}).get('count', 0)
    total = (await db.site_visits.find_one({'id': 'total'}, {'_id': 0, 'count': 1}) or {}).get('count', 0)
    return {'online': max(online, 1), 'today': today, 'total': total}
