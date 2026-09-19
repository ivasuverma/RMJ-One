"""Statements — the job statement and printable party statements.

Ledger phase 4. Everything here is a READ view over the ledgers that already exist; nothing is written.

  GET /jobs/{id}                      one job (a repair tag or a Stock In/Out sample): every gold and money
                                      movement for it, what the shop made or lost on it
  GET /karigars/{id}/statement/pdf    a karigar's statement, with running balances
  GET /customers/{id}/statement/pdf   a customer's bills (payments are entered in the Cash Book, not here)
  GET /employees/{id}/statement/pdf   an employee's wage/advance ledger

Sign convention (same as the karigar screens): fine gold POSITIVE = the karigar still holds it; amount
POSITIVE = the shop owes the karigar. Cancelled entries are not counted (they live in a separate store).
Amounts are printed as "Rs." — the PDF font has no rupee sign.
"""
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from server import (
    db, get_current, require_staff_or_module, require_ledger_access, _report_pdf, _pdf_response,
)

router = APIRouter()

_LABEL = {
    'gold_out': 'Gold issued', 'gold_in': 'Gold received', 'labour_payable': 'Labour payable', 'payment': 'Payment to karigar',
    'receipt': 'Receipt', 'wastage': 'Wastage', 'adjustment': 'Adjustment', 'loss': 'Loss',
}


def entry_deltas(e: dict) -> tuple:
    """(fine gold the karigar holds, amount the shop owes) change caused by one karigar_ledger entry."""
    t = e.get('type')
    fw = e.get('fine_weight') if e.get('fine_weight') is not None else (e.get('weight') or 0)
    amt = e.get('amount') or 0
    if t == 'gold_out':
        return fw, 0.0
    if t == 'gold_in':
        return -fw, 0.0
    if t == 'loss' and e.get('absorbs'):
        return -fw, 0.0                      # a loss the shop absorbed clears what the karigar held
    if t == 'labour_payable':
        return 0.0, amt
    if t == 'payment':
        return 0.0, -amt
    if t == 'receipt':
        return 0.0, amt
    if t in ('wastage', 'adjustment'):
        return 0.0, amt                      # sign is baked into the stored amount
    return 0.0, 0.0                          # audit-only records (a declared loss already credited elsewhere)


def _label(e: dict) -> str:
    if e.get('type') == 'loss':
        return 'Loss absorbed by the shop' if e.get('absorbs') else 'Loss declared'
    return _LABEL.get(e.get('type'), e.get('type') or 'Entry')


def _day(iso: Optional[str]) -> str:
    return (iso or '')[:10]


def _in_range(iso: Optional[str], date_from: Optional[str], date_to: Optional[str]) -> bool:
    d = _day(iso)
    return (not date_from or d >= date_from) and (not date_to or d <= date_to)


def _valid_date(v: Optional[str], name: str) -> Optional[str]:
    if not v:
        return None
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', v):
        raise HTTPException(status_code=400, detail=f'{name} must be a date like 2026-09-30')
    return v


def _g(x: float) -> str:
    return f"{x:+.3f}" if abs(x) >= 0.0005 else ''


def _r(x: float) -> str:
    return f"{x:+,.2f}" if abs(x) >= 0.005 else ''


def _period(date_from, date_to) -> str:
    if date_from and date_to:
        return f'{date_from} to {date_to}'
    if date_from:
        return f'from {date_from}'
    if date_to:
        return f'up to {date_to}'
    return 'all dates'


