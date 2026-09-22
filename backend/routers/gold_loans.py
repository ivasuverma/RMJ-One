"""Loan Against Gold: cash paid out to a customer against pledged gold items,
with interest accruing day-wise on the outstanding principal (posted once a
month) until the loan is closed (customer collects the pledge back).

Two collections beyond the loan record itself:
  - gold_loan_transactions: every interest charge (auto-posted monthly),
    every payment received (tagged interest or principal by whoever takes
    the cash), and every top-up paid out (more cash handed to the customer
    against the same pledge, raising the outstanding principal). Balances
    are always derived from this ledger, never stored, same philosophy as
    routers/ledger.py — so editing history stays honest.
  - gold_loan_interest_generations: idempotency guard (loan_id + period) so
    the 15-minute reminder-loop poll can't double-post a month's interest.

Reuses the repairs module's customer directory (db.customers) and thermal
print helpers rather than duplicating either."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from calendar import monthrange
from datetime import date, datetime, timedelta
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
    get_print_config,
)
from routers.repairs import _mirror_party_account, _escpos_receipt, _print_escpos, _thermal_slip_pdf, _inr, _dmy
from print_templates import apply_field_config

router = APIRouter()


async def _next_loan_no() -> str:
    count = await db.gold_loans.count_documents({})
    return f'GL-{count + 1:04d}'


async def _get_loan(loan_id: str) -> dict:
    # Excludes the legacy `photo` field some older docs may still carry — a
    # single inline base64 pledge photo used to be stored right on the loan,
    # which made every fetch here (payments, backfill, voucher generation,
    # not just the detail screen) drag a multi-hundred-KB blob out of Mongo
    # for no reason. Photos now live in record-photos (see RecordPhotos on
    # the loan detail screen), same as repairs/samples.
    loan = await db.gold_loans.find_one({'id': loan_id}, {'_id': 0, 'photo': 0})
    if not loan:
        raise HTTPException(status_code=404, detail='Loan not found')
    return loan


def _compute_loan_state(loan: dict, txns: list) -> dict:
    """Pure function over an already-fetched transaction list, so callers that
    need many loans at once (list/dashboard) can bulk-fetch transactions in a
    single query and share this math instead of round-tripping per loan.

    Also derives "months received vs pending". Two ways a month can be
    marked received:
      1. Explicitly tagged — recording an interest payment can carry a
         `periods` list (the months the staff picked on the interest
         calendar when recording it). Any due period named there is
         received, full stop.
      2. Old-style / untagged payments (recorded before that picker existed,
         or a lump-sum staff chose not to tag) — the leftover paid amount
         after subtracting tagged payments is walked FIFO across the
         remaining untagged due periods, oldest first, same as before.
    Display-only; doesn't change how payments themselves are stored."""
    interest_due_txns = [t for t in txns if t['type'] == 'interest_due']
    interest_due = sum(t['amount'] for t in interest_due_txns)
    interest_payments = [t for t in txns if t['type'] == 'payment_interest']
    interest_paid = sum(t['amount'] for t in interest_payments)
    principal_paid = sum(t['amount'] for t in txns if t['type'] == 'payment_principal')
    # Top-ups (see GoldLoanPaymentIn) raise the balance the same way a
    # repayment lowers it — more cash paid out to the customer against the
    # same pledge.
    principal_topup = sum(t['amount'] for t in txns if t['type'] == 'topup_principal')
    principal_balance = round(loan['principal'] - principal_paid + principal_topup, 2)
    interest_balance = round(interest_due - interest_paid, 2)

    tagged_periods: set = set()
    tagged_amount = 0.0
    for p in interest_payments:
        periods = p.get('periods') or []
        if periods:
            tagged_periods.update(periods)
            tagged_amount += p['amount']
    untagged_pool = interest_paid - tagged_amount

    dues_sorted = sorted(interest_due_txns, key=lambda t: (t.get('period') or t['date']))
    months_received = 0
    still_covering = True
    interest_months = []
    for d in dues_sorted:
        period = d.get('period') or (d['date'] or '')[:7]
        if period in tagged_periods:
            paid = True
        else:
            paid = still_covering and untagged_pool + 0.01 >= d['amount']
            if paid:
                untagged_pool -= d['amount']
            else:
                still_covering = False  # FIFO by month order — once one untagged month is short, later ones can't jump ahead of it
        if paid:
            months_received += 1
        interest_months.append({'period': period, 'date': d['date'], 'amount': d['amount'], 'paid': paid})

    return {
        'principal': loan['principal'], 'principal_paid': round(principal_paid, 2), 'principal_topup': round(principal_topup, 2),
        'principal_balance': principal_balance,
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
        'principal': body.principal, 'interest_rate_percent': body.interest_rate_percent,
        'loan_date': body.loan_date or today_str(), 'estimate_return_date': body.estimate_return_date,
        'status': 'active', 'closed_at': None, 'closed_by': None,
        'note': body.note or '', 'created_at': iso, 'created_by': user['name'], 'created_by_id': user['id'],
    }
    await db.gold_loans.insert_one(dict(loan))
    # A loan entered with a backdated loan_date (recording a real gold loan
    # that predates the software) may already have elapsed months of
    # interest — post those immediately rather than waiting for the next
    # reminder-loop tick, so staff can record a historical payment against
    # it in the same sitting.
    await _backfill_loan_interest(loan)
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
        # "Overdue" means unpaid interest, not a missed estimated-return
        # date (that date is only ever a rough guess) — the interest
        # balance is derived, so filter for it in Python below instead of
        # in the Mongo query.
        query['status'] = 'active'
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
    txns_by_loan = await _bulk_loan_txns([l['id'] for l in loans])
    out = []
    for loan in loans:
        state = {k: v for k, v in _compute_loan_state(loan, txns_by_loan.get(loan['id'], [])).items() if k != 'interest_months'}
        overdue = loan['status'] == 'active' and state['interest_balance'] > 0.01
        out.append({**loan, **state, 'overdue': overdue})
    if status_ == 'overdue':
        out = [l for l in out if l['overdue']]
    return out


