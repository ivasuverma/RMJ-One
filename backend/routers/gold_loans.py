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
    GoldLoanTxnUpdateIn,
    log_audit,
    _notify_module,
    _pdf_response,
)
from routers.repairs import _mirror_party_account, _escpos_receipt, _print_escpos, _thermal_slip_pdf, _inr, _dmy

router = APIRouter()


async def _next_loan_no() -> str:
    count = await db.gold_loans.count_documents({})
    return f'GL-{count + 1:04d}'


async def _get_loan(loan_id: str) -> dict:
    loan = await db.gold_loans.find_one({'id': loan_id}, {'_id': 0})
    if not loan:
        raise HTTPException(status_code=404, detail='Loan not found')
    return loan


def _compute_loan_state(loan: dict, txns: list) -> dict:
    """Pure function over an already-fetched transaction list, so callers that
    need many loans at once (list/dashboard) can bulk-fetch transactions in a
    single query and share this math instead of round-tripping per loan.

    Also derives "months received vs pending": payments aren't tagged to a
    specific month (staff picks interest vs principal only, never which
    month — see gold_loans design notes), so a paid-interest pool is walked
    FIFO across the ordered interest_due entries to decide how many months
    are fully covered. Display-only; doesn't change how payments are stored."""
    interest_due_txns = [t for t in txns if t['type'] == 'interest_due']
    interest_due = sum(t['amount'] for t in interest_due_txns)
    interest_paid = sum(t['amount'] for t in txns if t['type'] == 'payment_interest')
    principal_paid = sum(t['amount'] for t in txns if t['type'] == 'payment_principal')
    principal_balance = round(loan['principal'] - principal_paid, 2)
    interest_balance = round(interest_due - interest_paid, 2)

    dues_sorted = sorted(interest_due_txns, key=lambda t: (t.get('period') or t['date']))
    pool = interest_paid
    months_received = 0
    still_covering = True
    interest_months = []
    for d in dues_sorted:
        paid = still_covering and pool + 0.01 >= d['amount']
        if paid:
            pool -= d['amount']
            months_received += 1
        else:
            still_covering = False  # FIFO by month order — once one month is short, later months can't jump ahead of it
        interest_months.append({
            'period': d.get('period') or (d['date'] or '')[:7], 'date': d['date'], 'amount': d['amount'], 'paid': paid,
        })

    return {
        'principal': loan['principal'], 'principal_paid': round(principal_paid, 2), 'principal_balance': principal_balance,
        'interest_due': round(interest_due, 2), 'interest_paid': round(interest_paid, 2), 'interest_balance': interest_balance,
        'total_outstanding': round(principal_balance + interest_balance, 2),
        'interest_months_total': len(dues_sorted), 'interest_months_received': months_received,
        'interest_months_pending': len(dues_sorted) - months_received, 'interest_months': interest_months,
    }


async def _loan_balances(loan: dict) -> dict:
    """Everything downstream (detail, close-eligibility, interest posting)
    that only needs one loan's numbers reads through this. List/dashboard
    views use _bulk_loan_txns + _compute_loan_state directly to avoid
    issuing one query per loan."""
    txns = await db.gold_loan_transactions.find({'loan_id': loan['id']}, {'_id': 0}).to_list(5000)
    return _compute_loan_state(loan, txns)


async def _bulk_loan_txns(loan_ids: list) -> dict:
    """One query for every loan's transactions, grouped by loan_id — used by
    list/dashboard so they don't do the N+1 round-trip _loan_balances would."""
    txns = await db.gold_loan_transactions.find({'loan_id': {'$in': loan_ids}}, {'_id': 0}).to_list(20000)
    by_loan: dict = {}
    for t in txns:
        by_loan.setdefault(t['loan_id'], []).append(t)
    return by_loan


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
                          f"{customer['name']} · {_inr(body.principal)} · by {user['name']}", '/loans',
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
    txns_by_loan = await _bulk_loan_txns([l['id'] for l in loans])
    out = []
    for loan in loans:
        state = {k: v for k, v in _compute_loan_state(loan, txns_by_loan.get(loan['id'], [])).items() if k != 'interest_months'}
        out.append({
            **loan, **state,
            'overdue': loan['status'] == 'active' and bool(loan.get('estimate_return_date')) and loan['estimate_return_date'] < today,
        })
    return out


