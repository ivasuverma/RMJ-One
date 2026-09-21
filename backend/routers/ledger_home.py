"""Ledger home — the Day Book, the Ledger tab's one-call summary, and per-user tab preferences.

Ledger phase 5. (Paths avoid /ledger/... on purpose: /ledger/{emp_id} is the employee ledger.) The Day Book is the "one journal" view: every ledger entry across the books, newest first, in a
single list — a READ view built over the existing ledgers (nothing is copied or moved), so it can never disagree
with them. Cancelled entries are not shown (they live in a separate store and stay on the karigar's own ledger).

Sources: karigar gold + labour entries, employee wage/advance entries, repair bills, and the opening gold stock.
The Cash Book is a separate book and is not part of this list.

Sign convention (same as everywhere): fine gold POSITIVE = the karigar holds it; amount POSITIVE = the shop owes.
For an employee, amount POSITIVE = the shop owes the employee (salary); negative = advance/fine paid out or deducted.
"""
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from server import (
    db, now_utc, get_current, require_staff_or_module, _karigar_ledger_balances, _ledger_sign,
)
from routers.statements import entry_deltas, _label

router = APIRouter()

KINDS = ('karigar', 'employee', 'bill', 'stock')


def _day(iso):
    return (iso or '')[:10]


async def _vouchers(kinds: set, date_from: Optional[str], date_to: Optional[str], q: Optional[str]) -> list:
    """Every entry of the requested kinds inside the date range, as one flat list (unsorted)."""
    rng = {}
    if date_from:
        rng['$gte'] = date_from
    if date_to:
        rng['$lte'] = f'{date_to}T23:59:59.999999+00:00'
    f = {'created_at': rng} if rng else {}
    out = []

    if 'karigar' in kinds:
        names = {k['id']: k['name'] async for k in db.karigars.find({}, {'_id': 0, 'id': 1, 'name': 1})}
        async for e in db.karigar_ledger.find(f, {'_id': 0}):
            fd, ad = entry_deltas(e)
            out.append({
                'id': e['id'], 'kind': 'karigar', 'created_at': e.get('created_at'), 'date': _day(e.get('created_at')),
                'party': e.get('karigar_name') or names.get(e.get('karigar_id'), ''), 'party_id': e.get('karigar_id'),
                'job_id': e.get('item_id'), 'job': e.get('item_code'), 'label': _label(e), 'note': e.get('note') or '',
                'fine_delta': round(fd, 3), 'amount_delta': round(ad, 2), 'by': e.get('created_by'),
            })

    if 'employee' in kinds:
        enames = {k['id']: k['name'] async for k in db.employees.find({}, {'_id': 0, 'id': 1, 'name': 1})}
        async for e in db.timeline.find({**f, 'type': {'$in': ['advance', 'bonus', 'fine', 'deduction', 'salary', 'salary_earned', 'salary_paid']}}, {'_id': 0}):
            amt = float(e.get('amount') or 0)
            t = e.get('type')
            delta = abs(amt) if t in ('salary', 'salary_earned', 'bonus') else -abs(amt) if t == 'salary_paid' else e.get('sign', _ledger_sign(t)) * abs(amt)
            out.append({
                'id': e['id'], 'kind': 'employee', 'created_at': e.get('created_at'), 'date': _day(e.get('created_at')),
                'party': enames.get(e.get('employee_id'), ''), 'party_id': e.get('employee_id'), 'job_id': None, 'job': None,
                'label': e.get('title') or t.replace('_', ' ').title(), 'note': e.get('description') or '',
                'fine_delta': 0.0, 'amount_delta': round(delta, 2), 'by': e.get('added_by'),
            })

    if 'bill' in kinds:
        async for it in db.repair_items.find({'billed_amount': {'$gt': 0}}, {'_id': 0}):
            when = it.get('delivered_at') or it.get('updated_at') or it.get('created_at') or ''
            if rng and not ((not date_from or when >= date_from) and (not date_to or when <= rng['$lte'])):
                continue
            out.append({
                'id': f"bill-{it['id']}", 'kind': 'bill', 'created_at': when, 'date': _day(when),
                'party': it.get('customer_name') or '', 'party_id': None, 'job_id': it['id'], 'job': it.get('item_code'),
                'label': 'Repair bill', 'note': it.get('description') or '', 'fine_delta': 0.0,
                'amount_delta': round(float(it['billed_amount']), 2), 'by': it.get('delivered_by') or it.get('updated_by'),
            })

    if 'stock' in kinds:
        op = await db.metal_ledger.find_one({'type': 'opening'}, {'_id': 0})
        if op and (not rng or ((not date_from or op.get('created_at', '') >= date_from) and (not date_to or op.get('created_at', '') <= rng['$lte']))):
            out.append({
                'id': op['id'], 'kind': 'stock', 'created_at': op.get('created_at'), 'date': op.get('date') or _day(op.get('created_at')),
                'party': 'Shop gold stock', 'party_id': None, 'job_id': None, 'job': None, 'label': 'Opening stock (physical count)',
                'note': op.get('note') or '', 'fine_delta': 0.0, 'amount_delta': 0.0, 'stock_weight': op.get('weight'), 'by': op.get('created_by'),
            })

    if q and q.strip():
        needle = q.strip().lower()
        out = [v for v in out if needle in f"{v['party']} {v.get('job') or ''} {v['label']} {v['note']}".lower()]
    return out