@router.get('/gold-loans/dashboard')
async def gold_loans_dashboard(_: dict = Depends(require_staff_or_module('gold_loans'))):
    today = today_str()
    closed_today = await db.gold_loans.count_documents({'status': 'closed', 'closed_at': {'$regex': f'^{today}'}})
    loans = await db.gold_loans.find({'status': 'active'}, {'_id': 0, 'photo': 0}).to_list(5000)
    active = len(loans)
    txns_by_loan = await _bulk_loan_txns([l['id'] for l in loans])
    states = [_compute_loan_state(l, txns_by_loan.get(l['id'], [])) for l in loans]
    # Overdue = unpaid interest, not a missed (approximate) estimated-return date.
    overdue = sum(1 for s in states if s['interest_balance'] > 0.01)
    total_outstanding = sum(s['total_outstanding'] for s in states)
    total_interest_pending = sum(max(s['interest_balance'], 0) for s in states)
    return {
        'active': active, 'overdue': overdue, 'closed_today': closed_today,
        'total_outstanding': round(total_outstanding, 2),
        'total_interest_pending': round(total_interest_pending, 2),
    }


async def _current_month_accrual(loan: dict) -> Optional[dict]:
    """Interest accrued so far in the current, not-yet-posted calendar month
    — a live preview using _month_interest_daywise itself (period end =
    tomorrow, so today's own day counts), not a separately maintained
    calculation. allow_topup=False because the month isn't over — see that
    function's docstring for why topping up an in-progress month would
    overstate the preview. Only meaningful for an active loan that's
    already started; None once nothing has accrued yet this month or the
    loan is closed."""
    try:
        loan_date = date.fromisoformat(loan['loan_date'])
    except (ValueError, KeyError):
        return None
    today = now_utc().astimezone(IST).date()
    period_start = date(today.year, today.month, 1)
    if loan_date > today:
        return None
    raw_principal_txns = await db.gold_loan_transactions.find(
        {'loan_id': loan['id'], 'type': {'$in': ['payment_principal', 'topup_principal']}}, {'_id': 0},
    ).to_list(5000)
    principal_txns = []
    for t in raw_principal_txns:
        try:
            amt = t['amount'] if t['type'] == 'payment_principal' else -t['amount']
            principal_txns.append((date.fromisoformat(t['date']), amt))
        except (ValueError, KeyError):
            continue
    amount = _month_interest_daywise(loan, principal_txns, period_start, today + timedelta(days=1), loan_date, allow_topup=False)
    if amount <= 0:
        return None
    days = (today - max(period_start, loan_date)).days + 1
    return {'period': today.strftime('%Y-%m'), 'days': days, 'amount': amount}


