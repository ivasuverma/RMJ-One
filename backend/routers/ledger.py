"""Unified dual-balance ledger (v2 Phase 5) — the heart of the app.

An *account* is one entity carrying a *type* (from the account_types master),
not a row in a separate customer/karigar/employee directory. Every account and
every entry carries two independent values:

  - fine   : pure-gold-equivalent weight in grams, 3 decimals
  - amount : rupees (₹)

They are NEVER netted into one number. Sign convention (both columns): a
POSITIVE balance/delta = owed *to* the shop (the account owes us); NEGATIVE =
owed *by* the shop (we owe them / they hold an advance). Balances are always
derived — opening position plus the signed sum of entry deltas — never stored,
so editing or deleting an old entry can't leave a balance stale.

This layer is additive. The existing per-party ledgers (karigar_ledger,
repairs billing, employee wage ledger) and their API contracts are untouched;
posting those sources into this unified ledger is a deliberate later
integration step, kept out of here so live bookkeeping isn't double-counted.
See server.py's 'ledger' module in MODULE_DEFS (staff-level, not
employee-assignable)."""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
import re
import uuid
from server import (
    db,
    now_utc,
    require_owner,
    require_staff_or_module,
    AccountTypeIn,
    AccountTypeUpdateIn,
    LedgerAccountIn,
    LedgerAccountUpdateIn,
    LedgerAccountEntryIn,
    _report_pdf,
    _pdf_response,
    log_audit,
)

router = APIRouter()


def _slug(name: str) -> str:
    return ''.join(c if c.isalnum() else '_' for c in name.strip().lower()).strip('_')


async def _get_type(type_id: str) -> dict:
    t = await db.account_types.find_one({'id': type_id}, {'_id': 0})
    if not t:
        raise HTTPException(status_code=404, detail='Account type not found')
    return t


async def _get_account(account_id: str) -> dict:
    a = await db.accounts.find_one({'id': account_id}, {'_id': 0})
    if not a:
        raise HTTPException(status_code=404, detail='Account not found')
    return a


# Digits only, so "98765 43210", "+91-98765..." and "9876543210" all compare
# equal when checking a mobile number is unique.
def _norm_phone(phone: str) -> str:
    return re.sub(r'\D', '', phone or '')


async def _sync_source_active(account: dict, active: bool) -> None:
    """A ledger account created by mirroring a customer/karigar carries a
    `source = {kind, ref}`. When such an account is deactivated or deleted in
    the ledger, reflect that on the source record so the party also disappears
    from the repair pickers — otherwise a "deleted from ledger" customer would
    still show up under Existing Customer. We flip an `active` flag (soft) so
    repair/ledger history stays intact rather than hard-deleting."""
    src = account.get('source') or {}
    kind, ref = src.get('kind'), src.get('ref')
    if not ref:
        return
    if kind == 'customer':
        await db.customers.update_one({'id': ref}, {'$set': {'active': active}})
    elif kind == 'karigar':
        await db.karigars.update_one({'id': ref}, {'$set': {'active': active}})


async def _assert_unique_identity(name: str, phone: str, exclude_id: Optional[str] = None):
    """Every account must have a mobile number, and neither the name nor the
    mobile may collide with another account. Names compare case-insensitively;
    mobiles compare on digits only. Applies across ALL accounts (active or not)
    so a deactivated duplicate still blocks a re-create rather than silently
    creating a second identity."""
    if not name:
        raise HTTPException(status_code=400, detail='Name is required')
    if not _norm_phone(phone):
        raise HTTPException(status_code=400, detail='Mobile number is required for every account')
    name_clash = await db.accounts.find_one(
        {'name': {'$regex': f'^{re.escape(name)}$', '$options': 'i'}, **({'id': {'$ne': exclude_id}} if exclude_id else {})},
        {'_id': 0, 'id': 1},
    )
    if name_clash:
        raise HTTPException(status_code=409, detail=f'An account named "{name}" already exists')
    # Match on normalised digits: pull candidates and compare in Python (stored
    # phones may carry spaces/punctuation the regex-free path can't normalise).
    digits = _norm_phone(phone)
    async for other in db.accounts.find({**({'id': {'$ne': exclude_id}} if exclude_id else {})}, {'_id': 0, 'id': 1, 'phone': 1}):
        if _norm_phone(other.get('phone', '')) == digits:
            raise HTTPException(status_code=409, detail='An account with this mobile number already exists')