@router.get('/daybook')
async def day_book(
    kind: Optional[str] = None, q: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
    cursor: Optional[str] = None, limit: int = 50,
    _: dict = Depends(require_staff_or_module(['karigar_ledger', 'customer_ledger'])),
):
    for label, v in (('from', date_from), ('to', date_to)):
        if v and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', v):
            raise HTTPException(status_code=400, detail=f'{label} must be a date like 2026-09-30')
    kinds = {kind} if kind in KINDS else set(KINDS)
    limit = max(1, min(limit, 200))
    rows = await _vouchers(kinds, date_from, date_to, q)
    rows.sort(key=lambda v: (v.get('created_at') or '', v['id']), reverse=True)
    if cursor:
        rows = [v for v in rows if (v.get('created_at') or '', v['id']) < tuple(cursor.split('|', 1))]
    page = rows[:limit]
    nxt = f"{page[-1].get('created_at') or ''}|{page[-1]['id']}" if len(rows) > limit else None
    return {'entries': page, 'next_cursor': nxt, 'count': len(rows), 'kinds': list(KINDS)}


@router.get('/ledger-summary')
async def ledger_summary(_: dict = Depends(require_staff_or_module(['karigar_ledger', 'customer_ledger']))):
    """The Ledger tab's row summaries in ONE call (it used to fetch whole customer/karigar lists just to add them up)."""
    active_c = {c['id'] async for c in db.customers.find({'active': {'$ne': False}}, {'_id': 0, 'id': 1})}
    orders = {o['id']: o.get('customer_id') async for o in db.repair_orders.find({}, {'_id': 0, 'id': 1, 'customer_id': 1})}
    open_items = open_weight = 0
    async for it in db.repair_items.find({'status': {'$ne': 'delivered'}}, {'_id': 0, 'order_id': 1, 'gross_weight': 1}):
        if orders.get(it.get('order_id')) in active_c:
            open_items += 1
            open_weight += it.get('gross_weight') or 0
    bal = _karigar_ledger_balances(await db.karigar_ledger.find({}, {'_id': 0}).to_list(None))
    fine = round(sum(b['fine_bal'] for b in bal.values()), 3)
    amt = round(sum(b['amt_due'] for b in bal.values()), 2)
    loss = [t async for t in db.karigar_ledger.aggregate([{'$match': {'type': 'loss'}}, {'$group': {'_id': None, 'w': {'$sum': '$weight'}, 'f': {'$sum': '$fine_weight'}}}])]
    metal = {t['_id']: (t['w'] or 0) async for t in db.metal_ledger.aggregate([{'$group': {'_id': '$type', 'w': {'$sum': '$weight'}}}])}
    return {
        'customer': {'open_items': open_items, 'open_weight': round(open_weight, 3)},
        'karigar': {'fine': fine, 'amount': amt},
        'loss': {'weight': round(loss[0]['w'] or 0, 3) if loss else 0, 'fine': round(loss[0]['f'] or 0, 3) if loss else 0},
        'metal': {'balance': round(metal.get('opening', 0) + metal.get('in', 0) - metal.get('out', 0), 3), 'loss': round(metal.get('loss', 0), 3),
                  'has_opening': 'opening' in metal},
    }


class UiPrefsIn(BaseModel):
    ledger_order: Optional[list[str]] = None
    ledger_hidden: Optional[list[str]] = None


@router.get('/me/ui-prefs')
async def get_ui_prefs(user: dict = Depends(get_current)):
    d = await db.user_prefs.find_one({'user_id': user['id']}, {'_id': 0}) or {}
    return {'ledger_order': d.get('ledger_order') or [], 'ledger_hidden': d.get('ledger_hidden') or []}


@router.put('/me/ui-prefs')
async def put_ui_prefs(body: UiPrefsIn, user: dict = Depends(get_current)):
    """Which ledgers this person shows on the Ledger tab and in what order — saved per user, so it follows them to any device."""
    upd = {'updated_at': now_utc().isoformat()}
    for k in ('ledger_order', 'ledger_hidden'):
        v = getattr(body, k)
        if v is not None:
            upd[k] = [str(x)[:40] for x in v][:50]
    await db.user_prefs.update_one({'user_id': user['id']}, {'$set': {'user_id': user['id'], **upd}}, upsert=True)
    return await get_ui_prefs(user)