@router.get('/gold-loans/dashboard')
async def gold_loans_dashboard(_: dict = Depends(require_staff_or_module('gold_loans'))):
    today = today_str()
    closed_today = await db.gold_loans.count_documents({'status': 'closed', 'closed_at': {'$regex': f'^{today}'}})
    loans = await db.gold_loans.find({'status': 'active'}, {'_id': 0}).to_list(5000)
    active = len(loans)
    overdue = sum(1 for l in loans if l.get('estimate_return_date') and l['estimate_return_date'] < today)
    txns_by_loan = await _bulk_loan_txns([l['id'] for l in loans])
    total_outstanding = sum(
        _compute_loan_state(l, txns_by_loan.get(l['id'], []))['total_outstanding'] for l in loans
    )
    return {'active': active, 'overdue': overdue, 'total_outstanding': round(total_outstanding, 2), 'closed_today': closed_today}


@router.get('/gold-loans/{loan_id}')
async def get_gold_loan(loan_id: str, _: dict = Depends(require_staff_or_module('gold_loans'))):
    """Summary only — loan fields, derived balances, and the interest-month
    calendar. The full transaction ledger is fetched separately (paginated,
    see list_gold_loan_transactions below) so this detail load stays light
    instead of pulling every payment/interest row up front."""
    loan = await _get_loan(loan_id)
    bal = await _loan_balances(loan)
    return {**loan, **bal}


@router.get('/gold-loans/{loan_id}/transactions')
async def list_gold_loan_transactions(
    loan_id: str, skip: int = Query(default=0, ge=0), limit: int = Query(default=20, ge=1, le=200),
    _: dict = Depends(require_staff_or_module('gold_loans')),
):
    await _get_loan(loan_id)
    total = await db.gold_loan_transactions.count_documents({'loan_id': loan_id})
    items = await db.gold_loan_transactions.find({'loan_id': loan_id}, {'_id': 0}) \
        .sort('created_at', -1).skip(skip).limit(limit).to_list(limit)
    return {'items': items, 'total': total, 'skip': skip, 'limit': limit}


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


@router.put('/gold-loans/{loan_id}/transactions/{txn_id}')
async def update_gold_loan_transaction(
    loan_id: str, txn_id: str, body: GoldLoanTxnUpdateIn,
    user=Depends(require_admin_or_module_right('gold_loans', 'edit')),
):
    loan = await _get_loan(loan_id)
    txn = await db.gold_loan_transactions.find_one({'id': txn_id, 'loan_id': loan_id}, {'_id': 0})
    if not txn:
        raise HTTPException(status_code=404, detail='Transaction not found')
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if 'amount' in upd and upd['amount'] <= 0:
        raise HTTPException(status_code=400, detail='Amount must be greater than 0')
    if upd:
        await db.gold_loan_transactions.update_one({'id': txn_id}, {'$set': upd})
        await log_audit(user, 'gold_loan.transaction_update', 'gold_loan', loan_id, loan['loan_no'], {'txn_id': txn_id, **upd})
    return await db.gold_loan_transactions.find_one({'id': txn_id}, {'_id': 0})