async def _balance_for(account: dict) -> dict:
    """Opening position + signed sum of every entry delta for this account.
    Returned as two independent numbers (fine grams / amount ₹), each rounded
    to their own precision (3dp / 2dp)."""
    agg = await db.ledger_entries.aggregate([
        {'$match': {'account_id': account['id']}},
        {'$group': {'_id': None, 'fine': {'$sum': '$fine_delta'}, 'amount': {'$sum': '$amount_delta'}}},
    ]).to_list(1)
    sum_fine = agg[0]['fine'] if agg else 0
    sum_amount = agg[0]['amount'] if agg else 0
    return {
        'fine_balance': round((account.get('opening_fine') or 0) + sum_fine, 3),
        'amount_balance': round((account.get('opening_amount') or 0) + sum_amount, 2),
    }


# ---------------- Account-type master ----------------
@router.get('/account-types')
async def list_account_types(_: dict = Depends(require_staff_or_module('ledger'))):
    return await db.account_types.find({}, {'_id': 0}).sort('sort', 1).to_list(200)


@router.post('/account-types')
async def create_account_type(body: AccountTypeIn, user=Depends(require_owner)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail='Name is required')
    if await db.account_types.find_one({'name': {'$regex': f'^{name}$', '$options': 'i'}}):
        raise HTTPException(status_code=400, detail='A type with this name already exists')
    count = await db.account_types.count_documents({})
    doc = {
        'id': str(uuid.uuid4()), 'name': name, 'key': _slug(name), 'is_system': False,
        'sort': count, 'created_at': now_utc().isoformat(), 'created_by': user['name'],
    }
    await db.account_types.insert_one(dict(doc))
    await log_audit(user, 'ledger.type.create', 'account_type', doc['id'], name)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.put('/account-types/{type_id}')
async def update_account_type(type_id: str, body: AccountTypeUpdateIn, user=Depends(require_owner)):
    t = await _get_type(type_id)
    upd: dict = {}
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(status_code=400, detail='Name is required')
        upd['name'] = body.name.strip()
    if body.sort is not None:
        upd['sort'] = body.sort
    if upd:
        await db.account_types.update_one({'id': type_id}, {'$set': upd})
        await log_audit(user, 'ledger.type.update', 'account_type', type_id, t['name'], upd)
    return await db.account_types.find_one({'id': type_id}, {'_id': 0})


@router.delete('/account-types/{type_id}')
async def delete_account_type(type_id: str, user=Depends(require_owner)):
    t = await _get_type(type_id)
    if t.get('is_system'):
        raise HTTPException(status_code=400, detail='System account types cannot be deleted')
    used = await db.accounts.count_documents({'type_id': type_id})
    if used > 0:
        raise HTTPException(status_code=400, detail=f'{used} account(s) use this type — reassign them first')
    await db.account_types.delete_one({'id': type_id})
    await log_audit(user, 'ledger.type.delete', 'account_type', type_id, t['name'])
    return {'ok': True}


# ---------------- Accounts ----------------
@router.get('/accounts')
async def list_accounts(
    type_id: Optional[str] = None, q: Optional[str] = None,
    _: dict = Depends(require_staff_or_module('ledger')),
):
    query: dict = {'active': {'$ne': False}}
    if type_id:
        query['type_id'] = type_id
    if q:
        import re
        q_esc = re.escape(q)
        query['$or'] = [
            {'name': {'$regex': q_esc, '$options': 'i'}},
            {'phone': {'$regex': q_esc, '$options': 'i'}},
        ]
    accounts = await db.accounts.find(query, {'_id': 0}).sort('name', 1).to_list(2000)
    type_names = {t['id']: t['name'] async for t in db.account_types.find({}, {'_id': 0, 'id': 1, 'name': 1})}

    net_fine = 0.0
    net_amount = 0.0
    for a in accounts:
        bal = await _balance_for(a)
        a['fine_balance'] = bal['fine_balance']
        a['amount_balance'] = bal['amount_balance']
        a['type_name'] = type_names.get(a['type_id'], '—')
        net_fine += bal['fine_balance']
        net_amount += bal['amount_balance']
    return {
        'accounts': accounts,
        'net_fine': round(net_fine, 3),
        'net_amount': round(net_amount, 2),
        'count': len(accounts),
    }


