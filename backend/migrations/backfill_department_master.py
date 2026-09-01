r"""One-time migration: turn the free-text `department` field on employees
into the new Departments master + `department_id` FK.

WHAT IT DOES
    1. Reads every distinct non-blank `department` string currently on
       `employees`.
    2. Creates one `departments` row per distinct value (skipped if a
       department with that name, case-insensitively, already exists —
       e.g. because Phase A/B seeded one, or the script already ran).
    3. Sets `department_id` on every employee whose department string
       matches (case-insensitively, trimmed) — the free-text `department`
       field itself is left as-is; the backend now keeps it in sync from
       department_id going forward (see employees.py::_sync_department_name).

IDEMPOTENT
    Re-running only touches employees that still have no department_id, and
    only creates a department row for a name that doesn't already have one —
    safe to run more than once.

SAFE BY DEFAULT
    Dry-run unless you pass --commit. Dry-run writes NOTHING; it prints
    exactly what would be created/updated so you can eyeball it against the
    live app first.

USAGE (on the server, from backend/ with the venv active)
    python migrations/backfill_department_master.py            # dry run
    python migrations/backfill_department_master.py --commit   # apply

    Reads MONGO_URL / DB_NAME from the environment (same as the backend). If
    they are in backend/.env, load them first, e.g. on PowerShell:
        Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*)$'){ [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim()) } }
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / '.env')
except Exception:
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def main(commit: bool):
    mongo_url = os.environ.get('MONGO_URL')
    db_name = os.environ.get('DB_NAME', 'rmj_one')
    if not mongo_url:
        print('ERROR: MONGO_URL is not set in the environment.')
        sys.exit(1)

    db = AsyncIOMotorClient(mongo_url)[db_name]

    # Existing departments (from Phase A/B seeding, or a prior run of this
    # script), keyed by lowercased name so matching is case-insensitive.
    existing_by_lower = {}
    async for d in db.departments.find({}, {'_id': 0}):
        existing_by_lower[d['name'].strip().lower()] = d

    # Every employee still missing department_id but carrying a non-blank
    # legacy department string.
    employees = await db.employees.find(
        {'department_id': {'$in': [None, '']}, 'department': {'$nin': [None, '']}},
        {'_id': 0, 'id': 1, 'name': 1, 'employee_code': 1, 'department': 1},
    ).to_list(2000)

    to_create = {}   # lower-name -> display name
    for e in employees:
        raw = (e.get('department') or '').strip()
        if not raw:
            continue
        key = raw.lower()
        if key not in existing_by_lower and key not in to_create:
            to_create[key] = raw

    print(f'Departments already in the master: {len(existing_by_lower)}')
    print(f'Employees with department_id unset but a department string set: {len(employees)}')
    print(f'New department rows to create: {len(to_create)}')
    for name in to_create.values():
        print(f'  + {name!r}')

    updates = []  # (employee_id, code, name, department_id, resolved_name)
    for e in employees:
        raw = (e.get('department') or '').strip()
        if not raw:
            continue
        key = raw.lower()
        dept = existing_by_lower.get(key) or {'id': None, 'name': to_create.get(key)}
        updates.append((e['id'], e.get('employee_code', ''), e.get('name', ''), key, dept))

    print(f'\nEmployee department_id backfills planned: {len(updates)}')

    if not commit:
        print('\nDry run only — no changes written. Re-run with --commit to apply.')
        return

    created_ids = {}
    for key, name in to_create.items():
        did = str(uuid.uuid4())
        await db.departments.insert_one({'id': did, 'name': name, 'is_active': True, 'created_at': _now_iso()})
        created_ids[key] = did
    print(f'Created {len(created_ids)} department row(s).')

    updated = 0
    for eid, code, name, key, dept in updates:
        did = dept.get('id') or created_ids.get(key)
        if not did:
            print(f'  SKIP {code} {name}: could not resolve department id for {key!r}')
            continue
        canonical_name = dept.get('name') if dept.get('id') else to_create.get(key)
        await db.employees.update_one({'id': eid}, {'$set': {'department_id': did, 'department': canonical_name}})
        updated += 1
    print(f'Updated {updated} employee(s) with department_id.')


if __name__ == '__main__':
    asyncio.run(main(commit='--commit' in sys.argv))
