r"""One-time fix: remove the duplicate interest_due entries left over from
the ~4 hour window on 2026-09-21 (18:11-22:02 UTC) when a now-reverted
"rolling 30-day block" interest scheme was briefly live in production.

WHY
    That scheme keyed periods by their own ISO start date (e.g. '2026-08-08')
    instead of calendar month ('2026-08'). Its idempotency guard
    (gold_loan_interest_generations) only recognized its own key format, so
    for any active loan whose page got opened (or the 15-min poll ran)
    during that window, it posted a SECOND, erroneous interest_due entry
    covering time already charged by the calendar-month entry — a real
    double charge, confirmed live on GL-0003 (two ₹6,000 entries for the
    same ~30 days: period '2026-08' and period '2026-08-08').

    Every interest_due entry ever posted by any OTHER version of this
    code (before or after that window) uses a 'YYYY-MM' period — exactly
    7 characters. The rolling scheme is the only thing that ever wrote a
    10-character ISO-date period ('YYYY-MM-DD'). So "period length == 10"
    unambiguously identifies an entry from that window; nothing else in
    this codebase, past or present, produces that shape.

WHAT IT DOES
    Finds every interest_due transaction with a 10-character period,
    deletes it and its matching gold_loan_interest_generations guard doc.

    SAFETY CHECK: if any interest PAYMENT (type=payment_interest) on the
    same loan has that exact period in its `periods` list, this entry is
    NOT auto-deleted — it's printed as NEEDS MANUAL REVIEW instead, since
    removing it would silently orphan a real payment with nothing left for
    it to match against. None were expected to exist (the window was only
    ~4 hours and interest payments are collected in person), but the
    script checks rather than assumes.

IDEMPOTENT
    Re-running after a --commit finds nothing left to remove.

SAFE BY DEFAULT
    Dry-run unless you pass --commit. Dry-run deletes NOTHING; it prints
    every entry it would remove (loan, period, amount, date) plus the
    total rupee amount that would come off each loan's interest_due, so
    you can review before applying.

USAGE (on the server, from backend/ with the venv active)
    python migrations/remove_duplicate_gold_loan_interest.py            # dry run
    python migrations/remove_duplicate_gold_loan_interest.py --commit   # apply
"""
import asyncio
import os
import sys
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / '.env')
except Exception:
    pass


async def main(commit: bool):
    mongo_url = os.environ.get('MONGO_URL')
    db_name = os.environ.get('DB_NAME', 'rmj_one')
    if not mongo_url:
        print('ERROR: MONGO_URL is not set in the environment.')
        sys.exit(1)

    db = AsyncIOMotorClient(mongo_url)[db_name]

    bad_entries = await db.gold_loan_transactions.find(
        {'type': 'interest_due'}, {'_id': 0},
    ).to_list(20000)
    bad_entries = [e for e in bad_entries if len(str(e.get('period') or '')) == 10]

    if not bad_entries:
        print('No duplicate (ISO-date-keyed) interest_due entries found. Nothing to do.')
        return

    removed = 0
    review = 0
    total_amount = 0.0
    for entry in sorted(bad_entries, key=lambda e: (e['loan_id'], e.get('period') or '')):
        loan = await db.gold_loans.find_one({'id': entry['loan_id']}, {'_id': 0})
        label = f"{loan['loan_no']:<10} {loan['customer_name']:<24}" if loan else f"(unknown loan {entry['loan_id']})"

        clashing_payment = await db.gold_loan_transactions.find_one(
            {'loan_id': entry['loan_id'], 'type': 'payment_interest', 'periods': entry.get('period')}, {'_id': 0},
        )
        if clashing_payment:
            print(f"NEEDS MANUAL REVIEW — {label} period={entry['period']} amount={entry['amount']} "
                  f"has a payment (id={clashing_payment['id']}) tagged to this period — not auto-removing.")
            review += 1
            continue

        print(f"{label} period={entry['period']}  amount={entry['amount']:>10.2f}  "
              f"date={entry['date']}  {'removed' if commit else 'would be removed'}")
        removed += 1
        total_amount += float(entry['amount'] or 0)
        if commit:
            await db.gold_loan_transactions.delete_one({'id': entry['id']})
            await db.gold_loan_interest_generations.delete_one(
                {'loan_id': entry['loan_id'], 'period': entry['period']},
            )

    print(f"\n{removed} duplicate entr{'y' if removed == 1 else 'ies'} "
          f"{'removed' if commit else 'would be removed'} — total {total_amount:.2f} "
          f"{'taken off' if commit else 'would come off'} interest_due across the loan book.")
    if review:
        print(f'{review} entr{"y" if review == 1 else "ies"} skipped — needs manual review (see above).')
    if not commit:
        print('Dry run only — no changes written. Re-run with --commit to apply.')


if __name__ == '__main__':
    asyncio.run(main(commit='--commit' in sys.argv))
