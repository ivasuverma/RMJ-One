r"""One-time fix: re-periodize every gold loan's posted interest history from
calendar-month periods to exact 30-day periods (see routers/gold_loans.py's
_backfill_loan_interest and _month_interest_daywise).

WHY
    Interest posted on calendar-month boundaries (1st-to-1st), with the
    daily rate fixed at monthly rate / 30. That meant a 31-day calendar
    month was charged slightly MORE than one month's interest (31/30), and
    February slightly LESS (28 or 29/30). Periods are now exact 30-day
    blocks counted from the loan's own start date (day 1-30, 31-60, ...),
    so every posted period is worth exactly one month's rate.

WHAT IT DOES
    For every gold_loans loan (active or closed), this DELETES its existing
    auto-posted interest_due transactions (type='interest_due', auto=True)
    and the matching db.gold_loan_interest_generations idempotency records,
    then regenerates the interest history from scratch under the new
    30-day grid — walking day 1-30, 31-60, ... from loan_date up to today
    (or up to the loan's closed_at date, for a closed loan — matching
    whatever periods would naturally have posted while it was still
    active), using the exact same day-wise balance math as the live code
    (a repayment or top-up takes effect the day it's dated).

    Manually-recorded interest PAYMENTS (type='payment_interest') are never
    touched — what staff actually collected stays exactly as recorded.

    *** IMPORTANT — payment-to-period tagging ***
    A payment can carry a `periods` list tagging it to specific interest_due
    period(s) it covers (the calendar the staff tapped when recording it —
    see _compute_loan_state in gold_loans.py). Since this migration replaces
    every period's identifier (old 'YYYY-MM' strings become the period's own
    start date, e.g. '2025-06-15', and the periods themselves shift), ANY
    PAYMENT ALREADY TAGGED TO A SPECIFIC OLD PERIOD WILL NO LONGER MATCH ANY
    PERIOD AFTER THIS RUNS — it silently falls back into the untagged FIFO
    pool instead (oldest pending period first). The rupee totals (interest
    due, paid, balance) are unaffected either way; only the "was August's
    interest specifically marked received" display-level bookkeeping can
    shift for loans that already have tagged payments. The dry-run report
    below flags every loan that has at least one tagged payment so you can
    see which ones this applies to before deciding to commit.

IDEMPOTENT
    Safe to re-run — each run deletes whatever auto-posted interest_due
    entries currently exist for a loan and regenerates them fresh, so
    re-running after a --commit reproduces the same result (0 delta).

SAFE BY DEFAULT
    Dry-run unless you pass --commit. Dry-run writes NOTHING; it prints the
    old vs new total posted interest for every loan with a nonzero delta,
    flags loans with tagged payments, and a grand total delta across the
    whole loan book so you can see the aggregate impact before applying
    anything.

USAGE (on the server, from backend/ with the venv active)
    python migrations/recalc_gold_loan_interest_30day_periods.py            # dry run
    python migrations/recalc_gold_loan_interest_30day_periods.py --commit   # apply
"""
import asyncio
import os
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / '.env')
except Exception:
    pass


def _month_interest_daywise(principal: float, rate_percent: float, principal_txns: list,
                             period_start: date, period_end: date, loan_date: date) -> float:
    rate = rate_percent / 100 / 30
    total = 0.0
    d = max(period_start, loan_date)
    while d < period_end:
        balance = principal
        for txn_date, amt in principal_txns:
            if txn_date <= d:
                balance -= amt
        total += max(balance, 0) * rate
        d += timedelta(days=1)
    return round(total, 2)


def _new_periods(loan_date: date, end_date: date, principal: float, rate_percent: float, principal_txns: list) -> list:
    """Every 30-day period from loan_date whose due date (its own 30th day)
    has already passed as of end_date — mirrors _backfill_loan_interest."""
    periods = []
    period_start = loan_date
    while True:
        period_end = period_start + timedelta(days=30)
        due_date = period_end - timedelta(days=1)
        if due_date > end_date:
            break
        amount = _month_interest_daywise(principal, rate_percent, principal_txns, period_start, period_end, loan_date)
        if amount > 0:
            periods.append({'period': period_start.isoformat(), 'due_date': due_date.isoformat(), 'amount': amount})
        period_start = period_end
    return periods