@router.delete('/gold-loans/{loan_id}/transactions/{txn_id}')
async def delete_gold_loan_transaction(
    loan_id: str, txn_id: str, user=Depends(require_admin_or_module_right('gold_loans', 'edit')),
):
    loan = await _get_loan(loan_id)
    txn = await db.gold_loan_transactions.find_one({'id': txn_id, 'loan_id': loan_id}, {'_id': 0})
    if not txn:
        raise HTTPException(status_code=404, detail='Transaction not found')
    await db.gold_loan_transactions.delete_one({'id': txn_id})
    await log_audit(user, 'gold_loan.transaction_delete', 'gold_loan', loan_id, loan['loan_no'],
                     {'txn_id': txn_id, 'type': txn['type'], 'amount': txn['amount']})
    return {'ok': True}


@router.post('/gold-loans/{loan_id}/close')
async def close_gold_loan(loan_id: str, user=Depends(require_admin_or_module('gold_loans'))):
    loan = await _get_loan(loan_id)
    if loan['status'] != 'active':
        raise HTTPException(status_code=400, detail='This loan is already closed')
    bal = await _loan_balances(loan)
    if bal['total_outstanding'] > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"{_inr(bal['total_outstanding'])} is still outstanding ({_inr(bal['principal_balance'])} principal + {_inr(bal['interest_balance'])} interest) — collect it before closing.",
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
        ('Date', _dmy(loan['loan_date'])),
        ('Customer', loan['customer_name']),
        ('Mobile', loan.get('customer_mobile') or '—'),
        ('Item', loan['description']),
        ('Weight', f"{loan['weight']:.3f}g"),
        ('Pieces', str(loan.get('pc_count') or 1)),
        ('Principal', _inr(loan['principal'])),
        ('Interest Rate', f"{loan['interest_rate_percent']:.2f}% / month"),
    ]
    if loan.get('estimate_return_date'):
        lines.append(('Est. Return', _dmy(loan['estimate_return_date'])))
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
    """Runs from the server's existing 15-minute reminder loop. Walks every
    calendar month from the one after the loan's start date up through the
    current month, on the day-of-month matching the loan's own start date
    (clamped to each month's length, same pattern as payroll's auto-advance
    day — so a loan taken on the 31st still charges in a 30-day month
    instead of silently skipping it), and posts whichever of those periods
    aren't in db.gold_loan_interest_generations yet.

    Walking the whole span (not just "is today the due day") means a period
    is never permanently skipped just because the poll didn't happen to run
    on its exact due date (server downtime, a missed 15-minute tick, etc.)
    — the ledger stays true to "one interest entry per elapsed month" no
    matter how the polling actually landed. Interest is computed on the
    CURRENT outstanding principal, not the original amount, so a partial
    principal repayment correctly lowers the next unposted month's charge."""
    now_ist = now_utc().astimezone(IST)
    today = now_ist.date()
    async for loan in db.gold_loans.find({'status': 'active'}, {'_id': 0}):
        try:
            anchor = date.fromisoformat(loan['loan_date'])
        except (ValueError, KeyError):
            continue
        if today <= anchor:
            continue  # interest starts accruing a month after disbursement, not on day one

        y, m = anchor.year, anchor.month
        while True:
            m += 1
            if m > 12:
                m = 1
                y += 1
            last_day = monthrange(y, m)[1]
            due_date = date(y, m, min(anchor.day, last_day))
            if due_date > today:
                break  # this period hasn't come due yet — stop, don't post early

            period = due_date.strftime('%Y-%m')
            gen_key = {'loan_id': loan['id'], 'period': period}
            if await db.gold_loan_interest_generations.find_one(gen_key, {'_id': 0}) is not None:
                continue  # already posted for this period
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
                'id': str(uuid.uuid4()), 'loan_id': loan['id'], 'type': 'interest_due', 'period': period,
                'amount': amount, 'date': due_date.isoformat(), 'note': f'Interest for {period}',
                'auto': True, 'created_by': 'system', 'created_by_id': None, 'created_at': now_utc().isoformat(),
            })
            await _notify_module(
                'gold_loans', 'Gold loan interest posted',
                f"{loan['loan_no']} · {loan['customer_name']} · {_inr(amount)}", '/loans',
                script='gold_loan_interest_posted', admin_only=True,
            )
