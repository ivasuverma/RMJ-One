"""Cash Ledger — a khata of cash given and received, person by person (like
Splitwise / Khatabook).

Self-contained: its own collections (cash_ledger_accounts, cash_ledger_entries)
and nothing else reads them - it never touches the Cash Book counters, Home,
the Day Book, payroll or any other ledger.

An *account* is anyone cash goes to or comes from (a friend, a supplier's
person, family). Each *entry* is either:
  - 'gave' : cash you gave them      -> they owe you more
  - 'got'  : cash you got from them  -> they owe you less
and is in one currency (ISO code: INR, USD, AED…; INR when older entries have
none). Balances are kept PER CURRENCY and never converted into each other -
"Rahul owes you ₹17,500 and $200" - always derived from the entries (never
stored, so editing or deleting an old entry can't leave one wrong):
  > 0  they owe you ("You'll get")      < 0  you owe them ("You'll give")
Photos (a receipt, a chit, a screenshot) attach to an entry through record
photos (ref_type 'cash_ledger_entry'), so they upload to Google Drive like
every other photo.

Module 'cash_ledger': owner by default; the owner can grant it in People.
Editing or deleting an existing entry follows the same rights as other modules.
"""
import re
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from server import (
    db, now_utc, IST, log_audit,
    require_staff_or_module, require_admin_or_module, require_admin_or_module_right,
)

router = APIRouter()
MOD = 'cash_ledger'
BASE_CURRENCY = 'INR'


def _currency(code: Optional[str]) -> str:
    c = (code or BASE_CURRENCY).strip().upper()
    if not re.fullmatch(r'[A-Z]{3}', c):
        raise HTTPException(status_code=400, detail='Currency must be a 3-letter code, e.g. INR or USD')
    return c


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    phone: Optional[str] = ''
    note: Optional[str] = ''
    currency: Optional[str] = None      # the one new entries start in


class EntryIn(BaseModel):
    direction: Literal['gave', 'got']
    amount: float = Field(gt=0, le=100_000_000)
    currency: Optional[str] = None      # INR when missing
    date: Optional[str] = None          # YYYY-MM-DD (IST); today when missing
    note: Optional[str] = ''


def _today() -> str:
    return now_utc().astimezone(IST).date().isoformat()


def _clean_date(d: Optional[str]) -> str:
    if not d:
        return _today()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', d):
        raise HTTPException(status_code=400, detail='Date must be YYYY-MM-DD')
    return d


def _nonzero(b: dict) -> dict:
    return {c: round(v, 2) for c, v in b.items() if abs(v) >= 0.005}


async def _balances(account_ids: Optional[list] = None) -> dict:
    """{account_id: {balances: {currency: amount}, entries, last_date}}."""
    match = {'deleted': {'$ne': True}}
    if account_ids is not None:
        match['account_id'] = {'$in': account_ids}
    out: dict = {}
    async for g in db.cash_ledger_entries.aggregate([
        {'$match': match},
        {'$group': {
            '_id': {'a': '$account_id', 'c': {'$ifNull': ['$currency', BASE_CURRENCY]}},
            'balance': {'$sum': {'$cond': [{'$eq': ['$direction', 'gave']}, '$amount', {'$multiply': ['$amount', -1]}]}},
            'entries': {'$sum': 1},
            'last_date': {'$max': '$date'},
        }},
    ]):
        a = out.setdefault(g['_id']['a'], {'balances': {}, 'entries': 0, 'last_date': None})
        a['balances'][g['_id']['c']] = g['balance']
        a['entries'] += g['entries']
        a['last_date'] = max(filter(None, [a['last_date'], g['last_date']]), default=None)
    for a in out.values():
        a['balances'] = _nonzero(a['balances'])
    return out


async def _account_or_404(aid: str) -> dict:
    a = await db.cash_ledger_accounts.find_one({'id': aid, 'deleted': {'$ne': True}}, {'_id': 0})
    if not a:
        raise HTTPException(status_code=404, detail='Account not found')
    return a


