r"""One-time fix: recompute every already-posted gold loan interest_due
transaction using day-wise proration instead of the old day-15 cutoff
approximation (see routers/gold_loans.py's _month_interest_daywise).

WHAT IT DOES
    For every gold_loans loan (active or closed), walks its existing
    interest_due transactions and recomputes each one's amount the same
    way _backfill_loan_interest now does going forward: daily rate =
    monthly rate / 30, applied to the exact balance on each day of that
    period (a repayment or top-up takes effect the day it's dated, and a
    loan's first month is prorated from its actual loan_date instead of
    snapping to a day-15 either/or).

    Only interest_due entries are touched — payments, top-ups, and every
    other transaction type are left exactly as they are. For a CLOSED
    loan this only corrects the historical record of what was owed; it
    does not reopen the loan or change what the customer already paid,
    so a closed loan can end up showing interest_paid different from the
    (recalculated) interest_due for some period — that's an expected,
    harmless artifact of correcting history after the fact, not a bug.

IDEMPOTENT
    Recomputes and overwrites the amount every run — safe to re-run.

SAFE BY DEFAULT
    Dry-run unless you pass --commit. Dry-run writes NOTHING; it prints
    the old vs new amount for every entry it would touch, plus a total
    rupee delta across the whole loan book so you can see the aggregate
    impact before applying anything.

USAGE (on the server, from backend/ with the venv active)
    python migrations/recalc_gold_loan_interest_daywise.py            # dry run
    python migrations/recalc_gold_loan_interest_daywise.py --commit   # apply
"""
import asyncio
import os
import sys
from datetime import date, timedelta
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / '.env')
except Exception:
    pass


def _add_month(y: int, m: int) -> tuple:
    m += 1
    if m > 12:
        return y + 1, 1
    return y, m


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


async def main(commit: bool):
    mongo_url = os.environ.get('MONGO_URL')
    db_name = os.environ.get('DB_NAME', 'rmj_one')
    if not mongo_url:
        print('ERROR: MONGO_URL is not set in the environment.')
        sys.exit(1)

    db = AsyncIOMotorClient(mongo_url)[db_name]

    touched_entries = 0
    touched_loans = 0
    total_delta = 0.0

    async for loan in db.gold_loans.find({}, {'_id': 0}):
        try:
            loan_date = date.fromisoformat(loan['loan_date'])
        except (ValueError, KeyError):
            continue

        txns = await db.gold_loan_transactions.find(
            {'loan_id': loan['id'], 'type': {'$in': ['payment_principal', 'topup_principal', 'interest_due']}},
            {'_id': 0},
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

        loan_touched = False
        for entry in sorted(interest_due, key=lambda e: e.get('period') or ''):
            period = entry.get('period')
            if not period:
                continue
            try:
                y, m = int(period[:4]), int(period[5:7])
            except (ValueError, IndexError):
                continue
            period_start = date(y, m, 1)
            next_y, next_m = _add_month(y, m)
            period_end = date(next_y, next_m, 1)

            new_amount = _month_interest_daywise(
                loan['principal'], loan['interest_rate_percent'], principal_txns, period_start, period_end, loan_date,
            )
            old_amount = round(float(entry.get('amount') or 0), 2)
            if old_amount == new_amount:
                continue
            delta = round(new_amount - old_amount, 2)
            print(f"{loan['loan_no']:<10} {loan['customer_name']:<24} {period}  "
                  f"old={old_amount:>10.2f}  new={new_amount:>10.2f}  (delta {delta:+.2f})")
            touched_entries += 1
            total_delta += delta
            loan_touched = True
            if commit:
                await db.gold_loan_transactions.update_one({'id': entry['id']}, {'$set': {'amount': new_amount}})
        if loan_touched:
            touched_loans += 1

    print(f'\n{touched_entries} interest entr{"y" if touched_entries == 1 else "ies"} across '
          f'{touched_loans} loan{"" if touched_loans == 1 else "s"} '
          f'{"corrected" if commit else "would be corrected"} — total delta {total_delta:+.2f}.')
    if not commit:
        print('Dry run only — no changes written. Re-run with --commit to apply.')


if __name__ == '__main__':
    asyncio.run(main(commit='--commit' in sys.argv))
