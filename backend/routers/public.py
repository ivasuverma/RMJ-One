"""Public, unauthenticated endpoints meant to be reachable by anyone on the
internet — currently just the live gold/silver rates page (see
frontend/app/rates.tsx). Nothing here requires login; keep it that way, and
keep it read-only (or, for the rate-target subscribe endpoint, write-only to
its own narrow collection) — this is the one place in the API a stranger can
call without a token."""
from fastapi import APIRouter
from server import db

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
    }
