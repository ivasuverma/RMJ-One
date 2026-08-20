"""One-time migration: bring Customers and Karigars into the Unified Ledger.

WHAT IT DOES
    Creates one unified `accounts` row per existing customer and per existing
    karigar, so every party lives in the single ledger (filterable by type)
    instead of separate customer/karigar directories.

    - Karigar  -> account of type "karigar", carrying the karigar's CURRENT
                  balance as its opening position:
                      opening_fine   =  fine_bal      (gold the karigar holds
                                        for the shop; +ve = owed TO the shop)
                      opening_amount = -amt_due       (SIGN FLIP: amt_due +ve
                                        means the shop owes the karigar, which
                                        is NEGATIVE in the unified convention)
    - Customer -> account of type "customer", opening 0 / 0. A customer's
                  position is gold-held-against-open-repairs, which is derived
                  live from the repairs module and would double-count if frozen
                  as an opening balance — so only their identity is migrated.

    Sign conventions come straight from server.py::_karigar_ledger_balances and
    ledger.py's module docstring — read both before trusting the numbers.

IDEMPOTENT
    Each created account is stamped with `source = {kind, ref}`. Re-running
    skips any party already migrated, so it is safe to run more than once.

SAFE BY DEFAULT
    Dry-run unless you pass --commit. Dry-run writes NOTHING; it prints exactly
    what would be created plus every collision / missing-mobile warning so you
    can eyeball the balances against the live app first.

USAGE (on the server, from backend/ with the venv active)
    python migrations/merge_parties_into_ledger.py            # dry run
    python migrations/merge_parties_into_ledger.py --commit   # apply

    Reads MONGO_URL / DB_NAME from the environment (same as the backend). If
    they are in backend/.env, load them first, e.g. on PowerShell:
        Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*)$'){ [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim()) } }
"""
import asyncio
import os
import re
import sys
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_phone(phone: str) -> str:
    return re.sub(r'\D', '', phone or '')


def karigar_balances(entries: list) -> dict:
    """Verbatim copy of server.py::_karigar_ledger_balances so this script is
    self-contained and cannot drift from a partial import. Sign: amt_due +ve =
    shop owes the karigar; fine_bal +ve = karigar holds that much fine gold."""
    bal: dict = {}
    for e in entries:
        kid = e.get('karigar_id')
        if not kid:
            continue
        b = bal.setdefault(kid, {'weight_bal': 0.0, 'fine_bal': 0.0, 'amt_due': 0.0})
        t = e.get('type')
        if t == 'gold_out':
            b['weight_bal'] += e.get('weight') or 0
            b['fine_bal'] += e.get('fine_weight') if e.get('fine_weight') is not None else (e.get('weight') or 0)
        elif t == 'gold_in':
            b['weight_bal'] -= e.get('weight') or 0
            b['fine_bal'] -= e.get('fine_weight') if e.get('fine_weight') is not None else (e.get('weight') or 0)
        elif t == 'labour_payable':
            b['amt_due'] += e.get('amount') or 0
        elif t == 'payment':
            b['amt_due'] -= e.get('amount') or 0
        elif t == 'receipt':
            b['amt_due'] += e.get('amount') or 0
        elif t in ('wastage', 'adjustment'):
            b['amt_due'] += e.get('amount') or 0
    return bal


