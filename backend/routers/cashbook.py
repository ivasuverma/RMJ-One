"""Cash Book: a manual daily cash in/out ledger — the digital version of the
shop's paper cash book (RECEIVED/NAME and PAID/NAME columns with a running
"Counter Bal" at the bottom of each day). Deliberately separate from
cash_ledger (routers/repairs.py's collection, auto-populated from repair
bill cash payments) — entries here are always entered by hand and never
auto-synced from repairs, so the two never mix.

Supports multiple named "counters" — separate cash registers/books (e.g.
one per counter or till) each with their own entries and their own running
balance. Every entry belongs to exactly one counter (cashbook_counters
collection: id, name, opening_balance, active).

Opening balance for a given day, on a given counter, auto-carries forward
from the running total of every earlier entry on that same counter (plus
the counter's own one-time base `opening_balance`, for seeding it with a
real-world starting cash position). There's no stored "opening" row — it's
computed fresh on every read, so it can never drift out of sync if an old
entry is later edited or deleted.

New module — see server.py's 'cash_book' entry in MODULE_DEFS
(employee_assignable, same pattern as samples/repair_bill). Counter
management (create/rename/deactivate) is owner-only — entry CRUD follows
the usual module/right checks and applies across whichever counter the
caller is working in."""
from fastapi import APIRouter, Depends, HTTPException, Query
import uuid
from server import (
    db,
    now_utc,
    require_owner,
    require_staff_or_module,
    require_admin_or_module,
    require_admin_or_module_right,
    CashBookEntryIn,
    CashBookEntryUpdateIn,
    CashBookCounterIn,
    CashBookCounterUpdateIn,
    log_audit,
)

router = APIRouter()


async def _get_counter(counter_id: str) -> dict:
    counter = await db.cashbook_counters.find_one({'id': counter_id}, {'_id': 0})
    if not counter:
        raise HTTPException(status_code=404, detail='Cash Book counter not found')
    return counter


def _employee_allowed_counter_ids(user: dict):
    """None means no restriction (owner/admin/accountant see every active
    counter, same as every other module). An employee only ever sees
    counters the owner has explicitly assigned in User Roles — having the
    'cash_book' module alone is not enough, since a counter is a further
    sub-resource within it."""
    if user.get('role') == 'employee':
        return set(user.get('cashbook_counter_ids') or [])
    return None


def _assert_counter_allowed(user: dict, counter_id: str):
    allowed = _employee_allowed_counter_ids(user)
    if allowed is not None and counter_id not in allowed:
        raise HTTPException(status_code=403, detail='You do not have access to this Cash Book counter')


async def _opening_balance_for(counter_id: str, date: str) -> float:
    """This counter's own base opening balance plus the net (received −
    paid) of every entry on this counter dated strictly before `date` —
    i.e. yesterday's closing Counter Bal for this counter specifically,
    recomputed every time rather than stored, so a later edit/delete to an
    old day can never leave a later day's opening balance stale."""
    counter = await db.cashbook_counters.find_one({'id': counter_id}, {'_id': 0, 'opening_balance': 1})
    base = (counter or {}).get('opening_balance') or 0
    agg = await db.cashbook_entries.aggregate([
        {'$match': {'counter_id': counter_id, 'date': {'$lt': date}}},
        {'$group': {'_id': '$type', 'total': {'$sum': '$amount'}}},
    ]).to_list(10)
    received = sum(a['total'] for a in agg if a['_id'] == 'received')
    paid = sum(a['total'] for a in agg if a['_id'] == 'paid')
    return round(base + received - paid, 2)


# ---------------- Counters ----------------
@router.get('/cashbook/counters')
async def list_cashbook_counters(user: dict = Depends(require_staff_or_module('cash_book'))):
    counters = await db.cashbook_counters.find({'active': True}, {'_id': 0}).sort('created_at', 1).to_list(200)
    allowed = _employee_allowed_counter_ids(user)
    if allowed is not None:
        counters = [c for c in counters if c['id'] in allowed]
    return counters


@router.post('/cashbook/counters')
async def create_cashbook_counter(body: CashBookCounterIn, user=Depends(require_owner)):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail='Name is required')
    counter_id = str(uuid.uuid4())
    counter = {
        'id': counter_id, 'name': body.name.strip(), 'opening_balance': body.opening_balance or 0,
        'active': True, 'created_at': now_utc().isoformat(), 'created_by': user['name'],
    }
    await db.cashbook_counters.insert_one(dict(counter))
    await log_audit(user, 'cashbook.counter.create', 'cashbook_counter', counter_id, counter['name'])
    return {k: v for k, v in counter.items() if k != '_id'}


@router.put('/cashbook/counters/{counter_id}')
async def update_cashbook_counter(counter_id: str, body: CashBookCounterUpdateIn, user=Depends(require_owner)):
    counter = await _get_counter(counter_id)
    upd: dict = {}
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(status_code=400, detail='Name is required')
        upd['name'] = body.name.strip()
    if body.opening_balance is not None:
        upd['opening_balance'] = body.opening_balance
    if body.active is not None:
        upd['active'] = body.active
    if upd:
        await db.cashbook_counters.update_one({'id': counter_id}, {'$set': upd})
        await log_audit(user, 'cashbook.counter.update', 'cashbook_counter', counter_id, counter['name'], upd)
    return await db.cashbook_counters.find_one({'id': counter_id}, {'_id': 0})