@router.get('/khata')
async def list_accounts(q: Optional[str] = None, user=Depends(require_staff_or_module(MOD))):
    query = {'deleted': {'$ne': True}}
    if q and q.strip():
        rx = re.escape(q.strip())
        query['$or'] = [{'name': {'$regex': rx, '$options': 'i'}}, {'phone': {'$regex': rx}}]
    accounts = await db.cash_ledger_accounts.find(query, {'_id': 0}).to_list(2000)
    bal = await _balances([a['id'] for a in accounts])
    rows = [{**a, 'currency': a.get('currency') or BASE_CURRENCY,
             **bal.get(a['id'], {'balances': {}, 'entries': 0, 'last_date': None})} for a in accounts]
    # Most recently active first, then by name.
    rows.sort(key=lambda r: (r.get('last_date') or r.get('created_at', '')[:10], r['name'].lower()), reverse=True)
    totals: dict = {}   # {currency: {you_get, you_give}}
    for r in rows:
        for c, v in r['balances'].items():
            t = totals.setdefault(c, {'you_get': 0.0, 'you_give': 0.0})
            t['you_get' if v > 0 else 'you_give'] += abs(v)
    totals = {c: {k: round(v, 2) for k, v in t.items()} for c, t in totals.items()}
    return {'accounts': rows, 'totals': totals, 'base_currency': BASE_CURRENCY}


@router.post('/khata')
async def add_account(body: AccountIn, user=Depends(require_admin_or_module(MOD))):
    name = body.name.strip()
    if await db.cash_ledger_accounts.find_one({'name': {'$regex': f'^{re.escape(name)}$', '$options': 'i'}, 'deleted': {'$ne': True}}):
        raise HTTPException(status_code=400, detail=f'"{name}" is already in the Cash Ledger')
    doc = {'id': str(uuid.uuid4()), 'name': name, 'phone': (body.phone or '').strip()[:20], 'note': (body.note or '').strip()[:300],
           'currency': _currency(body.currency), 'created_at': now_utc().isoformat(), 'created_by': user.get('name'), 'deleted': False}
    await db.cash_ledger_accounts.insert_one(dict(doc))
    await log_audit(user, 'cash_ledger.account.create', 'cash_ledger_account', doc['id'], name)
    doc.pop('_id', None)
    return {**doc, 'balances': {}, 'entries': 0, 'last_date': None}


@router.get('/khata/{aid}')
async def get_account(aid: str, user=Depends(require_staff_or_module(MOD))):
    a = await _account_or_404(aid)
    entries = await db.cash_ledger_entries.find({'account_id': aid, 'deleted': {'$ne': True}}, {'_id': 0}) \
        .sort([('date', 1), ('created_at', 1)]).to_list(5000)
    running: dict = {}
    for e in entries:   # oldest first, to work out each currency's balance after each entry
        e['currency'] = e.get('currency') or BASE_CURRENCY
        running[e['currency']] = running.get(e['currency'], 0.0) + (e['amount'] if e['direction'] == 'gave' else -e['amount'])
        e['balance_after'] = round(running[e['currency']], 2)
    photo_counts = {}
    if entries:
        async for g in db.record_photos.aggregate([
            {'$match': {'ref_type': 'cash_ledger_entry', 'ref_id': {'$in': [e['id'] for e in entries]}, 'deleted': {'$ne': True}}},
            {'$group': {'_id': '$ref_id', 'n': {'$sum': 1}}},
        ]):
            photo_counts[g['_id']] = g['n']
    for e in entries:
        e['photos'] = photo_counts.get(e['id'], 0)
    entries.reverse()   # newest first on screen
    used = sorted({e['currency'] for e in entries})
    return {'account': {**a, 'currency': a.get('currency') or BASE_CURRENCY, 'balances': _nonzero(running),
                        'currencies_used': used, 'entries': len(entries)}, 'entries': entries}


@router.put('/khata/{aid}')
async def edit_account(aid: str, body: AccountIn, user=Depends(require_admin_or_module_right(MOD, 'edit'))):
    a = await _account_or_404(aid)
    name = body.name.strip()
    if await db.cash_ledger_accounts.find_one({'id': {'$ne': aid}, 'name': {'$regex': f'^{re.escape(name)}$', '$options': 'i'}, 'deleted': {'$ne': True}}):
        raise HTTPException(status_code=400, detail=f'"{name}" is already in the Cash Ledger')
    await db.cash_ledger_accounts.update_one({'id': aid}, {'$set': {
        'name': name, 'phone': (body.phone or '').strip()[:20], 'note': (body.note or '').strip()[:300],
        'currency': _currency(body.currency or a.get('currency')), 'updated_at': now_utc().isoformat()}})
    await log_audit(user, 'cash_ledger.account.update', 'cash_ledger_account', aid, name)
    return await db.cash_ledger_accounts.find_one({'id': aid}, {'_id': 0})


