"""Cash Book: a manual daily cash in/out ledger — the digital version of the
shop's paper cash book (RECEIVED/NAME and PAID/NAME columns with a running
"Counter Bal" at the bottom of each day). Deliberately separate from
cash_ledger (routers/repairs.py's collection, auto-populated from repair
bill cash payments) — entries here are always entered by hand and never
auto-synced from repairs, so the two never mix.

Opening balance for a given day auto-carries forward from the running total
of every earlier entry (plus a one-time base `opening_balance` set via Cash
Book settings, for seeding the ledger with a real-world starting cash
position when the shop switches over from the paper book). There's no
stored "opening" row — it's computed fresh on every read, so it can never
drift out of sync if an old entry is later edited or deleted.

New module — see server.py's 'cash_book' entry in MODULE_DEFS
(employee_assignable, same pattern as samples/repair_bill)."""
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
    CashBookSettingsIn,
    log_audit,
)

router = APIRouter()


async def _base_opening_balance() -> float:
    doc = await db.settings.find_one({'id': 'cash_book'}, {'_id': 0})
    return (doc or {}).get('opening_balance') or 0


async def _opening_balance_for(date: str) -> float:
    """Base opening balance plus the net (received − paid) of every entry
    dated strictly before `date` — i.e. yesterday's closing Counter Bal,
    recomputed every time rather than stored, so a later edit/delete to an
    old day can never leave a later day's opening balance stale."""
    base = await _base_opening_balance()
    agg = await db.cashbook_entries.aggregate([
        {'$match': {'date': {'$lt': date}}},
        {'$group': {'_id': '$type', 'total': {'$sum': '$amount'}}},
    ]).to_list(10)
    received = sum(a['total'] for a in agg if a['_id'] == 'received')
    paid = sum(a['total'] for a in agg if a['_id'] == 'paid')
    return round(base + received - paid, 2)


@router.get('/cashbook/day')
async def get_cashbook_day(date: str = Query(...), _: dict = Depends(require_staff_or_module('cash_book'))):
    entries = await db.cashbook_entries.find({'date': date}, {'_id': 0}).sort('created_at', 1).to_list(1000)
    opening = await _opening_balance_for(date)
    total_received = round(sum(e['amount'] for e in entries if e['type'] == 'received'), 2)
    total_paid = round(sum(e['amount'] for e in entries if e['type'] == 'paid'), 2)
    closing = round(opening + total_received - total_paid, 2)
    return {
        'date': date, 'opening_balance': opening, 'entries': entries,
        'total_received': total_received, 'total_paid': total_paid, 'closing_balance': closing,
    }


@router.post('/cashbook/entries')
async def create_cashbook_entry(body: CashBookEntryIn, user=Depends(require_admin_or_module('cash_book'))):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail='Amount must be greater than 0')
    if not body.name.strip():
        raise HTTPException(status_code=400, detail='Name / description is required')
    iso = now_utc().isoformat()
    entry_id = str(uuid.uuid4())
    entry = {
        'id': entry_id, 'date': body.date, 'type': body.type, 'amount': body.amount,
        'name': body.name.strip(), 'note': body.note or '',
        'created_at': iso, 'created_by': user['name'], 'created_by_id': user['id'],
    }
    await db.cashbook_entries.insert_one(dict(entry))
    await log_audit(user, 'cashbook.create', 'cashbook_entry', entry_id, f"{body.type} {body.amount} - {body.name}",
                     {'date': body.date})
    return {k: v for k, v in entry.items() if k != '_id'}


@router.put('/cashbook/entries/{entry_id}')
async def update_cashbook_entry(entry_id: str, body: CashBookEntryUpdateIn, user=Depends(require_admin_or_module_right('cash_book', 'edit'))):
    entry = await db.cashbook_entries.find_one({'id': entry_id}, {'_id': 0})
    if not entry:
        raise HTTPException(status_code=404, detail='Entry not found')
    upd: dict = {}
    if body.date is not None: upd['date'] = body.date
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
    await db.cashbook_entries.delete_one({'id': entry_id})
    await log_audit(user, 'cashbook.delete', 'cashbook_entry', entry_id, entry.get('name', ''), {'date': entry.get('date')})
    return {'ok': True}


@router.get('/cashbook/settings')
async def get_cashbook_settings(_: dict = Depends(require_owner)):
    doc = await db.settings.find_one({'id': 'cash_book'}, {'_id': 0})
    return {'opening_balance': (doc or {}).get('opening_balance') or 0}


@router.put('/cashbook/settings')
async def update_cashbook_settings(body: CashBookSettingsIn, user=Depends(require_owner)):
    await db.settings.update_one(
        {'id': 'cash_book'},
        {'$set': {'id': 'cash_book', 'opening_balance': body.opening_balance, 'updated_at': now_utc().isoformat()}},
        upsert=True,
    )
    await log_audit(user, 'cashbook.settings.update', 'settings', 'cash_book', 'Cash Book opening balance')
    return {'opening_balance': body.opening_balance}
