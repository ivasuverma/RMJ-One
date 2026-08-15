"""Read-only report of every attendance event that came in through a
biometric device (source == 'biometric'), grouped by employee and date.

Purpose: after fixing the .aspx routing bug (commit 4676b6d) and the
one-time all-time ATTLOG backfill (dda2414 -> narrowed in 58d5f68), the
device dumped its stored punch history going back to March 2026. Those
punches were written as real attendance check-in/check-out records. This
script exists purely so you can eyeball what got created/touched before
trusting any already-run payroll for those months — it makes NO writes.

For each employee+date touched by a biometric punch, it shows:
  - the check_in/check_out timestamps and whether each came from the
    device or the app (mixed = one biometric, one manual — worth a look)
  - the resulting status (present/half_day) currently stored

Run directly on RMJServer with the backend's own venv so it picks up the
same MONGO_URL/DB_NAME from backend/.env:

    E:\\Rmj-One\\backend\\.venv\\Scripts\\python.exe E:\\Rmj-One\\ops\\check_biometric_backfill.py

Optional: pass a cutoff date to only show records on/after it, e.g. to
focus on a specific payroll month:

    ...\\python.exe ops\\check_biometric_backfill.py 2026-03-01
"""
import sys
from pathlib import Path
from collections import defaultdict

from dotenv import load_dotenv
import os

ROOT_DIR = Path(__file__).resolve().parent.parent / 'backend'
load_dotenv(ROOT_DIR / '.env')

from pymongo import MongoClient  # noqa: E402

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']

cutoff = sys.argv[1] if len(sys.argv) > 1 else None

client = MongoClient(MONGO_URL)
db = client[DB_NAME]

query = {'source': 'biometric'}
events = list(db.attendance_events.find(query, {'_id': 0}).sort('timestamp', 1))
if cutoff:
    events = [e for e in events if e.get('timestamp', '') >= cutoff]

if not events:
    print('No biometric-sourced attendance_events found' + (f' on/after {cutoff}' if cutoff else '') + '.')
    sys.exit(0)

# Group by (employee_id, date)
by_emp_date = defaultdict(lambda: {'name': '', 'check_in': None, 'check_out': None})
for e in events:
    ts = e.get('timestamp', '')
    date = ts[:10]
    key = (e.get('employee_id'), date)
    by_emp_date[key]['name'] = e.get('employee_name', '')
    by_emp_date[key][e.get('type')] = ts

print(f"{len(events)} biometric events across {len(by_emp_date)} employee-days\n")
print(f"{'Date':<12} {'Employee':<24} {'Check-in (device)':<22} {'Check-out (device)':<22} {'Stored status':<12} Note")
print('-' * 110)

for (emp_id, date), info in sorted(by_emp_date.items(), key=lambda kv: (kv[0][1], kv[1]['name'])):
    att = db.attendance.find_one({'employee_id': emp_id, 'date': date}, {'_id': 0})
    status = att.get('status', '?') if att else 'MISSING'
    ci_src = (att.get('check_in') or {}).get('source', '') if att else ''
    co_src = (att.get('check_out') or {}).get('source', '') if att else ''
    note = ''
    if att:
        if info['check_in'] and ci_src != 'biometric':
            note = 'check-in in DB not tagged biometric (manual overwrote it?)'
        elif info['check_out'] and co_src != 'biometric':
            note = 'check-out in DB not tagged biometric (manual overwrote it?)'
    else:
        note = 'no attendance doc at all — event logged but record missing?'
    print(f"{date:<12} {info['name']:<24} {(info['check_in'] or '-'):<22} {(info['check_out'] or '-'):<22} {status:<12} {note}")

print('\nDone. This is read-only — nothing was changed.')