@router.delete('/khata/{aid}')
async def delete_account(aid: str, user=Depends(require_admin_or_module_right(MOD, 'delete'))):
    """Kept in the database (marked deleted) with its entries, like everything else with money in it."""
    a = await _account_or_404(aid)
    if (await _balances([aid])).get(aid, {}).get('balances'):
        raise HTTPException(status_code=400, detail='Settle the balance first — this account still has money pending.')
    await db.cash_ledger_accounts.update_one({'id': aid}, {'$set': {'deleted': True, 'deleted_at': now_utc().isoformat()}})
    await log_audit(user, 'cash_ledger.account.delete', 'cash_ledger_account', aid, a['name'])
    return {'ok': True}


@router.post('/khata/{aid}/entries')
async def add_entry(aid: str, body: EntryIn, user=Depends(require_admin_or_module(MOD))):
    a = await _account_or_404(aid)
    cur = _currency(body.currency or a.get('currency'))
    doc = {
        'id': str(uuid.uuid4()), 'account_id': aid, 'direction': body.direction, 'amount': round(body.amount, 2), 'currency': cur,
        'date': _clean_date(body.date), 'note': (body.note or '').strip()[:300],
        'created_at': now_utc().isoformat(), 'created_by': user.get('id'), 'created_by_name': user.get('name'), 'deleted': False,
    }
    await db.cash_ledger_entries.insert_one(dict(doc))
    if cur != (a.get('currency') or BASE_CURRENCY):   # the next entry for them starts in the currency just used
        await db.cash_ledger_accounts.update_one({'id': aid}, {'$set': {'currency': cur}})
    await log_audit(user, 'cash_ledger.entry.create', 'cash_ledger_entry', doc['id'],
                    f"{a['name']}: {body.direction} {cur} {doc['amount']:,.2f}")
    doc.pop('_id', None)
    return doc


@router.put('/khata/{aid}/entries/{eid}')
async def edit_entry(aid: str, eid: str, body: EntryIn, user=Depends(require_admin_or_module_right(MOD, 'edit'))):
    e = await db.cash_ledger_entries.find_one({'id': eid, 'account_id': aid, 'deleted': {'$ne': True}}, {'_id': 0})
    if not e:
        raise HTTPException(status_code=404, detail='Entry not found')
    upd = {'direction': body.direction, 'amount': round(body.amount, 2), 'currency': _currency(body.currency or e.get('currency')),
           'date': _clean_date(body.date), 'note': (body.note or '').strip()[:300],
           'updated_at': now_utc().isoformat(), 'updated_by_name': user.get('name')}
    await db.cash_ledger_entries.update_one({'id': eid}, {'$set': upd})
    await log_audit(user, 'cash_ledger.entry.update', 'cash_ledger_entry', eid,
                    f"{e.get('currency') or BASE_CURRENCY} {e['amount']:,.2f} {e['direction']} -> {upd['currency']} {upd['amount']:,.2f} {upd['direction']}")
    return {**e, **upd}


@router.delete('/khata/{aid}/entries/{eid}')
async def delete_entry(aid: str, eid: str, user=Depends(require_admin_or_module_right(MOD, 'delete'))):
    e = await db.cash_ledger_entries.find_one({'id': eid, 'account_id': aid, 'deleted': {'$ne': True}}, {'_id': 0})
    if not e:
        raise HTTPException(status_code=404, detail='Entry not found')
    await db.cash_ledger_entries.update_one({'id': eid}, {'$set': {'deleted': True, 'deleted_at': now_utc().isoformat(), 'deleted_by': user.get('name')}})
    await log_audit(user, 'cash_ledger.entry.delete', 'cash_ledger_entry', eid, f"{e.get('currency') or BASE_CURRENCY} {e['amount']:,.2f} {e['direction']}")
    return {'ok': True}


@router.post('/khata/{aid}/settle')
async def settle(aid: str, currency: Optional[str] = Query(default=None), date: Optional[str] = Query(default=None),
                 user=Depends(require_admin_or_module(MOD))):
    """Bring the balance to zero ("Settled up"): one entry per currency still
    open, or only `currency` when given."""
    await _account_or_404(aid)
    open_ = (await _balances([aid])).get(aid, {}).get('balances', {})
    if currency:
        c = _currency(currency)
        open_ = {c: open_[c]} if c in open_ else {}
    if not open_:
        raise HTTPException(status_code=400, detail='Already settled')
    made = []
    for c, bal in sorted(open_.items()):
        body = EntryIn(direction='got' if bal > 0 else 'gave', amount=abs(bal), currency=c, date=date, note='Settled up')
        made.append(await add_entry(aid, body, user))
    return {'ok': True, 'entries': made}
