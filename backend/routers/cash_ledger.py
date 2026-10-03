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

*Groups* (per person, e.g. "Dubai trip", "Wedding"): an entry can go into
one of the person's groups. A group keeps its own entries, running balance and
total, apart from the person's other (general) entries - but the person's
overall balance is always everything, groups included. Settle Up clears each
group and the general part separately, so each stays at zero on its own.

The statement (/khata/{id}/statement) is a printable PDF in accounts style -
Date | Description | Remarks | Dr | Cr | Closing - for a date range, per
currency, with the opening balance brought forward; the app previews its pages
as pictures and shares the PDF. Dr = cash you gave (they owe you), Cr = cash
you got.

Module 'cash_ledger': owner by default; the owner can grant it in People.
Editing or deleting an existing entry follows the same rights as other modules.
"""
import asyncio
import re
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from server import (
    db, now_utc, IST, log_audit, _pdf_response,
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
    note: Optional[str] = ''           # the description
    remark: Optional[str] = ''
    group_id: Optional[str] = None      # one of the person's groups; None = general


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


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


def _signed(e: dict) -> float:
    return e['amount'] if e['direction'] == 'gave' else -e['amount']


def _group_id(a: dict, gid: Optional[str]) -> Optional[str]:
    if not gid:
        return None
    if not any(g['id'] == gid for g in a.get('groups') or []):
        raise HTTPException(status_code=400, detail='That group is not in this account')
    return gid


async def _entries(aid: str) -> list:
    """All live entries, oldest first, each with balance_after - the running
    balance in its own currency WITHIN its own part (its group, or general)."""
    entries = await db.cash_ledger_entries.find({'account_id': aid, 'deleted': {'$ne': True}}, {'_id': 0}) \
        .sort([('date', 1), ('created_at', 1)]).to_list(5000)
    running: dict = {}
    for e in entries:
        e['currency'] = e.get('currency') or BASE_CURRENCY
        e['group_id'] = e.get('group_id') or None
        k = (e['group_id'], e['currency'])
        running[k] = running.get(k, 0.0) + _signed(e)
        e['balance_after'] = round(running[k], 2)
    return entries


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
    entries = await _entries(aid)
    total: dict = {}
    parts: dict = {}     # {group_id or '': {currency: balance}}
    counts: dict = {}
    for e in entries:
        total[e['currency']] = total.get(e['currency'], 0.0) + _signed(e)
        p = parts.setdefault(e['group_id'] or '', {})
        p[e['currency']] = p.get(e['currency'], 0.0) + _signed(e)
        counts[e['group_id'] or ''] = counts.get(e['group_id'] or '', 0) + 1
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
    groups = [{**g, 'balances': _nonzero(parts.get(g['id'], {})), 'entries': counts.get(g['id'], 0)} for g in a.get('groups') or []]
    return {'account': {**a, 'currency': a.get('currency') or BASE_CURRENCY, 'balances': _nonzero(total),
                        'general_balances': _nonzero(parts.get('', {})), 'general_entries': counts.get('', 0),
                        'groups': groups, 'currencies_used': used, 'entries': len(entries)}, 'entries': entries}


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
        'date': _clean_date(body.date), 'note': (body.note or '').strip()[:300], 'remark': (body.remark or '').strip()[:300],
        'group_id': _group_id(a, body.group_id),
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
    a = await _account_or_404(aid)
    upd = {'direction': body.direction, 'amount': round(body.amount, 2), 'currency': _currency(body.currency or e.get('currency')),
           'date': _clean_date(body.date), 'note': (body.note or '').strip()[:300], 'remark': (body.remark or '').strip()[:300],
           'group_id': _group_id(a, body.group_id),
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
                 group: Optional[str] = Query(default=None), user=Depends(require_admin_or_module(MOD))):
    """Bring the balance to zero ("Settled up"): one entry per currency still
    open in each part (general and every group, so each stays at zero on its
    own). `group`: only that group ('general' for the general part);
    `currency`: only that currency."""
    a = await _account_or_404(aid)
    open_: dict = {}
    for e in await _entries(aid):
        k = (e['group_id'] or '', e['currency'])
        open_[k] = open_.get(k, 0.0) + _signed(e)
    if group:
        want = '' if group == 'general' else _group_id(a, group)
        open_ = {k: v for k, v in open_.items() if k[0] == want}
    if currency:
        c = _currency(currency)
        open_ = {k: v for k, v in open_.items() if k[1] == c}
    open_ = {k: round(v, 2) for k, v in open_.items() if abs(v) >= 0.005}
    if not open_:
        raise HTTPException(status_code=400, detail='Already settled')
    made = []
    for (gid, c), bal in sorted(open_.items()):
        body = EntryIn(direction='got' if bal > 0 else 'gave', amount=abs(bal), currency=c, date=date, note='Settled up', group_id=gid or None)
        made.append(await add_entry(aid, body, user))
    return {'ok': True, 'entries': made}


# ---------------------------------------------------------------- groups
@router.post('/khata/{aid}/groups')
async def add_group(aid: str, body: GroupIn, user=Depends(require_admin_or_module(MOD))):
    a = await _account_or_404(aid)
    name = body.name.strip()
    if any(g['name'].lower() == name.lower() for g in a.get('groups') or []):
        raise HTTPException(status_code=400, detail=f'"{name}" is already a group here')
    g = {'id': str(uuid.uuid4()), 'name': name, 'created_at': now_utc().isoformat()}
    await db.cash_ledger_accounts.update_one({'id': aid}, {'$push': {'groups': g}})
    await log_audit(user, 'cash_ledger.group.create', 'cash_ledger_account', aid, f"{a['name']}: {name}")
    return {**g, 'balances': {}, 'entries': 0}


@router.put('/khata/{aid}/groups/{gid}')
async def rename_group(aid: str, gid: str, body: GroupIn, user=Depends(require_admin_or_module_right(MOD, 'edit'))):
    a = await _account_or_404(aid)
    _group_id(a, gid)
    name = body.name.strip()
    if any(g['name'].lower() == name.lower() and g['id'] != gid for g in a.get('groups') or []):
        raise HTTPException(status_code=400, detail=f'"{name}" is already a group here')
    await db.cash_ledger_accounts.update_one({'id': aid, 'groups.id': gid}, {'$set': {'groups.$.name': name}})
    return {'ok': True}


@router.delete('/khata/{aid}/groups/{gid}')
async def delete_group(aid: str, gid: str, user=Depends(require_admin_or_module_right(MOD, 'delete'))):
    """Only an empty group - move or delete its entries first, so no money disappears with it."""
    a = await _account_or_404(aid)
    _group_id(a, gid)
    if await db.cash_ledger_entries.count_documents({'account_id': aid, 'group_id': gid, 'deleted': {'$ne': True}}):
        raise HTTPException(status_code=400, detail='This group still has entries - delete them or move them to another group first.')
    await db.cash_ledger_accounts.update_one({'id': aid}, {'$pull': {'groups': {'id': gid}}})
    await log_audit(user, 'cash_ledger.group.delete', 'cash_ledger_account', aid, gid)
    return {'ok': True}


# ---------------------------------------------------------------- statement (PDF)
def _amt(x: float) -> str:
    return f'{abs(x):,.2f}' if abs(x) >= 0.005 else ''


def _bal(x: float) -> str:
    """Closing balance the accounts way: 17,500.00 Dr (they owe you) / Cr (you owe them)."""
    return f"{abs(x):,.2f} {'Dr' if x > 0 else 'Cr'}" if abs(x) >= 0.005 else 'Nil'


def _dmy(iso: str) -> str:
    return f'{iso[8:10]}-{iso[5:7]}-{iso[:4]}' if iso and len(iso) >= 10 else (iso or '')


def _statement_pdf_sync(shop: str, a: dict, sections: list, period: str, generated: str) -> bytes:
    """sections: [{title, currency, opening, rows: [(date, desc, remark, dr, cr, closing)], dr, cr, closing}]
    plus a last 'summary' list of (currency, closing) when there is more than one part."""
    from io import BytesIO
    from reportlab.lib import colors as rl
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=14 * mm, bottomMargin=16 * mm,
                            title=f"Statement - {a['name']}", author=shop)
    ink, mute, line, head = rl.HexColor('#1d1d1f'), rl.HexColor('#6e6e73'), rl.HexColor('#d2d2d7'), rl.HexColor('#f2f2f7')
    st = {
        'shop': ParagraphStyle('shop', fontName='Helvetica-Bold', fontSize=15, leading=18, textColor=ink),
        'doc': ParagraphStyle('doc', fontName='Helvetica', fontSize=10, leading=13, textColor=mute),
        'party': ParagraphStyle('party', fontName='Helvetica-Bold', fontSize=12, leading=15, textColor=ink),
        'small': ParagraphStyle('small', fontName='Helvetica', fontSize=8.5, leading=11, textColor=mute),
        'smallr': ParagraphStyle('smallr', fontName='Helvetica', fontSize=8.5, leading=11, textColor=mute, alignment=TA_RIGHT),
        'sec': ParagraphStyle('sec', fontName='Helvetica-Bold', fontSize=10.5, leading=13, textColor=ink),
        'cell': ParagraphStyle('cell', fontName='Helvetica', fontSize=8.5, leading=10.5, textColor=ink),
    }
    W = doc.width
    els = [Table([[Paragraph(shop, st['shop']), Paragraph('Account Statement', ParagraphStyle('r', parent=st['doc'], alignment=TA_RIGHT))]],
                 colWidths=[W * 0.6, W * 0.4], style=[('VALIGN', (0, 0), (-1, -1), 'BOTTOM'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0)]),
           Spacer(1, 2 * mm),
           Table([['']], colWidths=[W], rowHeights=[0.6], style=[('LINEABOVE', (0, 0), (-1, 0), 0.8, ink)]),
           Spacer(1, 3 * mm)]
    left = [Paragraph(f"Account: {a['name']}", st['party'])]
    if a.get('phone'):
        left.append(Paragraph(f"Mobile: {a['phone']}", st['small']))
    right = [Paragraph(f'Period: {period}', st['smallr']), Paragraph(f'Generated: {generated}', st['smallr'])]
    els += [Table([[left, right]], colWidths=[W * 0.6, W * 0.4],
                  style=[('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0)]),
            Spacer(1, 5 * mm)]

    cw = [20 * mm, None, 34 * mm, 24 * mm, 24 * mm, 29 * mm]
    cw[1] = W - sum(c for c in cw if c)
    for sec in sections:
        data = [['Date', 'Description', 'Remarks', 'Dr', 'Cr', 'Closing']]
        data.append(['', Paragraph('<b>Opening Balance</b>', st['cell']), '', '', '', _bal(sec['opening'])])
        for d, desc, rem, dr, cr, clo in sec['rows']:
            data.append([_dmy(d), Paragraph(desc, st['cell']), Paragraph(rem, st['cell']), _amt(dr), _amt(cr), _bal(clo)])
        data.append(['', 'Total', '', _amt(sec['dr']) or '0.00', _amt(sec['cr']) or '0.00', ''])
        data.append(['', 'Closing Balance', '', '', '', _bal(sec['closing'])])
        n = len(data)
        t = Table(data, colWidths=cw, repeatRows=1)
        t.setStyle(TableStyle([
            ('FONT', (0, 0), (-1, 0), 'Helvetica-Bold', 8.5), ('BACKGROUND', (0, 0), (-1, 0), head),
            ('FONT', (0, 1), (-1, -1), 'Helvetica', 8.5), ('TEXTCOLOR', (0, 0), (-1, -1), ink),
            ('ALIGN', (3, 0), (-1, -1), 'RIGHT'), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LINEBELOW', (0, 0), (-1, 0), 0.8, ink), ('LINEBELOW', (0, 1), (-1, n - 3), 0.25, line),
            ('LINEABOVE', (0, n - 2), (-1, n - 2), 0.8, ink), ('LINEBELOW', (0, n - 1), (-1, n - 1), 1.2, ink),
            ('FONT', (0, n - 2), (-1, n - 1), 'Helvetica-Bold', 8.5), ('BACKGROUND', (0, n - 1), (-1, n - 1), head),
            ('FONT', (5, 1), (5, -1), 'Helvetica-Bold', 8.5),
            ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ]))
        els += [KeepTogether([Paragraph(sec['title'], st['sec']), Spacer(1, 1.5 * mm)]), t, Spacer(1, 6 * mm)]

    summary = [s_ for s_ in sections if s_.get('part_of_total')]
    if len(summary) > 1:   # more than one part (general + groups): the total they add up to, per currency
        tot: dict = {}
        for s_ in summary:
            tot[s_['currency']] = tot.get(s_['currency'], 0.0) + s_['closing']
        data = [['Summary', 'Closing']] + [[f"{s_['title']}", _bal(s_['closing'])] for s_ in summary] + \
               [[f'Total ({c})', _bal(v)] for c, v in sorted(tot.items(), key=lambda kv: (kv[0] != BASE_CURRENCY, kv[0]))]
        n = len(data)
        t = Table(data, colWidths=[W - 40 * mm, 40 * mm])
        t.setStyle(TableStyle([
            ('FONT', (0, 0), (-1, -1), 'Helvetica', 9), ('FONT', (0, 0), (-1, 0), 'Helvetica-Bold', 9), ('BACKGROUND', (0, 0), (-1, 0), head),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'), ('LINEBELOW', (0, 0), (-1, 0), 0.8, ink), ('LINEBELOW', (0, 1), (-1, -1), 0.25, line),
            ('FONT', (0, n - len(tot)), (-1, -1), 'Helvetica-Bold', 9.5), ('LINEABOVE', (0, n - len(tot)), (-1, n - len(tot)), 0.8, ink),
            ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        els += [KeepTogether([t])]

    els += [Spacer(1, 6 * mm), Paragraph('Dr = amount given to the account holder (receivable). Cr = amount received from them. '
                                         'Closing in Dr means they owe us; in Cr, we owe them. Each currency is shown separately and never converted.', st['small'])]

    def footer(canvas, d):
        canvas.saveState()
        canvas.setFont('Helvetica', 7.5)
        canvas.setFillColor(mute)
        canvas.drawString(14 * mm, 9 * mm, f"{shop} - Statement of {a['name']}")
        canvas.drawRightString(A4[0] - 14 * mm, 9 * mm, f'Page {d.page}')
        canvas.restoreState()
    doc.build(els, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()


@router.get('/khata/{aid}/statement')
async def statement(aid: str, date_from: Optional[str] = Query(default=None, alias='from'), date_to: Optional[str] = Query(default=None, alias='to'),
                    group: Optional[str] = Query(default=None), format: Literal['pdf', 'info', 'page'] = 'pdf', page: int = 0,
                    user=Depends(require_staff_or_module(MOD))):
    """The statement PDF. `group`: one group's id, 'general', or nothing for the
    whole account (general first, then each group, then the total).
    format=info -> {pages}; format=page&page=N -> that page as a JPEG (the app's preview)."""
    a = await _account_or_404(aid)
    date_from = _clean_date(date_from) if date_from else None
    date_to = _clean_date(date_to) if date_to else None
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=400, detail='From date is after To date')
    groups = a.get('groups') or []
    names = {g['id']: g['name'] for g in groups}
    if group == 'general':
        parts = [None]
    elif group:
        parts = [_group_id(a, group)]
    else:
        parts = [None] + [g['id'] for g in groups]
    entries = await _entries(aid)
    sections = []
    for gid in parts:
        mine = [e for e in entries if e['group_id'] == gid]
        if gid is None and len(parts) > 1 and not mine:
            continue
        for cur in sorted({e['currency'] for e in mine}, key=lambda c: (c != BASE_CURRENCY, c)) or ([] if mine else [a.get('currency') or BASE_CURRENCY]):
            es = [e for e in mine if e['currency'] == cur]
            opening = sum(_signed(e) for e in es if date_from and e['date'] < date_from)
            rows, dr, cr = [], 0.0, 0.0
            for e in es:
                if (date_from and e['date'] < date_from) or (date_to and e['date'] > date_to):
                    continue
                desc = e.get('note') or ('Cash given' if e['direction'] == 'gave' else 'Cash received')
                gave = e['amount'] if e['direction'] == 'gave' else 0.0
                got = e['amount'] if e['direction'] == 'got' else 0.0
                dr, cr = dr + gave, cr + got
                rows.append((e['date'], _esc(desc), _esc(e.get('remark') or ''), gave, got, e['balance_after']))
            closing = opening + dr - cr
            part = 'General' if gid is None else f'Group: {names.get(gid, "")}'
            title = f'{part} - {cur}' if (len(parts) > 1 or gid is not None) else f'Currency: {cur}'
            sections.append({'title': title, 'currency': cur, 'opening': round(opening, 2), 'rows': rows,
                             'dr': round(dr, 2), 'cr': round(cr, 2), 'closing': round(closing, 2), 'part_of_total': len(parts) > 1})
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    shop = store.get('name') or 'Ram Murti Jewellers'
    period = f"{_dmy(date_from) if date_from else 'Beginning'} to {_dmy(date_to or _today())}"
    generated = now_utc().astimezone(IST).strftime('%d-%m-%Y %I:%M %p')
    pdf = await asyncio.to_thread(_statement_pdf_sync, shop, a, sections, period, generated)
    if format == 'pdf':
        slug = re.sub(r'[^a-z0-9]+', '-', a['name'].lower()).strip('-') or 'account'
        return _pdf_response(pdf, f'statement-{slug}.pdf')
    from routers.documents import _pdf_info_sync, _pdf_page_jpeg_sync
    if format == 'info':
        n, _ = await asyncio.to_thread(_pdf_info_sync, pdf)
        return {'pages': n}
    img = await asyncio.to_thread(_pdf_page_jpeg_sync, pdf, page, 1600, 85)
    if img is None:
        raise HTTPException(status_code=404, detail='No such page')
    return Response(content=img, media_type='image/jpeg', headers={'Cache-Control': 'private, max-age=60'})


def _esc(t: str) -> str:
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