@router.get('/gold-loans/{loan_id}')
async def get_gold_loan(loan_id: str, _: dict = Depends(require_staff_or_module('gold_loans'))):
    """Summary only — loan fields, derived balances, and the interest-month
    calendar. The full transaction ledger is fetched separately (paginated,
    see list_gold_loan_transactions below) so this detail load stays light
    instead of pulling every payment/interest row up front."""
    loan = await _get_loan(loan_id)
    if loan['status'] == 'active':
        await _backfill_loan_interest(loan)  # catch up before computing balances — don't wait on the poll
    bal = await _loan_balances(loan)
    accrued = await _current_month_accrual(loan) if loan['status'] == 'active' else None
    return {**loan, **bal, 'interest_accrued_this_month': accrued}


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


def _closed_date(loan: dict) -> Optional[date]:
    """The IST calendar date a loan was closed on, or None if it's active
    (or the timestamp is somehow missing/malformed). Used to stop a
    display walk at the actual close date instead of the full calendar
    month — the loan wasn't outstanding for the rest of that month."""
    if loan.get('status') != 'closed' or not loan.get('closed_at'):
        return None
    try:
        return datetime.fromisoformat(loan['closed_at']).astimezone(IST).date()
    except ValueError:
        return None


@router.get('/gold-loans/{loan_id}/interest-breakdown')
async def gold_loan_interest_breakdown(loan_id: str, _: dict = Depends(require_staff_or_module('gold_loans'))):
    """The day-by-day workings behind each already-posted month of interest —
    for staff who want to see exactly how a month's figure was reached, not
    just the total. One entry per posted interest_due period, oldest first;
    each carries the real posted amount (from the ledger, authoritative) plus
    the day-wise segments that explain it (see _month_interest_segments —
    display only, its own rounding can differ from the posted amount by a
    paisa or two on a month with more than one segment, same as any
    itemised bill)."""
    loan = await _get_loan(loan_id)
    try:
        loan_date = date.fromisoformat(loan['loan_date'])
    except (ValueError, KeyError):
        return {'daily_rate_percent': 0, 'months': []}
    closed_date = _closed_date(loan)

    txns = await db.gold_loan_transactions.find(
        {'loan_id': loan_id, 'type': {'$in': ['payment_principal', 'topup_principal', 'interest_due']}}, {'_id': 0},
    ).to_list(5000)
    principal_txns = []
    interest_due = []
    for t in txns:
        if t['type'] == 'interest_due':
            interest_due.append(t)
            continue
        try:
            amt = t['amount'] if t['type'] == 'payment_principal' else -t['amount']
            principal_txns.append((date.fromisoformat(t['date']), amt))
        except (ValueError, KeyError):
            continue

    months = []
    seen_periods = set()
    for entry in sorted(interest_due, key=lambda e: e.get('period') or ''):
        period = entry.get('period')
        if not period or period in seen_periods:
            continue  # one card per period — never show the same month twice
        try:
            y, m = int(period[:4]), int(period[5:7])
        except (ValueError, IndexError):
            continue
        seen_periods.add(period)
        period_start = date(y, m, 1)
        next_y, next_m = _add_month(y, m)
        period_end = date(next_y, next_m, 1)
        # No top-up for the loan's own stub first period, or for the stub
        # period it was closed in (that period was deliberately cut short,
        # not a genuinely short calendar month) — see _month_interest_daywise.
        allow_topup = loan_date <= period_start
        if closed_date and closed_date < period_end:
            period_end = closed_date
            allow_topup = False
        segments = _month_interest_segments(loan, principal_txns, period_start, period_end, loan_date, allow_topup=allow_topup)
        months.append({'period': period, 'posted_amount': round(float(entry.get('amount') or 0), 2), 'segments': segments})

    return {'daily_rate_percent': round(loan['interest_rate_percent'] / 30, 5), 'months': months}


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
    # Catch up interest_due first so an interest payment recorded for a
    # backdated/old loan has something to match against right away instead
    # of sitting as an unexplained negative balance until the next poll.
    await _backfill_loan_interest(loan)
    iso = now_utc().isoformat()
    txn_type = {'interest': 'payment_interest', 'principal': 'payment_principal', 'topup': 'topup_principal'}[body.type]
    txn = {
        'id': str(uuid.uuid4()), 'loan_id': loan_id,
        'type': txn_type,
        'amount': body.amount, 'date': body.date or today_str(), 'note': body.note or '',
        # Months this payment covers, from the calendar picker — interest
        # payments only; None/empty falls back to FIFO matching in
        # _compute_loan_state (see its docstring).
        'periods': (body.periods or None) if body.type == 'interest' else None,
        'auto': False, 'created_by': user['name'], 'created_by_id': user['id'], 'created_at': iso,
    }
    await db.gold_loan_transactions.insert_one(dict(txn))
    await log_audit(user, 'gold_loan.payment', 'gold_loan', loan_id, loan['loan_no'],
                     {'type': body.type, 'amount': body.amount})
    if body.type == 'topup':
        await _notify_module('gold_loans', f"Top-up on {loan['loan_no']}",
                              f"{loan['customer_name']} · {_inr(body.amount)} paid out · by {user['name']}", '/loans',
                              script='gold_loan_topup', admin_only=True)
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
    loan_id: str, txn_id: str, user=Depends(require_admin_or_module_right('gold_loans', 'delete')),
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
    # Post any already-complete months first, then the final partial period
    # up to today — so the outstanding check below (and what staff collect
    # before closing) includes every day the loan was actually outstanding,
    # not just whatever was posted as of the last calendar month-end.
    await _backfill_loan_interest(loan)
    await _post_closing_interest(loan, now_utc().astimezone(IST).date())
    loan = await _get_loan(loan_id)
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
        ('loan_no', 'Loan No', loan['loan_no']),
        ('date', 'Date', _dmy(loan['loan_date'])),
        ('customer', 'Customer', loan['customer_name']),
        ('mobile', 'Mobile', loan.get('customer_mobile') or '—'),
        ('item', 'Item', loan['description']),
        ('weight', 'Weight', f"{loan['weight']:.3f}g"),
        ('pieces', 'Pieces', str(loan.get('pc_count') or 1)),
        ('principal', 'Principal', _inr(loan['principal'])),
        ('interest_rate', 'Interest Rate', f"{loan['interest_rate_percent']:.2f}% / month"),
    ]
    if loan.get('estimate_return_date'):
        lines.append(('est_return', 'Est. Return', _dmy(loan['estimate_return_date'])))
    lines.append(('issued_by', 'Issued By', loan.get('created_by') or ''))
    if loan.get('note'):
        lines.append(('note', 'Note', loan['note']))
    lines.append('')
    lines.append('Customer Signature: _____________________')
    return lines


