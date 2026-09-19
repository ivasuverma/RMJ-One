"""Rate master — the formula that turns the confirmed base rates into each purity's rate.

The Gold Rate screen confirms two base numbers: gold (24k) and silver (99.99). This master
holds one editable formula per product — gold 24k / 22k / 18k / 14k and silver 99.99 — plus a
rounding rule, and works out the rate for each. The LED board uses the results through
placeholders such as {gold_22k} (see routers/led_board.py); `fields_for()` is the one place
other features call to get them.

Formulas are plain arithmetic on the variables `gold` and `silver` (the confirmed base rates):
    gold * 22 / 24          gold * 0.75 + 200          silver * 0.999
They are parsed with `ast` and only numbers, + - * /, parentheses and those two names are
allowed — nothing else is ever executed.
"""
import ast
import math
import operator
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from server import db, now_utc, log_audit, require_owner, require_staff_or_module

router = APIRouter()

# key, label, default formula, base variable it is quoted in, default rounding step
DEFAULTS = [
    {'key': 'gold_24k', 'label': 'Gold 24K', 'formula': 'gold', 'round_to': 50, 'round_mode': 'nearest', 'enabled': True},
    {'key': 'gold_22k', 'label': 'Gold 22K', 'formula': 'gold * 22 / 24', 'round_to': 50, 'round_mode': 'nearest', 'enabled': True},
    {'key': 'gold_18k', 'label': 'Gold 18K', 'formula': 'gold * 18 / 24', 'round_to': 50, 'round_mode': 'nearest', 'enabled': True},
    {'key': 'gold_14k', 'label': 'Gold 14K', 'formula': 'gold * 14 / 24', 'round_to': 50, 'round_mode': 'nearest', 'enabled': True},
    {'key': 'silver_9999', 'label': 'Silver 99.99', 'formula': 'silver', 'round_to': 100, 'round_mode': 'nearest', 'enabled': True},
]
KEYS = [d['key'] for d in DEFAULTS]
ROUND_MODES = ('nearest', 'up', 'down')

_BIN = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}
_UN = {ast.UAdd: operator.pos, ast.USub: operator.neg}


class FormulaError(ValueError):
    pass


def eval_formula(expr: str, gold: float, silver: float) -> float:
    """Evaluate a formula safely. Raises FormulaError with a readable message."""
    if not isinstance(expr, str) or not expr.strip():
        raise FormulaError('Formula is empty')
    if len(expr) > 200:
        raise FormulaError('Formula is too long')
    try:
        tree = ast.parse(expr.strip(), mode='eval')
    except SyntaxError:
        raise FormulaError('Formula is not valid — use numbers, gold, silver, + - * / and brackets')
    env = {'gold': float(gold), 'silver': float(silver)}

    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool):
            return float(n.value)
        if isinstance(n, ast.Name):
            if n.id not in env:
                raise FormulaError(f'Unknown name "{n.id}" — only gold and silver can be used')
            return env[n.id]
        if isinstance(n, ast.BinOp) and type(n.op) in _BIN:
            l, r = ev(n.left), ev(n.right)
            if isinstance(n.op, ast.Div) and r == 0:
                raise FormulaError('Division by zero')
            return _BIN[type(n.op)](l, r)
        if isinstance(n, ast.UnaryOp) and type(n.op) in _UN:
            return _UN[type(n.op)](ev(n.operand))
        raise FormulaError('Only numbers, gold, silver, + - * / and brackets are allowed')

    out = ev(tree)
    if not math.isfinite(out):
        raise FormulaError('Formula gives an invalid number')
    return out


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


async def get_items() -> list:
    doc = await db.settings.find_one({'id': 'rate_master'}, {'_id': 0}) or {}
    saved = {i.get('key'): i for i in (doc.get('items') or [])}
    out = []
    for d in DEFAULTS:
        s = saved.get(d['key']) or {}
        out.append({
            'key': d['key'],
            'label': (s.get('label') or d['label']).strip()[:40],
            'formula': (s.get('formula') or d['formula']).strip(),
            'round_to': int(s.get('round_to') or d['round_to']),
            'round_mode': s.get('round_mode') if s.get('round_mode') in ROUND_MODES else d['round_mode'],
            'enabled': bool(s.get('enabled', d['enabled'])),
        })
    return out


