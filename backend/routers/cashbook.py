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
import re
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
    CashBookQuickNameIn,
    log_audit,
    _notify_module,
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


@router.get('/cashbook/counters/transfer-options')
async def list_transfer_counter_options(_: dict = Depends(require_staff_or_module('cash_book'))):
    """Id + name only, for every active counter — deliberately NOT filtered
    by an employee's own cashbook_counter_ids (unlike GET /cashbook/counters
    above). Picking a counter as a transfer partner is allowed even for a
    counter the employee can't otherwise view; this endpoint exposes just
    enough (its name) to let them pick it, with no balances or entries."""
    return await db.cashbook_counters.find({'active': True}, {'_id': 0, 'id': 1, 'name': 1}).sort('name', 1).to_list(200)


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


# ---------------- Quick Names (reusable Name/Description presets) ----------------
@router.get('/cashbook/quick-names')
async def list_quick_names(_: dict = Depends(require_staff_or_module('cash_book'))):
    return await db.cashbook_quick_names.find({}, {'_id': 0}).sort('name', 1).to_list(500)


@router.post('/cashbook/quick-names')
async def create_quick_name(body: CashBookQuickNameIn, user=Depends(require_admin_or_module('cash_book'))):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail='Name is required')
    existing = await db.cashbook_quick_names.find_one({'name': {'$regex': f'^{re.escape(name)}$', '$options': 'i'}}, {'_id': 0})
    if existing:
        return existing
    quick_id = str(uuid.uuid4())
    doc = {'id': quick_id, 'name': name, 'created_at': now_utc().isoformat(), 'created_by': user['name']}
    await db.cashbook_quick_names.insert_one(dict(doc))
    await log_audit(user, 'cashbook.quickname.create', 'cashbook_quick_name', quick_id, name)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.delete('/cashbook/quick-names/{quick_id}')
async def delete_quick_name(quick_id: str, user=Depends(require_admin_or_module_right('cash_book', 'delete'))):
    doc = await db.cashbook_quick_names.find_one({'id': quick_id}, {'_id': 0})
    if not doc:
        raise HTTPException(status_code=404, detail='Not found')
    await db.cashbook_quick_names.delete_one({'id': quick_id})
    await log_audit(user, 'cashbook.quickname.delete', 'cashbook_quick_name', quick_id, doc.get('name', ''))
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

    # The transfer counterparty is deliberately NOT access-checked: an
    # employee can complete a transfer to/from a counter they aren't
    # otherwise assigned to (e.g. handing cash to the locker) without that
    # granting them any ability to browse the locker's own day ledger —
    # naming a counter as a transfer partner isn't the same as viewing it.
    other_counter = None
    if body.transfer_counter_id:
        if body.transfer_counter_id == body.counter_id:
            raise HTTPException(status_code=400, detail='Transfer counter must be different from this entry\'s counter')
        other_counter = await _get_counter(body.transfer_counter_id)

    iso = now_utc().isoformat()
    entry_id = str(uuid.uuid4())
    entry = {
        'id': entry_id, 'date': body.date, 'counter_id': counter['id'], 'type': body.type, 'amount': body.amount,
        'name': body.name.strip(), 'note': body.note or '',
        'created_at': iso, 'created_by': user['name'], 'created_by_id': user['id'],
        'linked_entry_id': None, 'transfer_counter_id': other_counter['id'] if other_counter else None,
    }

    mirror = None
    if other_counter:
        mirror_id = str(uuid.uuid4())
        mirror_type = 'paid' if body.type == 'received' else 'received'
        mirror = {
            'id': mirror_id, 'date': body.date, 'counter_id': other_counter['id'], 'type': mirror_type, 'amount': body.amount,
            'name': f"Transfer {'to' if mirror_type == 'paid' else 'from'} {counter['name']}", 'note': body.note or '',
            'created_at': iso, 'created_by': user['name'], 'created_by_id': user['id'],
            'linked_entry_id': entry_id, 'transfer_counter_id': counter['id'],
        }
        entry['linked_entry_id'] = mirror_id

    await db.cashbook_entries.insert_one(dict(entry))
    if mirror:
        await db.cashbook_entries.insert_one(dict(mirror))

    await log_audit(user, 'cashbook.create', 'cashbook_entry', entry_id, f"{body.type} {body.amount} - {body.name}",
                     {'date': body.date, 'counter': counter['name'], 'transfer_to': other_counter['name'] if other_counter else None})

    # Notify owners/admins on cash movement.
    amt = f"₹{body.amount:,.0f}"
    if other_counter:
        # Direction: a 'received' entry means cash came INTO this counter from
        # the other; a 'paid' entry means it went OUT to the other.
        src, dst = (other_counter, counter) if body.type == 'received' else (counter, other_counter)
        await _notify_module(
            'cash_book', 'Cash transferred between counters',
            f"{amt}: {src['name']} → {dst['name']} · by {user['name']}",
            '/cashbook', script='cashbook_transfer',
        )
    elif user.get('role') == 'employee':
        direction = 'in' if body.type == 'received' else 'out'
        await _notify_module(
            'cash_book', f"{user['name']} recorded cash {direction}",
            f"{amt} · {counter['name']} · {body.name.strip()}",
            '/cashbook', script='cashbook_entry',
        )
    return {k: v for k, v in entry.items() if k != '_id'}