@router.get('/gold-loans/{loan_id}/voucher/pdf')
async def gold_loan_voucher_pdf(loan_id: str, _: dict = Depends(require_staff_or_module('gold_loans'))):
    loan = await _get_loan(loan_id)
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    cfg = await get_print_config('gold_loan_voucher')
    pdf = _thermal_slip_pdf(store.get('name') or 'Ram Murti Jewellers', 'Loan Against Gold',
                             apply_field_config(_loan_voucher_lines(loan), cfg),
                             show_shop_name=cfg['show_shop_name'], font_size=cfg['font_size'], field_sizes=cfg['field_sizes'],
                             title_size=cfg['title_size'], field_dividers=cfg['field_dividers'])
    return _pdf_response(pdf, f'gold-loan-{loan["loan_no"]}.pdf')


@router.post('/gold-loans/{loan_id}/voucher/print')
async def gold_loan_voucher_print(loan_id: str, user=Depends(require_staff_or_module('gold_loans'))):
    loan = await _get_loan(loan_id)
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    cfg = await get_print_config('gold_loan_voucher')
    data = _escpos_receipt(store.get('name') or 'Ram Murti Jewellers', 'Loan Against Gold',
                            apply_field_config(_loan_voucher_lines(loan), cfg),
                            show_shop_name=cfg['show_shop_name'], font_size=cfg['font_size'], field_sizes=cfg['field_sizes'],
                            title_size=cfg['title_size'], field_dividers=cfg['field_dividers'])
    await _print_escpos(data)
    await log_audit(user, 'gold_loan.voucher_print', 'gold_loan', loan_id, loan['loan_no'], {})
    return {'ok': True}


# ---------------- Day-wise interest auto-post ----------------
def _day_balance(loan: dict, principal_txns: list, d: date) -> float:
    balance = loan['principal']
    for txn_date, amt in principal_txns:
        if txn_date <= d:
            balance -= amt
    return max(balance, 0)