async def main(commit: bool):
    mongo_url = os.environ.get('MONGO_URL')
    db_name = os.environ.get('DB_NAME', 'rmj_one')
    if not mongo_url:
        print('ERROR: MONGO_URL is not set in the environment.')
        sys.exit(1)

    db = AsyncIOMotorClient(mongo_url)[db_name]

    touched_loans = 0
    total_delta = 0.0
    tagged_warning_loans = []

    async for loan in db.gold_loans.find({}, {'_id': 0}):
        try:
            loan_date = date.fromisoformat(loan['loan_date'])
        except (ValueError, KeyError):
            continue

        if loan.get('status') == 'closed' and loan.get('closed_at'):
            try:
                end_date = datetime.fromisoformat(loan['closed_at']).date()
            except ValueError:
                end_date = date.today()
        else:
            end_date = date.today()

        txns = await db.gold_loan_transactions.find(
            {'loan_id': loan['id'], 'type': {'$in': ['payment_principal', 'topup_principal', 'interest_due', 'payment_interest']}},
            {'_id': 0},
        ).to_list(5000)

        principal_txns = []
        old_interest_due = []
        has_tagged_payment = False
        for t in txns:
            if t['type'] == 'interest_due':
                old_interest_due.append(t)
                continue
            if t['type'] == 'payment_interest':
                if t.get('periods'):
                    has_tagged_payment = True
                continue
            try:
                amt = t['amount'] if t['type'] == 'payment_principal' else -t['amount']
                principal_txns.append((date.fromisoformat(t['date']), amt))
            except (ValueError, KeyError):
                continue

        old_total = round(sum(float(t.get('amount') or 0) for t in old_interest_due), 2)
        new_periods = _new_periods(loan_date, end_date, loan['principal'], loan['interest_rate_percent'], principal_txns)
        new_total = round(sum(p['amount'] for p in new_periods), 2)
        delta = round(new_total - old_total, 2)

        if delta == 0 and len(old_interest_due) == len(new_periods):
            continue  # already matches — nothing to do for this loan

        flag = '  [HAS TAGGED PAYMENTS — see docstring]' if has_tagged_payment else ''
        print(f"{loan['loan_no']:<10} {loan['customer_name']:<24} "
              f"old {len(old_interest_due)} period(s)={old_total:>10.2f}  "
              f"new {len(new_periods)} period(s)={new_total:>10.2f}  (delta {delta:+.2f}){flag}")
        if has_tagged_payment:
            tagged_warning_loans.append(loan['loan_no'])
        touched_loans += 1
        total_delta += delta

        if commit:
            old_ids = [t['id'] for t in old_interest_due]
            if old_ids:
                await db.gold_loan_transactions.delete_many({'id': {'$in': old_ids}})
            await db.gold_loan_interest_generations.delete_many({'loan_id': loan['id']})
            now_iso = datetime.now(timezone.utc).isoformat()
            for p in new_periods:
                await db.gold_loan_transactions.insert_one({
                    'id': str(uuid.uuid4()), 'loan_id': loan['id'], 'type': 'interest_due', 'period': p['period'],
                    'amount': p['amount'], 'date': p['due_date'],
                    'note': f"Interest for {p['period']} to {p['due_date']}",
                    'auto': True, 'created_by': 'system', 'created_by_id': None, 'created_at': now_iso,
                })
                await db.gold_loan_interest_generations.update_one(
                    {'loan_id': loan['id'], 'period': p['period']},
                    {'$set': {'loan_id': loan['id'], 'period': p['period'], 'created_at': now_iso}},
                    upsert=True,
                )

    print(f'\n{touched_loans} loan{"" if touched_loans == 1 else "s"} '
          f'{"re-periodized" if commit else "would be re-periodized"} — total delta {total_delta:+.2f}.')
    if tagged_warning_loans:
        print(f'{len(tagged_warning_loans)} of those have interest payments already tagged to specific periods '
              f'(periods tagged before this run) — their period tags will stop matching and fall back to '
              f'untagged FIFO matching. Rupee totals are unaffected. Loans: {", ".join(tagged_warning_loans)}')
    if not commit:
        print('Dry run only — no changes written. Re-run with --commit to apply.')


if __name__ == '__main__':
    asyncio.run(main(commit='--commit' in sys.argv))