# ---------------------------------------------------------------- job statement
@router.get('/jobs/{job_id}')
async def job_statement(job_id: str, _: dict = Depends(require_staff_or_module(['repairs', 'samples', 'karigar_ledger', 'customer_ledger']))):
    item = await db.repair_items.find_one({'id': job_id}, {'_id': 0})
    kind = 'repair'
    if not item:
        item = await db.samples.find_one({'id': job_id}, {'_id': 0})
        kind = 'sample'
    if not item:
        raise HTTPException(status_code=404, detail='Job not found')
    entries = await db.karigar_ledger.find({'item_id': job_id}, {'_id': 0}).sort('created_at', 1).to_list(500)

    customer = ''
    if kind == 'repair':
        customer = item.get('customer_name') or ''
        if not customer and item.get('order_id'):
            o = await db.repair_orders.find_one({'id': item['order_id']}, {'_id': 0, 'customer_name': 1})
            customer = (o or {}).get('customer_name', '')

    issued = returned = declared = absorbed = 0.0
    labour = paid = 0.0
    rows = []
    hold = due = 0.0
    for e in entries:
        fd, ad = entry_deltas(e)
        hold, due = round(hold + fd, 3), round(due + ad, 2)
        fw = e.get('fine_weight') if e.get('fine_weight') is not None else (e.get('weight') or 0)
        t = e.get('type')
        if t == 'gold_out':
            issued += fw
        elif t == 'gold_in':
            returned += fw
        elif t == 'loss':
            if e.get('absorbs'):
                absorbed += fw
            else:
                declared += fw
        elif t == 'labour_payable':
            labour += e.get('amount') or 0
        elif t == 'payment':
            paid += e.get('amount') or 0
        rows.append({
            'id': e['id'], 'date': _day(e.get('created_at')), 'created_at': e.get('created_at'), 'type': t, 'label': _label(e),
            'weight': e.get('weight'), 'fine_weight': e.get('fine_weight'), 'amount': e.get('amount'),
            'fine_delta': round(fd, 3), 'amount_delta': round(ad, 2), 'held': hold, 'due': due,
            'note': e.get('note') or '', 'by': e.get('created_by'), 'karigar': e.get('karigar_name'),
        })

    bill = None
    result = None
    if kind == 'repair' and item.get('billed_amount') is not None:
        billed = float(item.get('billed_amount') or 0)
        prev = float(item.get('bill_previous_balance') or 0)
        bill = {
            'billed': round(billed, 2), 'previous_balance': round(prev, 2), 'labour_charge': item.get('bill_labour_charge') or 0,
            'material_adjustment': item.get('bill_material_adjustment') or 0, 'extra_charges': item.get('bill_extra_charges') or 0,
            'income': round(billed - prev, 2),           # this job's own income — an earlier balance carried on the bill isn't
        }
        result = round(bill['income'] - labour, 2)

    karigar = next((e.get('karigar_name') for e in entries if e.get('karigar_name')), None) or item.get('karigar_name') or ''
    if not karigar and entries:
        k = await db.karigars.find_one({'id': entries[0].get('karigar_id')}, {'_id': 0, 'name': 1})
        karigar = (k or {}).get('name', '')
    return {
        'job': {
            'kind': kind, 'id': job_id, 'code': item.get('item_code') or item.get('sample_code'), 'description': item.get('description') or '',
            'status': item.get('status'), 'customer': customer, 'karigar': karigar, 'purity': item.get('purity'),
            'weight': item.get('gross_weight') if kind == 'repair' else item.get('weight'),
            'created_at': item.get('created_at'), 'delivered_at': item.get('delivered_at') or item.get('received_at'),
        },
        'gold': {
            'issued_fine': round(issued, 3), 'returned_fine': round(returned, 3), 'declared_loss_fine': round(declared, 3),
            'absorbed_loss_fine': round(absorbed, 3), 'with_karigar_fine': round(hold, 3),
        },
        'money': {'labour_payable': round(labour, 2), 'paid_to_karigar': round(paid, 2), 'owed_to_karigar': round(due, 2)},
        'bill': bill, 'result': result,     # result = income minus the karigar's labour (gold loss is shown separately, never netted)
        'entries': rows,
    }


# ---------------------------------------------------------------- karigar statement
@router.get('/karigars/{kid}/statement/pdf')
async def karigar_statement_pdf(
    kid: str, date_from: Optional[str] = Query(default=None, alias='from'), date_to: Optional[str] = Query(default=None, alias='to'),
    _: dict = Depends(require_ledger_access('karigar_ledger')),
):
    date_from, date_to = _valid_date(date_from, 'from'), _valid_date(date_to, 'to')
    k = await db.karigars.find_one({'id': kid}, {'_id': 0})
    if not k:
        raise HTTPException(status_code=404, detail='Karigar not found')
    entries = await db.karigar_ledger.find({'karigar_id': kid}, {'_id': 0}).sort('created_at', 1).to_list(5000)
    hold = due = 0.0
    rows = []
    if date_from:
        for e in entries:
            if _day(e.get('created_at')) < date_from:
                fd, ad = entry_deltas(e)
                hold, due = hold + fd, due + ad
        rows.append(['', '', 'Balance brought forward', '', '', f'{hold:.3f}', f'{due:,.2f}'])
    for e in entries:
        if not _in_range(e.get('created_at'), date_from, date_to) or (date_from and _day(e.get('created_at')) < date_from):
            continue
        fd, ad = entry_deltas(e)
        hold, due = hold + fd, due + ad
        part = _label(e)
        if e.get('note'):
            part += f" - {e['note']}"
        rows.append([_day(e.get('created_at')), e.get('item_code') or '', part, _g(fd), _r(ad), f'{hold:.3f}', f'{due:,.2f}'])
    subtitle = '  |  '.join(x for x in (
        k.get('mobile'), f'Period: {_period(date_from, date_to)}', f'Fine gold held by karigar: {hold:.3f} g',
        f"Amount due: Rs. {due:,.2f} ({'shop owes karigar' if due > 0.005 else 'karigar owes shop' if due < -0.005 else 'nil'})") if x)
    pdf = _report_pdf(
        f"Karigar statement - {k['name']}", subtitle,
        ['Date', 'Job', 'Particulars', 'Fine +/- (g)', 'Amount +/- (Rs.)', 'Fine held (g)', 'Amount due (Rs.)'], rows or [['', '', 'No entries in this period', '', '', '', '']],
    )
    return _pdf_response(pdf, f"karigar-{re.sub(r'[^a-z0-9]+', '-', k['name'].lower()).strip('-')}.pdf")


