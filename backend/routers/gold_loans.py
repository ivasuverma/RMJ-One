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
    principal_balance = round(loan['principal'] - principal_paid, 2)
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
    loans = await db.gold_loans.find({'status': 'active'}, {'_id': 0}).to_list(5000)
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
    # Catch up interest_due first so an interest payment recorded for a
    # backdated/old loan has something to match against right away instead
    # of sitting as an unexplained negative balance until the next poll.
    await _backfill_loan_interest(loan)
    iso = now_utc().isoformat()
    txn = {
        'id': str(uuid.uuid4()), 'loan_id': loan_id,
        'type': 'payment_interest' if body.type == 'interest' else 'payment_principal',
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
def _principal_balance_for_period(loan: dict, principal_txns: list, period_start: date, period_end: date) -> float:
    """Principal balance to charge THIS period's interest on — the shop's
    own day-15 cutoff convention: a principal repayment made by the 15th of
    the calendar month it falls in reduces the balance for the period it
    lands in; made on or after the 15th, that period still bills interest
    on the pre-payment balance in full, and the lower balance only takes
    effect starting the following period. (Day 15 itself counts as "on/after
    15" — not reduced.) This only controls the timing of one period's
    interest charge; the loan's overall principal_balance (see
    _compute_loan_state, used for display and for "how much is owed now")
    already reflects every repayment immediately regardless of date."""
    balance = loan['principal']
    for d, amt in principal_txns:
        if d < period_start:
            balance -= amt
        elif period_start <= d < period_end and d.day < 15:
            balance -= amt
    return round(max(balance, 0), 2)


def _add_month(y: int, m: int) -> tuple:
    m += 1
    if m > 12:
        return y + 1, 1
    return y, m


async def _backfill_loan_interest(loan: dict) -> None:
    """Walks every calendar month the loan has been running, posting
    whichever of those periods aren't in db.gold_loan_interest_generations
    yet. Two shop conventions decide the schedule:

    - Which month interest starts from: gold received on the 1st-15th of a
      month starts accruing interest from THAT SAME calendar month; received
      on the 16th or later, accrual starts the following month.
    - When each month's interest posts: on the LAST day of that calendar
      month (not the loan's own day-of-month) — so a loan from 1 July posts
      its July interest on 31 July, its August interest on 31 August, etc.

    Walking the whole span (not just "is today the due day") means a period
    is never permanently skipped just because this didn't happen to run on
    its exact due date. Each period's interest is computed against that
    period's own principal balance under a separate day-15 cutoff rule (see
    _principal_balance_for_period) — a different convention, about how a
    mid-period principal repayment affects that same period's charge.

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

    y, m = loan_date.year, loan_date.month
    if loan_date.day > 15:
        y, m = _add_month(y, m)

    raw_principal_txns = await db.gold_loan_transactions.find(
        {'loan_id': loan['id'], 'type': 'payment_principal'}, {'_id': 0},
    ).to_list(5000)
    principal_txns = []
    for t in raw_principal_txns:
        try:
            principal_txns.append((date.fromisoformat(t['date']), t['amount']))
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
        principal_balance = _principal_balance_for_period(loan, principal_txns, period_start, period_end)
        if principal_balance <= 0:
            continue  # fully repaid (under this period's cutoff rule) — nothing left to charge interest on
        amount = round(principal_balance * (loan['interest_rate_percent'] / 100), 2)
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


async def check_interest_due() -> None:
    """Runs from the server's existing 15-minute reminder loop, catching up
    every active loan. See _backfill_loan_interest for the per-loan logic."""
    async for loan in db.gold_loans.find({'status': 'active'}, {'_id': 0}):
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

    loans = await db.gold_loans.find({'status': 'active'}, {'_id': 0}).to_list(5000)
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