def compute(items: list, gold: int, silver: int) -> list:
    res = []
    for it in items:
        row = {'key': it['key'], 'label': it['label'], 'formula': it['formula'], 'rate': None, 'error': None, 'enabled': it['enabled']}
        try:
            v = round_value(eval_formula(it['formula'], gold, silver), it['round_to'], it['round_mode'])
            if v <= 0:
                raise FormulaError('The rate comes out as zero or less')
            row['rate'] = v
        except FormulaError as e:
            row['error'] = str(e)
        res.append(row)
    return res


async def fields_for(gold: int, silver: int) -> dict:
    """{'gold_24k': 151050, 'gold_22k': ..., ...} — for template placeholders. A key whose
    formula fails is left out (callers fall back to their default text)."""
    return {r['key']: r['rate'] for r in compute(await get_items(), gold, silver) if r['rate'] is not None and r['enabled']}


async def _base() -> Optional[dict]:
    t = await db.settings.find_one({'id': 'gold_rate_today'}, {'_id': 0}) or {}
    if t.get('gold_rate') and t.get('silver_rate'):
        return {'gold': int(t['gold_rate']), 'silver': int(t['silver_rate']), 'date': t.get('date')}
    return None


class RateItemIn(BaseModel):
    key: str
    label: Optional[str] = None
    formula: str
    round_to: int = 1
    round_mode: str = 'nearest'
    enabled: bool = True


class RateMasterIn(BaseModel):
    items: list[RateItemIn]
    gold: Optional[int] = None      # preview only: try the formulas against other base rates
    silver: Optional[int] = None


def _validate(items: list[RateItemIn]) -> list:
    seen = set()
    out = []
    for it in items:
        if it.key not in KEYS or it.key in seen:
            raise HTTPException(status_code=400, detail=f'Unknown or repeated rate "{it.key}"')
        seen.add(it.key)
        if it.round_mode not in ROUND_MODES:
            raise HTTPException(status_code=400, detail='Rounding must be nearest, up or down')
        if not (1 <= it.round_to <= 100000):
            raise HTTPException(status_code=400, detail='Round-to step must be between 1 and 100000')
        try:
            eval_formula(it.formula, 100000, 100000)
        except FormulaError as e:
            raise HTTPException(status_code=400, detail=f'{it.label or it.key}: {e}')
        out.append({'key': it.key, 'label': (it.label or '').strip()[:40] or next(d['label'] for d in DEFAULTS if d['key'] == it.key),
                    'formula': it.formula.strip(), 'round_to': it.round_to, 'round_mode': it.round_mode, 'enabled': it.enabled})
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


@router.post('/rate-master/preview')
async def rate_master_preview(body: RateMasterIn, _: dict = Depends(require_staff_or_module('gold_rate'))):
    """Compute unsaved formulas — powers the live table on the editing screen."""
    base = await _base()
    gold = body.gold if body.gold is not None else (base or {}).get('gold')
    silver = body.silver if body.silver is not None else (base or {}).get('silver')
    if not gold or not silver:
        return {'computed': [], 'base': None}
    items = [{'key': i.key, 'label': i.label or i.key, 'formula': i.formula, 'round_to': max(1, i.round_to),
              'round_mode': i.round_mode if i.round_mode in ROUND_MODES else 'nearest', 'enabled': i.enabled} for i in body.items if i.key in KEYS]
    return {'computed': compute(items, int(gold), int(silver)), 'base': {'gold': int(gold), 'silver': int(silver)}}


@router.put('/rate-master')
async def rate_master_put(body: RateMasterIn, user: dict = Depends(require_owner)):
    items = _validate(body.items)
    await db.settings.update_one({'id': 'rate_master'}, {'$set': {
        'id': 'rate_master', 'items': items, 'updated_at': now_utc().isoformat(),
    }}, upsert=True)
    await log_audit(user, 'settings.rate_master.update', 'settings', 'rate_master', '; '.join(f"{i['key']}={i['formula']}" for i in items)[:200])
    return await rate_master_get(user)