async def main(commit: bool):
    mongo_url = os.environ.get('MONGO_URL')
    db_name = os.environ.get('DB_NAME', 'rmj_one')
    if not mongo_url:
        print('ERROR: MONGO_URL is not set in the environment.')
        sys.exit(1)

    db = AsyncIOMotorClient(mongo_url)[db_name]

    types = await db.account_types.find({}, {'_id': 0}).to_list(50)
    type_by_key = {t.get('key'): t['id'] for t in types}
    cust_type = type_by_key.get('customer')
    kar_type = type_by_key.get('karigar')
    if not cust_type or not kar_type:
        print('ERROR: customer/karigar account types not found. Start the backend once to seed them.')
        sys.exit(1)

    # Already-migrated refs, so re-running is a no-op for those.
    done = {'customer': set(), 'karigar': set()}
    async for a in db.accounts.find({'source': {'$exists': True}}, {'_id': 0, 'source': 1}):
        src = a.get('source') or {}
        if src.get('kind') in done and src.get('ref'):
            done[src['kind']].add(src['ref'])

    # For collision reporting against accounts that already exist.
    existing_names = set()
    existing_phones = set()
    async for a in db.accounts.find({}, {'_id': 0, 'name': 1, 'phone': 1}):
        existing_names.add((a.get('name') or '').strip().lower())
        p = _norm_phone(a.get('phone', ''))
        if p:
            existing_phones.add(p)

    planned = []           # docs to insert
    warn_no_mobile = []    # (kind, name)
    warn_collision = []    # (kind, name, why)

    seen_names = set(existing_names)
    seen_phones = set(existing_phones)

    def plan(kind, ref, name, phone, opening_fine, opening_amount):
        nm = (name or '').strip()
        ph = _norm_phone(phone)
        if not ph:
            warn_no_mobile.append((kind, nm))
        why = []
        if nm.lower() in seen_names:
            why.append('name')
        if ph and ph in seen_phones:
            why.append('mobile')
        if why:
            warn_collision.append((kind, nm, '+'.join(why)))
        seen_names.add(nm.lower())
        if ph:
            seen_phones.add(ph)
        planned.append({
            'id': str(uuid.uuid4()),
            'type_id': cust_type if kind == 'customer' else kar_type,
            'name': nm,
            'phone': (phone or '').strip(),
            'opening_fine': round(opening_fine, 3),
            'opening_amount': round(opening_amount, 2),
            'note': '',
            'active': True,
            'created_at': _now_iso(),
            'created_by': 'migration',
            'source': {'kind': kind, 'ref': ref},
        })

    # ---- Karigars (with balances) ----
    kar_entries = await db.karigar_ledger.find({}, {'_id': 0, 'karigar_id': 1, 'type': 1, 'weight': 1, 'fine_weight': 1, 'amount': 1}).to_list(100000)
    kbal = karigar_balances(kar_entries)
    karigars = await db.karigars.find({}, {'_id': 0}).to_list(5000)
    for k in karigars:
        if k['id'] in done['karigar']:
            continue
        b = kbal.get(k['id'], {})
        plan('karigar', k['id'], k.get('name', ''), k.get('mobile', ''),
             round(b.get('fine_bal', 0.0), 3), round(-b.get('amt_due', 0.0), 2))

    # ---- Customers (identity only) ----
    customers = await db.customers.find({}, {'_id': 0}).to_list(20000)
    for c in customers:
        if c['id'] in done['customer']:
            continue
        plan('customer', c['id'], c.get('name', ''), c.get('mobile', ''), 0.0, 0.0)

    # ---- Report ----
    n_kar = sum(1 for p in planned if p['source']['kind'] == 'karigar')
    n_cust = sum(1 for p in planned if p['source']['kind'] == 'customer')
    print('=' * 64)
    print(f'  Merge Customers + Karigars into Unified Ledger  ({"COMMIT" if commit else "DRY RUN"})')
    print('=' * 64)
    print(f'  Already migrated : {len(done["karigar"])} karigars, {len(done["customer"])} customers')
    print(f'  To create        : {n_kar} karigars, {n_cust} customers  (total {len(planned)})')
    print()
    print('  Sample (first 12):')
    for p in planned[:12]:
        print(f'    [{p["source"]["kind"]:8}] {p["name"][:26]:26}  fine {p["opening_fine"]:>10.3f} g   ₹ {p["opening_amount"]:>12,.2f}   mob {p["phone"] or "—"}')
    if warn_no_mobile:
        print()
        print(f'  ⚠ {len(warn_no_mobile)} party(ies) have NO mobile number (allowed for migrated legacy data, but they will fail the new "mobile required" rule if edited):')
        for kind, nm in warn_no_mobile[:20]:
            print(f'      [{kind}] {nm}')
    if warn_collision:
        print()
        print(f'  ⚠ {len(warn_collision)} name/mobile collision(s) — same identity as an existing or another migrated account (kept separate; review these):')
        for kind, nm, why in warn_collision[:30]:
            print(f'      [{kind}] {nm}  (duplicate {why})')
    print()

    if not commit:
        print('  DRY RUN — nothing written. Re-run with --commit to apply.')
        return

    if not planned:
        print('  Nothing to insert.')
        return
    await db.accounts.insert_many(planned)
    print(f'  ✓ Inserted {len(planned)} accounts into the unified ledger.')


if __name__ == '__main__':
    asyncio.run(main('--commit' in sys.argv))