def _month_interest_daywise(loan: dict, principal_txns: list, period_start: date, period_end: date, loan_date: date,
                             allow_topup: bool = True) -> float:
    """Sums one calendar month's interest as day * balance-on-that-day * daily
    rate, rather than snapping the whole month to a single before/after
    balance. Daily rate = monthly rate / 30 (the shop's convention), and
    every posted month is worth EXACTLY 30 days of that rate, regardless of
    the calendar month's actual length:
      - a 31-day month only charges its first 30 days — the 31st accrues
        nothing extra, so a long month never charges more than one month's
        interest;
      - a short month (February, or a loan's partial first month) walks
        whatever actual days it has, then tops up the remainder to 30 days
        at the balance as of the last actual day — so every full month
        still charges exactly one month's interest, not less.
    A repayment or top-up (see GoldLoanPaymentIn; top-ups carry a negative
    amount here so subtracting one raises the balance) takes effect the
    same day it's dated — no cutoff, no snapping to month boundaries.

    Starting the walk at max(period_start, loan_date) is what prorates a
    loan's first, partial month correctly (e.g. a loan taken on the 20th
    only charges the 11-12 remaining days of that month, then tops up to
    30) instead of the old day-15 either/or of "whole month" or "no month".

    allow_topup=False skips the top-up-to-30-days step entirely — for a
    LIVE preview of a month that's still in progress (see
    _current_month_accrual), period_end is an artificial "as of today"
    cutoff, not the month's real end, so falling short of 30 days doesn't
    mean the month was short; it means the month isn't over yet. Topping
    that up would charge for days that haven't happened, priced at
    whatever the balance happens to be today — overstating the preview
    every time there are fewer than 30 days elapsed, worst right after a
    top-up. Only ever pass False for a preview; real posting always wants
    the default (True), which is what makes every completed month worth
    exactly one month's interest.

    This is the SOLE authority for what actually posts — kept independent of
    _month_interest_segments (below) on purpose, so a display-only feature
    can never nudge the real ledger by a paisa of rounding drift."""
    rate = loan['interest_rate_percent'] / 100 / 30
    total = 0.0
    d = max(period_start, loan_date)
    days_counted = 0
    last_balance = 0.0
    while d < period_end and days_counted < 30:
        last_balance = _day_balance(loan, principal_txns, d)
        total += last_balance * rate
        days_counted += 1
        d += timedelta(days=1)
    if allow_topup and days_counted < 30:
        # Short month (or the tail end of the loan's first partial month) —
        # top up to a full 30 days at the balance on the last actual day, so
        # every full month still charges exactly one month's interest.
        if days_counted == 0:
            last_balance = _day_balance(loan, principal_txns, d)
        total += last_balance * rate * (30 - days_counted)
    return round(total, 2)


def _month_interest_segments(loan: dict, principal_txns: list, period_start: date, period_end: date, loan_date: date,
                              allow_topup: bool = True) -> list:
    """Same day-walk as _month_interest_daywise (capped at 30 actual days,
    short months topped up to 30 unless allow_topup=False — see its
    docstring), but grouped into consecutive same-balance segments for
    display (see GET .../interest-breakdown) — the "9 days at ₹1,00,000,
    then 22 days at ₹60,000" workings behind a month's total. A topped-up
    short month's extra days have no real calendar dates to show, so
    they're folded into the last real segment's day-count/amount instead
    of inventing fake dates past the month's actual end. Each segment's
    amount is rounded independently for readability; across a month with
    more than one segment this can differ from the actual posted total by
    a paisa or two of rounding, same as any itemised bill — the posted
    amount (from _month_interest_daywise / the real ledger entry) is
    always the authoritative figure, not the sum of these lines."""
    rate = loan['interest_rate_percent'] / 100 / 30
    segments = []
    seg_start = None
    seg_balance = None
    seg_days = 0
    d = max(period_start, loan_date)
    days_counted = 0
    while d < period_end and days_counted < 30:
        balance = _day_balance(loan, principal_txns, d)
        if seg_balance is None or balance != seg_balance:
            if seg_start is not None:
                segments.append({'from': seg_start.isoformat(), 'to': (d - timedelta(days=1)).isoformat(),
                                  'days': seg_days, 'balance': round(seg_balance, 2), 'amount': round(seg_balance * rate * seg_days, 2)})
            seg_start, seg_balance, seg_days = d, balance, 0
        seg_days += 1
        days_counted += 1
        d += timedelta(days=1)
    if allow_topup and days_counted < 30:
        # Short month — top up the last segment's day-count (see docstring)
        # instead of fabricating dates past the month's real end.
        if seg_balance is None:
            seg_start, seg_balance = d, _day_balance(loan, principal_txns, d)
        seg_days += 30 - days_counted
    if seg_start is not None:
        segments.append({'from': seg_start.isoformat(), 'to': (d - timedelta(days=1)).isoformat(),
                          'days': seg_days, 'balance': round(seg_balance, 2), 'amount': round(seg_balance * rate * seg_days, 2)})
    return segments


