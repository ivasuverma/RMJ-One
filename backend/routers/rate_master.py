"""Rate master — how each purity's rate is worked out from the confirmed base rates.

The Gold Rate screen confirms two base numbers: gold (24K) and silver (99.99). This master
holds, for each product — gold 24K / 22K / 18K / 14K and silver 99.99 — a PERCENTAGE of its
base rate (18K = 75% of the 24K rate):

    rate = round( base * percent / 100 )

There is deliberately no margin or rounding setting here: the margin (₹ added/subtracted) is
already applied to the base rate itself in Settings › WhatsApp, and the result is rounded the same
way that base rate is — gold to the nearest ₹50, silver to the nearest ₹100.

The LED board uses the results through placeholders such as {gold_22k} (see
routers/led_board.py); `fields_for()` is the one place other features call to get them.
"""
import math
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from server import db, now_utc, log_audit, require_owner, require_staff_or_module, get_current

router = APIRouter()

# base = which confirmed rate the percentage applies to
DEFAULTS = [
    {'key': 'gold_24k', 'label': 'Gold 24K', 'base': 'gold', 'percent': 100.0, 'enabled': True},
    {'key': 'gold_22k', 'label': 'Gold 22K', 'base': 'gold', 'percent': 91.6, 'enabled': True},
    {'key': 'gold_18k', 'label': 'Gold 18K', 'base': 'gold', 'percent': 75.0, 'enabled': True},
    {'key': 'gold_14k', 'label': 'Gold 14K', 'base': 'gold', 'percent': 58.5, 'enabled': True},
    {'key': 'silver_9999', 'label': 'Silver 99.99', 'base': 'silver', 'percent': 100.0, 'enabled': True},
]
ROUND_STEP = {'gold': 50, 'silver': 100}   # the same fixed steps the base rates use (gold_rate.py)
KEYS = [d['key'] for d in DEFAULTS]
_BASE_OF = {d['key']: d['base'] for d in DEFAULTS}


def round_value(v: float, step: int, mode: str) -> int:
    step = max(1, int(step or 1))
    q = v / step
    if mode == 'up':
        q = math.ceil(q - 1e-9)
    elif mode == 'down':
        q = math.floor(q + 1e-9)
    else:
        q = math.floor(q + 0.5)
    return int(q * step)


def _num(v, default):
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


async def get_items() -> list:
    doc = await db.settings.find_one({'id': 'rate_master'}, {'_id': 0}) or {}
    saved = {i.get('key'): i for i in (doc.get('items') or [])}
    out = []
    for d in DEFAULTS:
        s = saved.get(d['key']) or {}
        out.append({
            'key': d['key'], 'base': d['base'],
            'label': (s.get('label') or d['label']).strip()[:40],
            'percent': _num(s.get('percent'), d['percent']),
            'enabled': bool(s.get('enabled', d['enabled'])),
        })
    return out


def compute(items: list, gold: int, silver: int) -> list:
    res = []
    for it in items:
        base_val = gold if it['base'] == 'gold' else silver
        rate = round_value(base_val * it['percent'] / 100.0, ROUND_STEP[it['base']], 'nearest')
        res.append({
            'key': it['key'], 'label': it['label'], 'base': it['base'], 'base_value': base_val,
            'percent': it['percent'], 'enabled': it['enabled'],
            'rate': rate if rate > 0 else None,
            'error': None if rate > 0 else 'The rate comes out as zero or less',
        })
    return res


async def fields_for(gold: int, silver: int) -> dict:
    """{'gold_24k': 151450, 'gold_22k': ..., ...} — for template placeholders. A product whose
    rate can't be worked out, or that is switched off, is left out."""
    return {r['key']: r['rate'] for r in compute(await get_items(), gold, silver) if r['rate'] is not None and r['enabled']}


async def _base() -> Optional[dict]:
    t = await db.settings.find_one({'id': 'gold_rate_today'}, {'_id': 0}) or {}
    if t.get('gold_rate') and t.get('silver_rate'):
        return {'gold': int(t['gold_rate']), 'silver': int(t['silver_rate']), 'date': t.get('date')}
    return None


