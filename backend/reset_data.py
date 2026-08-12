"""
One-time data reset: wipes all transactional/activity data (attendance,
ledger entries, payroll history, leaves, corrections, biometric logs, etc.)
while keeping the Employee roster and login accounts intact, so the app can
"start fresh" without re-entering staff.

KEPT untouched:
    employees              - full employee roster (name, code, salary, shift, etc.)
    users                  - owner / admin / accountant login accounts
    shifts, holidays, settings, biometric_devices - store configuration
    push_subscriptions     - device notification registrations
    timeline                - ONLY entries of type 'joined' are kept (each
                              employee's "Joined RMJ" milestone); every other
                              timeline entry (advance/bonus/fine/deduction/
                              salary/salary_revised) is deleted.

WIPED completely:
    attendance, attendance_events, attendance_reminders, leaves, corrections,
    payroll_entries, payroll_payments, payroll_locks, audit_logs,
    absentee_summaries, auto_advances, biometric_logs, assistant_history

Run this ON the server (same machine/venv as the backend, so it picks up the
same .env / MONGO_URL). It always does a DRY RUN first and shows counts;
nothing is deleted until you type the confirmation phrase.

Usage:
    python reset_data.py
"""
from pathlib import Path
from dotenv import load_dotenv
import os
from pymongo import MongoClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']

# Collections deleted in full.
WIPE_COLLECTIONS = [
    'attendance',
    'attendance_events',
    'attendance_reminders',
    'leaves',
    'corrections',
    'payroll_entries',
    'payroll_payments',
    'payroll_locks',
    'audit_logs',
    'absentee_summaries',
    'auto_advances',
    'biometric_logs',
    'assistant_history',
]

# Collections left completely alone.
KEEP_COLLECTIONS = ['employees', 'users', 'shifts', 'holidays', 'settings', 'biometric_devices', 'push_subscriptions']

# timeline is special-cased: keep only the 'joined' milestone entries.
TIMELINE_WIPE_FILTER = {'type': {'$ne': 'joined'}}


def main():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]

    print(f'Connected to database: {DB_NAME}\n')
    print('=== DRY RUN — nothing has been deleted yet ===\n')

    plan = []
    total = 0
    for name in WIPE_COLLECTIONS:
        count = db[name].count_documents({})
        plan.append((name, {}, count))
        total += count
        print(f'  {name:<24} {count:>6} document(s) would be deleted')

    tl_count = db.timeline.count_documents(TIMELINE_WIPE_FILTER)
    tl_keep = db.timeline.count_documents({'type': 'joined'})
    plan.append(('timeline', TIMELINE_WIPE_FILTER, tl_count))
    total += tl_count
    print(f'  {"timeline":<24} {tl_count:>6} document(s) would be deleted  ({tl_keep} "joined" entries kept)')

    print(f'\n  TOTAL: {total} documents across {len(plan)} collections\n')

    print('Kept untouched: ' + ', '.join(KEEP_COLLECTIONS) + ', timeline (joined entries only)\n')

    print('This cannot be undone. Type RESET to proceed, anything else to abort.')
    answer = input('> ').strip()
    if answer != 'RESET':
        print('Aborted. No changes made.')
        return

    print('\nDeleting...')
    grand_total = 0
    for name, flt, _ in plan:
        result = db[name].delete_many(flt)
        grand_total += result.deleted_count
        print(f'  {name:<24} deleted {result.deleted_count}')

    print(f'\nDone. {grand_total} documents deleted. Employees, logins, and store configuration were left untouched.')


if __name__ == '__main__':
    main()