def _add_month(y: int, m: int) -> tuple:
    m += 1
    if m > 12:
        return y + 1, 1
    return y, m


async def _backfill_loan_interest(loan: dict) -> None:
    """Walks every calendar month the loan has been running, posting
    whichever of those periods aren't in db.gold_loan_interest_generations
    yet. Each month's amount is computed day-wise (see
    _month_interest_daywise) — daily rate = monthly rate / 30, applied to
    whatever the balance actually was on each individual day, so a loan's
    first partial month and any mid-month repayment/top-up are charged
    exactly, not snapped to a day-15 cutoff.

    Interest still POSTS on the LAST day of each calendar month (not the
    loan's own day-of-month) — so a loan from 1 July posts its July interest
    on 31 July, its August interest on 31 August, etc. That's just the
    posting schedule; the amount itself already reflects every day
    individually.

    Walking the whole span (not just "is today the due day") means a period
    is never permanently skipped just because this didn't happen to run on
    its exact due date.

    Called from three places: the 15-minute reminder loop (check_interest_due,
    below) for the steady-state case, and synchronously from create/get/pay
    on a single loan — a loan entered with a backdated loan_date (a real
    gold loan that predates the software) would otherwise show any interest
    payment recorded for it as an unmatched negative balance until the next
    poll tick generates the interest_due entries it's meant to cover."""
    now_ist = now_utc().astimezone(IST)
    today = now_ist.date()
    try:
        loan_date = date.fromisoformat(loan['loan_date'])
    except (ValueError, KeyError):
        return

    y, m = loan_date.year, loan_date.month  # day-wise proration handles the partial first month itself — no month-snapping needed

    raw_principal_txns = await db.gold_loan_transactions.find(
        {'loan_id': loan['id'], 'type': {'$in': ['payment_principal', 'topup_principal']}}, {'_id': 0},
    ).to_list(5000)
    principal_txns = []
    for t in raw_principal_txns:
        try:
            # Top-ups raise the balance, so they go in negated — see
            # _month_interest_daywise's docstring.
            amt = t['amount'] if t['type'] == 'payment_principal' else -t['amount']
            principal_txns.append((date.fromisoformat(t['date']), amt))
        except (ValueError, KeyError):
            continue

    while True:
        last_day = monthrange(y, m)[1]
        due_date = date(y, m, last_day)  # posts on the last day of the month
        if due_date > today:
            break  # this month hasn't ended yet — don't post early

        period_start = date(y, m, 1)
        next_y, next_m = _add_month(y, m)
        period_end = date(next_y, next_m, 1)

        period = due_date.strftime('%Y-%m')
        gen_key = {'loan_id': loan['id'], 'period': period}
        y, m = next_y, next_m  # advance to the next month regardless of what happens below
        if await db.gold_loan_interest_generations.find_one(gen_key, {'_id': 0}) is not None:
            continue  # already posted for this period
        await db.gold_loan_interest_generations.update_one(
            gen_key, {'$set': {**gen_key, 'created_at': now_utc().isoformat()}}, upsert=True,
        )
        # No top-up for the loan's own stub first period (loan started mid-
        # month) — charge only the real days it was actually outstanding.
        # Every later period has the loan already running before it starts,
        # so a genuinely short calendar month (February) still tops up.
        allow_topup = loan_date <= period_start
        amount = _month_interest_daywise(loan, principal_txns, period_start, period_end, loan_date, allow_topup=allow_topup)
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