class RateItemIn(BaseModel):
    key: str
    label: Optional[str] = None
    percent: float
    enabled: bool = True


class RateMasterIn(BaseModel):
    items: list[RateItemIn]
    gold: Optional[int] = None      # preview only: try the percentages against other base rates
    silver: Optional[int] = None


def _validate(items: list[RateItemIn]) -> list:
    seen = set()
    out = []
    for it in items:
        name = it.label or it.key
        if it.key not in KEYS or it.key in seen:
            raise HTTPException(status_code=400, detail=f'Unknown or repeated rate "{it.key}"')
        seen.add(it.key)
        if not math.isfinite(it.percent) or not (0 < it.percent <= 200):
            raise HTTPException(status_code=400, detail=f'{name}: percentage must be more than 0 and at most 200')
        out.append({'key': it.key, 'label': (it.label or '').strip()[:40] or next(d['label'] for d in DEFAULTS if d['key'] == it.key),
                    'percent': round(it.percent, 3), 'enabled': it.enabled})
    order = {k: i for i, k in enumerate(KEYS)}
    return sorted(out, key=lambda i: order[i['key']])


@router.get('/rate-master')
async def rate_master_get(_: dict = Depends(require_staff_or_module('gold_rate'))):
    items = await get_items()
    base = await _base()
    return {
        'items': items, 'base': base, 'defaults': DEFAULTS,
        'computed': compute(items, base['gold'], base['silver']) if base else [],
    }


@router.get('/rate-master/live')
async def rate_master_live(_: dict = Depends(get_current)):
    """Lower-purity gold rates (22K / 18K / 14K ...) worked out from the LIVE 24K rate — the
    same gold_rate_live numbers /public/rates shows — for the in-app live rate screen. Any
    signed-in user may read it (it's the shop counter rate, not a setting); the public page
    never calls it, so strangers still see only 24K and silver."""
    live = await db.settings.find_one({'id': 'gold_rate_live'}, {'_id': 0}) or {}
    sell, buy = live.get('gold_rate'), live.get('gold_buy_rate')
    items = [i for i in await get_items() if i['base'] == 'gold' and i['key'] != 'gold_24k' and i['enabled']]
    if not sell:
        return {'items': []}
    sells = {r['key']: r['rate'] for r in compute(items, int(sell), 0)}
    buys = {r['key']: r['rate'] for r in compute(items, int(buy), 0)} if buy else {}
    return {'items': [{'key': i['key'], 'label': i['label'], 'percent': i['percent'],
                       'sell': sells.get(i['key']), 'buy': buys.get(i['key'])} for i in items]}


@router.post('/rate-master/preview')
async def rate_master_preview(body: RateMasterIn, _: dict = Depends(require_staff_or_module('gold_rate'))):
    """Compute unsaved percentages — powers the live results on the editing screen."""
    base = await _base()
    gold = body.gold if body.gold is not None else (base or {}).get('gold')
    silver = body.silver if body.silver is not None else (base or {}).get('silver')
    if not gold or not silver:
        return {'computed': [], 'base': None}
    if not body.items:      # nothing typed: use the saved percentages
        return {'computed': compute(await get_items(), int(gold), int(silver)), 'base': {'gold': int(gold), 'silver': int(silver)}}
    items = [{'key': i.key, 'label': i.label or i.key, 'base': _BASE_OF[i.key],
              'percent': i.percent if math.isfinite(i.percent) else 0, 'enabled': i.enabled} for i in body.items if i.key in KEYS]
    return {'computed': compute(items, int(gold), int(silver)), 'base': {'gold': int(gold), 'silver': int(silver)}}


@router.put('/rate-master')
async def rate_master_put(body: RateMasterIn, user: dict = Depends(require_owner)):
    items = _validate(body.items)
    await db.settings.update_one({'id': 'rate_master'}, {'$set': {
        'id': 'rate_master', 'items': items, 'updated_at': now_utc().isoformat(),
    }}, upsert=True)
    await log_audit(user, 'settings.rate_master.update', 'settings', 'rate_master',
                    '; '.join(f"{i['key']}={i['percent']}%" for i in items)[:200])
    return await rate_master_get(user)
