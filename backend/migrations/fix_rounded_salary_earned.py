r"""One-time fix: correct already-posted `salary_earned` timeline entries for
months paid while round_net_salary was on.

WHAT IT DOES
    _upsert_salary_earned() used to post the raw `earned` figure, not
    accounting for the round-to-nearest-10 adjustment applied to the final
    net_salary. salary_paid correctly reflects the rounded amount, so a
    fully-paid month left a small (up to +/-5) residual in the wage ledger
    instead of netting to zero. That's fixed going forward (see payroll.py),
    but PAID months are protected from the normal regenerate path and won't
    self-heal, so already-posted salary_earned entries for paid months stay
    wrong until corrected here.

    For every `salary_earned` timeline entry whose (employee_id, year, month)
    matches a PAID payroll_entries row, sets amount = earned + (net_salary -
    net_salary_exact) — the same formula the fixed code now uses.

IDEMPOTENT
    Recomputes and overwrites the amount every run — safe to re-run.

SAFE BY DEFAULT
    Dry-run unless you pass --commit. Dry-run writes NOTHING; it prints the
    old vs new amount for every entry it would touch.

USAGE (on the server, from backend/ with the venv active)
    python migrations/fix_rounded_salary_earned.py            # dry run
    python migrations/fix_rounded_salary_earned.py --commit   # apply
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
    emp_by_id = {e['id']: e async for e in db.employees.find({}, {'_id': 0})}

    touched = 0
    async for pe in db.payroll_entries.find({'paid': True}, {'_id': 0}):
        exact = float(pe.get('net_salary_exact') or 0)
        rounded = float(pe.get('net_salary') or 0)
        delta = round(rounded - exact, 2)
        if delta == 0:
            continue  # nothing to fix for this month/employee
        se = await db.timeline.find_one(
            {'employee_id': pe['employee_id'], 'type': 'salary_earned', 'year': pe['year'], 'month': pe['month']},
            {'_id': 0, 'id': 1, 'amount': 1},
        )
        if not se:
            continue
        old_amount = float(se.get('amount') or 0)
        new_amount = round(old_amount + delta, 2)
        if old_amount == new_amount:
            continue
        name = emp_by_id.get(pe['employee_id'], {}).get('name', '?')
        print(f"{pe['year']}-{pe['month']:02d} {name:<22} old={old_amount:>10} new={new_amount:>10} (delta {delta:+.2f})")
        touched += 1
        if commit:
            await db.timeline.update_one({'id': se['id']}, {'$set': {'amount': new_amount}})

    print(f'\n{touched} salary_earned entr{"y" if touched == 1 else "ies"} {"corrected" if commit else "would be corrected"}.')
    if not commit:
        print('Dry run only — no changes written. Re-run with --commit to apply.')


if __name__ == '__main__':
    asyncio.run(main(commit='--commit' in sys.argv))