async def _post_closing_interest(loan: dict, close_date: date) -> None:
    """Posts the loan's final, partial period of interest at closing time —
    from the start of whatever calendar month hasn't been posted yet up to
    (not including) close_date, the day the loan is actually settled. Real
    days only, never topped up to 30 (allow_topup=False): the loan is being
    wound up on purpose, not running a genuinely short calendar month.
    close_date itself isn't charged — the loan is being paid off that day,
    not held through it, mirroring how the loan's own start day IS charged
    (it was outstanding, in full, for that whole day).

    Idempotent via the same gold_loan_interest_generations guard
    _backfill_loan_interest uses, keyed by the same 'YYYY-MM' period — if
    the month somehow already posted in full before this ran, this is a
    no-op, never a double-post. Call _backfill_loan_interest first so any
    already-COMPLETE months post normally before this covers the stub."""
    try:
        loan_date = date.fromisoformat(loan['loan_date'])
    except (ValueError, KeyError):
        return
    period_start = date(close_date.year, close_date.month, 1)
    if max(period_start, loan_date) >= close_date:
        return  # nothing outstanding for even a full day this period

    period = close_date.strftime('%Y-%m')
    gen_key = {'loan_id': loan['id'], 'period': period}
    if await db.gold_loan_interest_generations.find_one(gen_key, {'_id': 0}) is not None:
        return  # already posted (e.g. the month completed and backfilled before closing ran)
    await db.gold_loan_interest_generations.update_one(
        gen_key, {'$set': {**gen_key, 'created_at': now_utc().isoformat()}}, upsert=True,
    )

    raw_principal_txns = await db.gold_loan_transactions.find(
        {'loan_id': loan['id'], 'type': {'$in': ['payment_principal', 'topup_principal']}}, {'_id': 0},
    ).to_list(5000)
    principal_txns = []
    for t in raw_principal_txns:
        try:
            amt = t['amount'] if t['type'] == 'payment_principal' else -t['amount']
            principal_txns.append((date.fromisoformat(t['date']), amt))
        except (ValueError, KeyError):
            continue

    amount = _month_interest_daywise(loan, principal_txns, period_start, close_date, loan_date, allow_topup=False)
    if amount <= 0:
        return
    await db.gold_loan_transactions.insert_one({
        'id': str(uuid.uuid4()), 'loan_id': loan['id'], 'type': 'interest_due', 'period': period,
        'amount': amount, 'date': close_date.isoformat(), 'note': f'Interest for {period} (partial — loan closed)',
        'auto': True, 'created_by': 'system', 'created_by_id': None, 'created_at': now_utc().isoformat(),
    })


async def check_interest_due() -> None:
    """Runs from the server's existing 15-minute reminder loop, catching up
    every active loan. See _backfill_loan_interest for the per-loan logic."""
    async for loan in db.gold_loans.find({'status': 'active'}, {'_id': 0, 'photo': 0}):
        await _backfill_loan_interest(loan)


async def check_monthly_interest_collection_reminder() -> None:
    """Once a month, nudge the owner/admin to go collect pending gold-loan
    interest — a single digest is more useful than sifting through the
    per-loan 'interest posted' notifications individually. Fires on/after
    the 1st of the month (by when last month's interest has posted) and
    only when something is actually outstanding; guarded by
    db.gold_loan_collection_reminders so the 15-minute poll sends it once
    per calendar month."""
    now_ist = now_utc().astimezone(IST)
    period = now_ist.strftime('%Y-%m')
    if await db.gold_loan_collection_reminders.find_one({'period': period}, {'_id': 0}) is not None:
        return

    loans = await db.gold_loans.find({'status': 'active'}, {'_id': 0, 'photo': 0}).to_list(5000)
    txns_by_loan = await _bulk_loan_txns([l['id'] for l in loans])
    states = [_compute_loan_state(l, txns_by_loan.get(l['id'], [])) for l in loans]
    pending = [s for s in states if s['interest_balance'] > 0.01]

    await db.gold_loan_collection_reminders.update_one(
        {'period': period},
        {'$set': {'period': period, 'sent_at': now_utc().isoformat(), 'count': len(pending)}},
        upsert=True,
    )
    if not pending:
        return
    total = round(sum(s['interest_balance'] for s in pending), 2)
    await _notify_module(
        'gold_loans', 'Gold loan interest due for collection',
        f"{len(pending)} loan{'s' if len(pending) != 1 else ''} · {_inr(total)} pending interest",
        '/loans?status=overdue', script='gold_loan_monthly_interest_reminder', admin_only=True,
    )