@router.put('/cashbook/entries/{entry_id}')
async def update_cashbook_entry(entry_id: str, body: CashBookEntryUpdateIn, user=Depends(require_admin_or_module_right('cash_book', 'edit'))):
    entry = await db.cashbook_entries.find_one({'id': entry_id}, {'_id': 0})
    if not entry:
        raise HTTPException(status_code=404, detail='Entry not found')
    _assert_counter_allowed(user, entry['counter_id'])
    linked_id = entry.get('linked_entry_id')
    if linked_id and (body.type is not None or body.counter_id is not None):
        raise HTTPException(status_code=400, detail='This entry is linked to a transfer — delete and re-add it to change its type or counter')
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
        # Keep a linked transfer's other side in sync on whatever actually
        # changed here (date/amount/note) — name is deliberately NOT synced,
        # since each side legitimately describes itself differently
        # ("Transfer to X" vs whatever the user typed on this side).
        if linked_id:
            mirror_upd = {k: v for k, v in upd.items() if k in ('date', 'amount', 'note')}
            if mirror_upd:
                await db.cashbook_entries.update_one({'id': linked_id}, {'$set': mirror_upd})
        # Alert owners/admins when an employee edits an entry — with what changed.
        if user.get('role') == 'employee':
            changes = []
            if 'amount' in upd and float(upd['amount']) != float(entry.get('amount') or 0):
                changes.append(f"amount ₹{float(entry.get('amount') or 0):,.0f} → ₹{float(upd['amount']):,.0f}")
            if 'type' in upd and upd['type'] != entry.get('type'):
                changes.append(f"type {entry.get('type')} → {upd['type']}")
            if 'name' in upd and upd['name'] != entry.get('name'):
                changes.append(f"name '{entry.get('name', '')}' → '{upd['name']}'")
            if 'date' in upd and upd['date'] != entry.get('date'):
                changes.append(f"date {entry.get('date')} → {upd['date']}")
            if 'note' in upd and (upd.get('note') or '') != (entry.get('note') or ''):
                changes.append('note changed')
            if changes:
                await _notify_module(
                    'cash_book', f"{user['name']} edited a cash entry",
                    ('; '.join(changes))[:300], '/cashbook', script='cashbook_edit',
                )
    return await db.cashbook_entries.find_one({'id': entry_id}, {'_id': 0})


@router.delete('/cashbook/entries/{entry_id}')
async def delete_cashbook_entry(entry_id: str, user=Depends(require_admin_or_module_right('cash_book', 'delete'))):
    entry = await db.cashbook_entries.find_one({'id': entry_id}, {'_id': 0})
    if not entry:
        raise HTTPException(status_code=404, detail='Entry not found')
    _assert_counter_allowed(user, entry['counter_id'])
    # No access check on the linked entry's counter here either, for the
    # same reason as on create — undoing a transfer to/from a counter this
    # employee can't browse must still be possible from this side.
    linked_id = entry.get('linked_entry_id')
    await db.cashbook_entries.delete_one({'id': entry_id})
    if linked_id:
        # A transfer is one action against two books — deleting one side
        # without the other would leave a phantom, unbalanced entry behind.
        await db.cashbook_entries.delete_one({'id': linked_id})
    await log_audit(user, 'cashbook.delete', 'cashbook_entry', entry_id, entry.get('name', ''), {'date': entry.get('date'), 'linked_entry_id': linked_id})
    return {'ok': True}