@router.post('/accounts')
async def create_account(body: LedgerAccountIn, user=Depends(require_staff_or_module('ledger'))):
    name = body.name.strip()
    phone = (body.phone or '').strip()
    await _assert_unique_identity(name, phone)
    await _get_type(body.type_id)  # 404s if the type doesn't exist
    doc = {
        'id': str(uuid.uuid4()), 'type_id': body.type_id, 'name': name,
        'phone': phone, 'opening_fine': round(body.opening_fine or 0, 3),
        'opening_amount': round(body.opening_amount or 0, 2), 'note': body.note or '',
        'active': True, 'created_at': now_utc().isoformat(), 'created_by': user['name'],
    }
    await db.accounts.insert_one(dict(doc))
    await log_audit(user, 'ledger.account.create', 'account', doc['id'], doc['name'],
                    {'type_id': body.type_id, 'opening_fine': doc['opening_fine'], 'opening_amount': doc['opening_amount']})
    return {k: v for k, v in doc.items() if k != '_id'}


@router.get('/accounts/{account_id}')
async def get_account(account_id: str, _: dict = Depends(require_staff_or_module('ledger'))):
    account = await _get_account(account_id)
    t = await db.account_types.find_one({'id': account['type_id']}, {'_id': 0, 'name': 1})
    entries = await db.ledger_entries.find({'account_id': account_id}, {'_id': 0}).sort('date', 1).to_list(5000)
    # Also sort by created_at within the same date so a running balance reads
    # in the order entries were actually recorded.
    entries.sort(key=lambda e: (e.get('date', ''), e.get('created_at', '')))
    bal = await _balance_for(account)
    # Running balances down the statement, starting from the opening position.
    run_fine = account.get('opening_fine') or 0
    run_amount = account.get('opening_amount') or 0
    for e in entries:
        run_fine = round(run_fine + (e.get('fine_delta') or 0), 3)
        run_amount = round(run_amount + (e.get('amount_delta') or 0), 2)
        e['running_fine'] = run_fine
        e['running_amount'] = run_amount
    return {
        'account': account,
        'type_name': (t or {}).get('name', '—'),
        'fine_balance': bal['fine_balance'],
        'amount_balance': bal['amount_balance'],
        'entries': entries,
    }


@router.put('/accounts/{account_id}')
async def update_account(account_id: str, body: LedgerAccountUpdateIn, user=Depends(require_staff_or_module('ledger'))):
    account = await _get_account(account_id)
    upd: dict = {}
    if body.type_id is not None:
        await _get_type(body.type_id)
        upd['type_id'] = body.type_id
    # Resolve the would-be name/phone (fall back to current) and re-check the
    # uniqueness + mobile-required invariant whenever either one is edited.
    if body.name is not None or body.phone is not None:
        new_name = (body.name if body.name is not None else account.get('name', '')).strip()
        new_phone = (body.phone if body.phone is not None else account.get('phone', '')).strip()
        await _assert_unique_identity(new_name, new_phone, exclude_id=account_id)
        if body.name is not None:
            upd['name'] = new_name
        if body.phone is not None:
            upd['phone'] = new_phone
    if body.opening_fine is not None:
        upd['opening_fine'] = round(body.opening_fine, 3)
    if body.opening_amount is not None:
        upd['opening_amount'] = round(body.opening_amount, 2)
    if body.note is not None:
        upd['note'] = body.note
    if body.active is not None:
        upd['active'] = body.active
    if upd:
        upd['updated_at'] = now_utc().isoformat()
        await db.accounts.update_one({'id': account_id}, {'$set': upd})
        if body.active is not None:
            await _sync_source_active(account, body.active)
        await log_audit(user, 'ledger.account.update', 'account', account_id, account['name'], upd)
    return await db.accounts.find_one({'id': account_id}, {'_id': 0})