# ---------------------------------------------------------------- customer statement
@router.get('/customers/{cid}/statement/pdf')
async def customer_statement_pdf(
    cid: str, date_from: Optional[str] = Query(default=None, alias='from'), date_to: Optional[str] = Query(default=None, alias='to'),
    _: dict = Depends(require_ledger_access('customer_ledger')),
):
    date_from, date_to = _valid_date(date_from, 'from'), _valid_date(date_to, 'to')
    c = await db.customers.find_one({'id': cid}, {'_id': 0})
    if not c:
        raise HTTPException(status_code=404, detail='Customer not found')
    oids = [o['id'] async for o in db.repair_orders.find({'customer_id': cid}, {'_id': 0, 'id': 1})]
    items = await db.repair_items.find({'order_id': {'$in': oids}}, {'_id': 0}).sort('created_at', 1).to_list(1000) if oids else []
    rows, total, held = [], 0.0, 0.0
    status_label = {'delivered': 'Delivered', 'pending_delivery': 'Billed', 'ready': 'Ready'}
    for it in items:
        if not _in_range(it.get('created_at'), date_from, date_to):
            continue
        billed = it.get('billed_amount')
        if billed:
            total += float(billed)
        if it.get('status') != 'delivered':
            held += it.get('gross_weight') or 0
        rows.append([
            _day(it.get('created_at')), it.get('item_code'), it.get('description') or '', f"{(it.get('gross_weight') or 0):.3f}",
            status_label.get(it.get('status'), (it.get('status') or '').replace('_', ' ').title()),
            f"{float(billed):,.2f}" if billed else '',
        ])
    rows.append(['', '', 'Total billed', '', '', f'{total:,.2f}'])
    subtitle = '  |  '.join(x for x in (
        c.get('mobile'), c.get('address'), f'Period: {_period(date_from, date_to)}', f'Gold still with the shop for repair: {held:.3f} g',
        'Payments are recorded in the Cash Book - this statement lists bills only') if x)
    pdf = _report_pdf(f"Customer statement - {c['name']}", subtitle, ['Date', 'Tag', 'Description', 'Weight (g)', 'Status', 'Billed (Rs.)'], rows)
    return _pdf_response(pdf, f"customer-{re.sub(r'[^a-z0-9]+', '-', c['name'].lower()).strip('-')}.pdf")


# ---------------------------------------------------------------- employee statement
@router.get('/employees/{emp_id}/statement/pdf')
async def employee_statement_pdf(
    emp_id: str, date_from: Optional[str] = Query(default=None, alias='from'), date_to: Optional[str] = Query(default=None, alias='to'),
    user: dict = Depends(get_current),
):
    date_from, date_to = _valid_date(date_from, 'from'), _valid_date(date_to, 'to')
    from routers.payroll import get_ledger          # same rules as the on-screen ledger (staff, or the employee themself)
    led = await get_ledger(emp_id, user)
    emp = await db.employees.find_one({'id': emp_id}, {'_id': 0, 'name': 1, 'employee_code': 1})
    entries = sorted(led['entries'], key=lambda e: e.get('created_at') or '')
    rows = []
    if date_from:
        prior = [e for e in entries if _day(e.get('created_at')) < date_from]
        rows.append(['', 'Balance brought forward', '', '', f"{(prior[-1]['balance'] if prior else 0):,.2f}"])
    label = {'advance': 'Advance', 'bonus': 'Bonus', 'fine': 'Fine', 'deduction': 'Deduction', 'salary': 'Salary', 'salary_earned': 'Salary earned', 'salary_paid': 'Salary paid'}
    for e in entries:
        if not _in_range(e.get('created_at'), date_from, date_to) or not e.get('delta'):
            continue
        rows.append([_day(e.get('created_at')), label.get(e.get('type'), (e.get('type') or '').title()), (e.get('note') or e.get('title') or ''),
                     _r(e['delta']), f"{e['balance']:,.2f}"])
    closing = entries[-1]['balance'] if entries else 0
    subtitle = '  |  '.join(x for x in (
        emp.get('employee_code'), f'Period: {_period(date_from, date_to)}',
        f"Closing balance: Rs. {closing:,.2f} ({'shop owes employee' if closing > 0.005 else 'employee owes shop' if closing < -0.005 else 'nil'})") if x)
    pdf = _report_pdf(f"Employee statement - {emp['name']}", subtitle, ['Date', 'Type', 'Note', 'Amount +/- (Rs.)', 'Balance (Rs.)'],
                      rows or [['', 'No entries in this period', '', '', '']])
    return _pdf_response(pdf, f"employee-{re.sub(r'[^a-z0-9]+', '-', emp['name'].lower()).strip('-')}.pdf")
