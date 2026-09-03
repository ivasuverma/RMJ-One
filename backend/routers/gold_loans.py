"""Loan Against Gold: cash paid out to a customer against pledged gold items,
with interest accruing monthly on the outstanding principal until the loan is
closed (customer collects the pledge back).

Two collections beyond the loan record itself:
  - gold_loan_transactions: every interest charge (auto-posted monthly) and
    every payment received (tagged interest or principal by whoever takes
    the cash). Balances are always derived from this ledger, never stored,
    same philosophy as routers/ledger.py — so editing history stays honest.
  - gold_loan_interest_generations: idempotency guard (loan_id + period) so
    the 15-minute reminder-loop poll can't double-post a month's interest.

Reuses the repairs module's customer directory (db.customers) and thermal
print helpers rather than duplicating either."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from calendar import monthrange
from datetime import date
import re
import uuid
from server import (
    db,
    now_utc,
    today_str,
    IST,
    require_staff_or_module,
    require_admin_or_module,
    require_admin_or_module_right,
    require_owner,
    GoldLoanIn,
    GoldLoanUpdateIn,
    GoldLoanPaymentIn,
    log_audit,
    _notify_module,
    _pdf_response,
)
from routers.repairs import _mirror_party_account, _escpos_receipt, _print_escpos, _thermal_slip_pdf

router = APIRouter()


async def _next_loan_no() -> str:
    count = await db.gold_loans.count_documents({})
    return f'GL-{count + 1:04d}'


async def _get_loan(loan_id: str) -> dict:
    loan = await db.gold_loans.find_one({'id': loan_id}, {'_id': 0})
    if not loan:
        raise HTTPException(status_code=404, detail='Loan not found')
    return loan


async def _loan_balances(loan: dict) -> dict:
    """Everything downstream (list, detail, close-eligibility, interest
    posting) reads through this — the transaction ledger is the only source
    of truth, the loan doc itself never carries a running balance."""
    txns = await db.gold_loan_transactions.find({'loan_id': loan['id']}, {'_id': 0}).to_list(5000)
    interest_due = sum(t['amount'] for t in txns if t['type'] == 'interest_due')
    interest_paid = sum(t['amount'] for t in txns if t['type'] == 'payment_interest')
    principal_paid = sum(t['amount'] for t in txns if t['type'] == 'payment_principal')
    principal_balance = round(loan['principal'] - principal_paid, 2)
    interest_balance = round(interest_due - interest_paid, 2)
    return {
        'principal': loan['principal'], 'principal_paid': round(principal_paid, 2), 'principal_balance': principal_balance,
        'interest_due': round(interest_due, 2), 'interest_paid': round(interest_paid, 2), 'interest_balance': interest_balance,
        'total_outstanding': round(principal_balance + interest_balance, 2),
    }


@router.post('/gold-loans')
async def create_gold_loan(body: GoldLoanIn, user=Depends(require_admin_or_module('gold_loans'))):
    if body.principal <= 0:
        raise HTTPException(status_code=400, detail='Principal must be greater than 0')
    if body.interest_rate_percent < 0:
        raise HTTPException(status_code=400, detail='Interest rate cannot be negative')
    if body.weight <= 0:
        raise HTTPException(status_code=400, detail='Weight must be greater than 0')

    customer = None
    if body.customer_id:
        customer = await db.customers.find_one({'id': body.customer_id}, {'_id': 0})
        if not customer:
            raise HTTPException(status_code=404, detail='Customer not found')
    elif body.new_customer:
        if len(re.sub(r'\D', '', body.new_customer.mobile or '')) < 7:
            raise HTTPException(status_code=400, detail='A mobile number is required for a new customer')
        customer = {'id': str(uuid.uuid4()), **body.new_customer.model_dump(), 'created_at': now_utc().isoformat()}
        await db.customers.insert_one(dict(customer))
        try: await _mirror_party_account('customer', customer['id'], customer.get('name', ''), customer.get('mobile', ''))
        except Exception: pass
        await log_audit(user, 'customer.create', 'customer', customer['id'], customer['name'])
    else:
        raise HTTPException(status_code=400, detail='customer_id or new_customer is required')

    iso = now_utc().isoformat()
    loan_id = str(uuid.uuid4())
    loan = {
        'id': loan_id, 'loan_no': await _next_loan_no(),
        'customer_id': customer['id'], 'customer_name': customer['name'], 'customer_mobile': customer.get('mobile', ''),
        'description': body.description.strip(), 'weight': body.weight, 'pc_count': max(1, body.pc_count),
        'photo': body.photo or '',
        'principal': body.principal, 'interest_rate_percent': body.interest_rate_percent,
        'loan_date': body.loan_date or today_str(), 'estimate_return_date': body.estimate_return_date,
        'status': 'active', 'closed_at': None, 'closed_by': None,
        'note': body.note or '', 'created_at': iso, 'created_by': user['name'], 'created_by_id': user['id'],
    }
    await db.gold_loans.insert_one(dict(loan))
    await log_audit(user, 'gold_loan.create', 'gold_loan', loan_id, loan['loan_no'],
                     {'customer': customer['name'], 'principal': body.principal})
    await _notify_module('gold_loans', f"New gold loan {loan['loan_no']}",
                          f"{customer['name']} · ₹{body.principal:,.0f} · by {user['name']}", '/loans',
                          script='gold_loan_created', admin_only=True)
    return {k: v for k, v in loan.items() if k != '_id'}


@router.get('/gold-loans')
async def list_gold_loans(
    status_: Optional[str] = Query(default=None, alias='status'),
    q: Optional[str] = None,
    _: dict = Depends(require_staff_or_module('gold_loans')),
):
    query: dict = {}
    if status_ == 'overdue':
        query['status'] = 'active'
        query['estimate_return_date'] = {'$ne': None, '$lt': today_str()}
    elif status_ and status_ != 'all':
        query['status'] = status_
    if q:
        q_esc = re.escape(q)
        query['$or'] = [
            {'loan_no': {'$regex': q_esc, '$options': 'i'}},
            {'customer_name': {'$regex': q_esc, '$options': 'i'}},
            {'customer_mobile': {'$regex': q_esc, '$options': 'i'}},
            {'description': {'$regex': q_esc, '$options': 'i'}},
        ]
    loans = await db.gold_loans.find(query, {'_id': 0, 'photo': 0}).sort('created_at', -1).to_list(1000)
    today = today_str()
    out = []
    for loan in loans:
        bal = await _loan_balances(loan)
        out.append({
            **loan, **bal,
            'overdue': loan['status'] == 'active' and bool(loan.get('estimate_return_date')) and loan['estimate_return_date'] < today,
        })
    return out


@router.get('/gold-loans/dashboard')
async def gold_loans_dashboard(_: dict = Depends(require_staff_or_module('gold_loans'))):
    today = today_str()
    active = 0
    overdue = 0
    total_outstanding = 0.0
    closed_today = await db.gold_loans.count_documents({'status': 'closed', 'closed_at': {'$regex': f'^{today}'}})
    async for loan in db.gold_loans.find({'status': 'active'}, {'_id': 0}):
        active += 1
        if loan.get('estimate_return_date') and loan['estimate_return_date'] < today:
            overdue += 1
        bal = await _loan_balances(loan)
        total_outstanding += bal['total_outstanding']
    return {'active': active, 'overdue': overdue, 'total_outstanding': round(total_outstanding, 2), 'closed_today': closed_today}


@router.get('/gold-loans/{loan_id}')
async def get_gold_loan(loan_id: str, _: dict = Depends(require_staff_or_module('gold_loans'))):
    loan = await _get_loan(loan_id)
    bal = await _loan_balances(loan)
    txns = await db.gold_loan_transactions.find({'loan_id': loan_id}, {'_id': 0}).sort('created_at', -1).to_list(2000)
    return {**loan, **bal, 'transactions': txns}


@router.put('/gold-loans/{loan_id}')
async def update_gold_loan(loan_id: str, body: GoldLoanUpdateIn, user=Depends(require_admin_or_module_right('gold_loans', 'edit'))):
    loan = await _get_loan(loan_id)
    if loan['status'] != 'active':
        raise HTTPException(status_code=400, detail='This loan is closed — nothing left to edit')
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if upd:
        await db.gold_loans.update_one({'id': loan_id}, {'$set': upd})
        await log_audit(user, 'gold_loan.update', 'gold_loan', loan_id, loan['loan_no'])
    return await _get_loan(loan_id)


@router.post('/gold-loans/{loan_id}/payment')
async def record_gold_loan_payment(loan_id: str, body: GoldLoanPaymentIn, user=Depends(require_admin_or_module('gold_loans'))):
    loan = await _get_loan(loan_id)
    if loan['status'] != 'active':
        raise HTTPException(status_code=400, detail='This loan is already closed')
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail='Amount must be greater than 0')
    iso = now_utc().isoformat()
    txn = {
        'id': str(uuid.uuid4()), 'loan_id': loan_id,
        'type': 'payment_interest' if body.type == 'interest' else 'payment_principal',
        'amount': body.amount, 'date': body.date or today_str(), 'note': body.note or '',
        'auto': False, 'created_by': user['name'], 'created_by_id': user['id'], 'created_at': iso,
    }
    await db.gold_loan_transactions.insert_one(dict(txn))
    await log_audit(user, 'gold_loan.payment', 'gold_loan', loan_id, loan['loan_no'],
                     {'type': body.type, 'amount': body.amount})
    return {k: v for k, v in txn.items() if k != '_id'}


@router.post('/gold-loans/{loan_id}/close')
async def close_gold_loan(loan_id: str, user=Depends(require_admin_or_module('gold_loans'))):
    loan = await _get_loan(loan_id)
    if loan['status'] != 'active':
        raise HTTPException(status_code=400, detail='This loan is already closed')
    bal = await _loan_balances(loan)
    if bal['total_outstanding'] > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"₹{bal['total_outstanding']:,.2f} is still outstanding (₹{bal['principal_balance']:,.2f} principal + ₹{bal['interest_balance']:,.2f} interest) — collect it before closing.",
        )
    iso = now_utc().isoformat()
    await db.gold_loans.update_one({'id': loan_id}, {'$set': {'status': 'closed', 'closed_at': iso, 'closed_by': user['name']}})
    await log_audit(user, 'gold_loan.close', 'gold_loan', loan_id, loan['loan_no'])
    return await _get_loan(loan_id)


@router.delete('/gold-loans/{loan_id}')
async def delete_gold_loan(loan_id: str, user=Depends(require_owner)):
    loan = await _get_loan(loan_id)
    if await db.gold_loan_transactions.count_documents({'loan_id': loan_id}) > 0:
        raise HTTPException(status_code=400, detail='This loan already has interest/payment history — it cannot be deleted, only closed.')
    await db.gold_loans.delete_one({'id': loan_id})
    await log_audit(user, 'gold_loan.delete', 'gold_loan', loan_id, loan['loan_no'])
    return {'ok': True}


def _loan_voucher_lines(loan: dict) -> list:
    lines = [
        ('Loan No', loan['loan_no']),
        ('Date', loan['loan_date']),
        ('Customer', loan['customer_name']),
        ('Mobile', loan.get('customer_mobile') or '—'),
        ('Item', loan['description']),
        ('Weight', f"{loan['weight']:.3f}g"),
        ('Pieces', str(loan.get('pc_count') or 1)),
        ('Principal', f"Rs.{loan['principal']:,.0f}"),
        ('Interest Rate', f"{loan['interest_rate_percent']:.2f}% / month"),
    ]
    if loan.get('estimate_return_date'):
        lines.append(('Est. Return', loan['estimate_return_date']))
    lines.append(('Issued By', loan.get('created_by') or ''))
    if loan.get('note'):
        lines.append(('Note', loan['note']))
    lines.append('')
    lines.append('Customer Signature: _____________________')
    return lines


@router.get('/gold-loans/{loan_id}/voucher/pdf')
async def gold_loan_voucher_pdf(loan_id: str, _: dict = Depends(require_staff_or_module('gold_loans'))):
    loan = await _get_loan(loan_id)
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    pdf = _thermal_slip_pdf(store.get('name') or 'Ram Murti Jewellers', 'Loan Against Gold', _loan_voucher_lines(loan))
    return _pdf_response(pdf, f'gold-loan-{loan["loan_no"]}.pdf')


@router.post('/gold-loans/{loan_id}/voucher/print')
async def gold_loan_voucher_print(loan_id: str, user=Depends(require_staff_or_module('gold_loans'))):
    loan = await _get_loan(loan_id)
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    data = _escpos_receipt(store.get('name') or 'Ram Murti Jewellers', 'Loan Against Gold', _loan_voucher_lines(loan))
    await _print_escpos(data)
    await log_audit(user, 'gold_loan.voucher_print', 'gold_loan', loan_id, loan['loan_no'], {})
    return {'ok': True}


# ---------------- Monthly interest auto-post ----------------
async def check_interest_due() -> None:
    """Runs from the server's existing 15-minute reminder loop. Fires once per
    loan per calendar month, on the day-of-month matching the loan's own
    start date (clamped to the month's length, same pattern as payroll's
    auto-advance day) — so a loan taken on the 31st still charges in a
    30-day month instead of silently skipping it. Interest is computed on
    the CURRENT outstanding principal, not the original amount, so a partial
    principal repayment correctly lowers next month's charge."""
    now_ist = now_utc().astimezone(IST)
    today = now_ist.date()
    async for loan in db.gold_loans.find({'status': 'active'}, {'_id': 0}):
        try:
            anchor = date.fromisoformat(loan['loan_date'])
        except (ValueError, KeyError):
            continue
        if today <= anchor:
            continue  # interest starts accruing a month after disbursement, not on day one
        last_day = monthrange(today.year, today.month)[1]
        target_day = min(anchor.day, last_day)
        if today.day != target_day:
            continue
        period = today.strftime('%Y-%m')
        gen_key = {'loan_id': loan['id'], 'period': period}
        if await db.gold_loan_interest_generations.find_one(gen_key, {'_id': 0}) is not None:
            continue
        await db.gold_loan_interest_generations.update_one(
            gen_key, {'$set': {**gen_key, 'created_at': now_utc().isoformat()}}, upsert=True,
        )
        bal = await _loan_balances(loan)
        if bal['principal_balance'] <= 0:
            continue  # fully repaid but not yet formally closed — nothing left to charge interest on
        amount = round(bal['principal_balance'] * (loan['interest_rate_percent'] / 100), 2)
        if amount <= 0:
            continue
        await db.gold_loan_transactions.insert_one({
            'id': str(uuid.uuid4()), 'loan_id': loan['id'], 'type': 'interest_due',
            'amount': amount, 'date': today.isoformat(), 'note': f'Interest for {period}',
            'auto': True, 'created_by': 'system', 'created_by_id': None, 'created_at': now_utc().isoformat(),
        })
        await _notify_module(
            'gold_loans', 'Gold loan interest posted',
            f"{loan['loan_no']} · {loan['customer_name']} · Rs.{amount:,.0f}", '/loans',
            script='gold_loan_interest_posted', admin_only=True,
        )