@router.delete('/accounts/{account_id}')
async def delete_account(account_id: str, user=Depends(require_staff_or_module('ledger'))):
    account = await _get_account(account_id)
    n = await db.ledger_entries.count_documents({'account_id': account_id})
    if n > 0:
        raise HTTPException(status_code=400, detail=f'This account has {n} ledger entr{"y" if n == 1 else "ies"} — deactivate it instead of deleting')
    await db.accounts.delete_one({'id': account_id})
    await _sync_source_active(account, False)  # hide the source party from pickers too
    await log_audit(user, 'ledger.account.delete', 'account', account_id, account['name'])
    return {'ok': True}


# ---------------- Entries ----------------
@router.post('/accounts/{account_id}/entries')
async def add_entry(account_id: str, body: LedgerAccountEntryIn, user=Depends(require_staff_or_module('ledger'))):
    account = await _get_account(account_id)
    fine = round(body.fine_delta or 0, 3)
    amount = round(body.amount_delta or 0, 2)
    if fine == 0 and amount == 0:
        raise HTTPException(status_code=400, detail='Enter a gold (fine) and/or cash (amount) movement')
    if not body.particulars.strip():
        raise HTTPException(status_code=400, detail='Particulars are required')
    doc = {
        'id': str(uuid.uuid4()), 'account_id': account_id, 'date': body.date,
        'particulars': body.particulars.strip(), 'fine_delta': fine, 'amount_delta': amount,
        'note': body.note or '', 'source': 'manual', 'ref_id': None,
        'created_at': now_utc().isoformat(), 'created_by': user['name'],
    }
    await db.ledger_entries.insert_one(dict(doc))
    await log_audit(user, 'ledger.entry.create', 'ledger_entry', doc['id'],
                    f"{account['name']}: {body.particulars.strip()}", {'fine': fine, 'amount': amount})
    return {k: v for k, v in doc.items() if k != '_id'}


@router.delete('/accounts/{account_id}/entries/{entry_id}')
async def delete_entry(account_id: str, entry_id: str, user=Depends(require_staff_or_module('ledger'))):
    entry = await db.ledger_entries.find_one({'id': entry_id, 'account_id': account_id}, {'_id': 0})
    if not entry:
        raise HTTPException(status_code=404, detail='Entry not found')
    # Only manually-added entries can be removed here — entries posted by
    # another source (repair/payroll/etc., once that integration exists) must
    # be undone at their source, not orphaned from it.
    if entry.get('source') and entry['source'] != 'manual':
        raise HTTPException(status_code=400, detail=f"This entry came from {entry['source']} — undo it there, not here")
    await db.ledger_entries.delete_one({'id': entry_id})
    await log_audit(user, 'ledger.entry.delete', 'ledger_entry', entry_id, entry.get('particulars', ''))
    return {'ok': True}


@router.get('/accounts/{account_id}/pdf')
async def account_pdf(account_id: str, _: dict = Depends(require_staff_or_module('ledger'))):
    detail = await get_account(account_id, _)
    account = detail['account']
    entries = detail['entries']

    def g(x):
        return f"{x:+.3f}" if x else ''

    def r(x):
        return f"{x:+,.2f}" if x else ''

    rows = [[
        e['date'], e['particulars'], g(e.get('fine_delta') or 0), r(e.get('amount_delta') or 0),
        f"{e['running_fine']:.3f}", f"{e['running_amount']:,.2f}",
    ] for e in entries]
    subtitle = (
        f"{detail['type_name']}"
        f"{' · ' + account['phone'] if account.get('phone') else ''}"
        f"  |  Fine balance {detail['fine_balance']:.3f} g  ·  Amount balance ₹{detail['amount_balance']:,.2f}"
    )
    pdf = _report_pdf(
        f"Ledger — {account['name']}", subtitle,
        ['Date', 'Particulars', 'Fine ±(g)', 'Amount ±(₹)', 'Fine bal (g)', 'Amount bal (₹)'], rows,
    )
    return _pdf_response(pdf, f"ledger-{_slug(account['name'])}.pdf")