@router.delete('/cashbook/counters/{counter_id}')
async def delete_cashbook_counter(counter_id: str, user=Depends(require_owner)):
    counter = await _get_counter(counter_id)
    count = await db.cashbook_entries.count_documents({'counter_id': counter_id})
    if count > 0:
        raise HTTPException(status_code=400, detail=f"This counter has {count} entr{'y' if count == 1 else 'ies'} — deactivate it instead of deleting")
    await db.cashbook_counters.delete_one({'id': counter_id})
    await log_audit(user, 'cashbook.counter.delete', 'cashbook_counter', counter_id, counter['name'])
    return {'ok': True}


# ---------------- Entries ----------------
@router.get('/cashbook/day')
async def get_cashbook_day(date: str = Query(...), counter_id: str = Query(...), user: dict = Depends(require_staff_or_module('cash_book'))):
    _assert_counter_allowed(user, counter_id)
    counter = await _get_counter(counter_id)
    entries = await db.cashbook_entries.find({'date': date, 'counter_id': counter_id}, {'_id': 0}).sort('created_at', 1).to_list(1000)
    opening = await _opening_balance_for(counter_id, date)
    total_received = round(sum(e['amount'] for e in entries if e['type'] == 'received'), 2)
    total_paid = round(sum(e['amount'] for e in entries if e['type'] == 'paid'), 2)
    closing = round(opening + total_received - total_paid, 2)
    return {
        'date': date, 'counter_id': counter_id, 'counter_name': counter['name'],
        'opening_balance': opening, 'entries': entries,
        'total_received': total_received, 'total_paid': total_paid, 'closing_balance': closing,
    }


@router.post('/cashbook/entries')
async def create_cashbook_entry(body: CashBookEntryIn, user=Depends(require_admin_or_module('cash_book'))):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail='Amount must be greater than 0')
    if not body.name.strip():
        raise HTTPException(status_code=400, detail='Name / description is required')
    _assert_counter_allowed(user, body.counter_id)
    counter = await _get_counter(body.counter_id)
    iso = now_utc().isoformat()
    entry_id = str(uuid.uuid4())
    entry = {
        'id': entry_id, 'date': body.date, 'counter_id': counter['id'], 'type': body.type, 'amount': body.amount,
        'name': body.name.strip(), 'note': body.note or '',
        'created_at': iso, 'created_by': user['name'], 'created_by_id': user['id'],
    }
    await db.cashbook_entries.insert_one(dict(entry))
    await log_audit(user, 'cashbook.create', 'cashbook_entry', entry_id, f"{body.type} {body.amount} - {body.name}",
                     {'date': body.date, 'counter': counter['name']})
    return {k: v for k, v in entry.items() if k != '_id'}


@router.put('/cashbook/entries/{entry_id}')
async def update_cashbook_entry(entry_id: str, body: CashBookEntryUpdateIn, user=Depends(require_admin_or_module_right('cash_book', 'edit'))):
    entry = await db.cashbook_entries.find_one({'id': entry_id}, {'_id': 0})
    if not entry:
        raise HTTPException(status_code=404, detail='Entry not found')
    _assert_counter_allowed(user, entry['counter_id'])
    upd: dict = {}
    if body.date is not None: upd['date'] = body.date
    if body.counter_id is not None:
        await _get_counter(body.counter_id)  # 404s if it doesn't exist
        _assert_counter_allowed(user, body.counter_id)
        upd['counter_id'] = body.counter_id
    if body.type is not None: upd['type'] = body.type
    if body.amount is not None:
        if body.amount <= 0:
            raise HTTPException(status_code=400, detail='Amount must be greater than 0')
        upd['amount'] = body.amount
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(status_code=400, detail='Name / description is required')
        upd['name'] = body.name.strip()
    if body.note is not None: upd['note'] = body.note
    if upd:
        upd['updated_at'] = now_utc().isoformat()
        upd['updated_by'] = user['name']
        await db.cashbook_entries.update_one({'id': entry_id}, {'$set': upd})
        await log_audit(user, 'cashbook.update', 'cashbook_entry', entry_id, entry.get('name', ''), upd)
    return await db.cashbook_entries.find_one({'id': entry_id}, {'_id': 0})


@router.delete('/cashbook/entries/{entry_id}')
async def delete_cashbook_entry(entry_id: str, user=Depends(require_admin_or_module_right('cash_book', 'delete'))):
    entry = await db.cashbook_entries.find_one({'id': entry_id}, {'_id': 0})
    if not entry:
        raise HTTPException(status_code=404, detail='Entry not found')
    _assert_counter_allowed(user, entry['counter_id'])
    await db.cashbook_entries.delete_one({'id': entry_id})
    await log_audit(user, 'cashbook.delete', 'cashbook_entry', entry_id, entry.get('name', ''), {'date': entry.get('date')})
    return {'ok': True}
