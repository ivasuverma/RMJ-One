"""Ledger phase 1 — make the numbers true (data only). Idempotent; every record it touches is tagged.

  1. Metal-ledger backfill: every karigar_ledger gold movement (gold_out / gold_in / loss) must have
     its counter-entry on metal_ledger (the shop's own gold). Movements from before the Metal Ledger
     existed have none. Adds them, tagged `backfill: true`.
  2. Fine-weight backfill: gold_out / gold_in entries with no fine_weight were counted as if fine ==
     gross. Where the entry is linked to a repair item / sample with a purity, fine = weight x purity/100
     (tagged `fine_backfilled: true`, original left as null). Entries with no purity to go on are listed.

    python scripts/ledger_phase1.py            # dry run: report only
    python scripts/ledger_phase1.py --apply
"""
import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from server import db, now_utc  # noqa: E402

APPLY = '--apply' in sys.argv
MIRROR = {'gold_out': 'out', 'gold_in': 'in', 'loss': 'loss'}


async def purity_for(item_id):
    if not item_id:
        return None
    for coll in ('repair_items', 'samples'):
        d = await db[coll].find_one({'id': item_id}, {'_id': 0, 'purity': 1})
        if d and d.get('purity'):
            return float(d['purity'])
    return None


async def main():
    karigars = {k['id']: k['name'] async for k in db.karigars.find({}, {'_id': 0, 'id': 1, 'name': 1})}
    entries = await db.karigar_ledger.find({'type': {'$in': list(MIRROR)}}, {'_id': 0}).to_list(None)
    have = {m.get('source_entry_id') async for m in db.metal_ledger.find({}, {'_id': 0, 'source_entry_id': 1})}

    # ---- 2. fine weight first, so the metal entries below carry the right movement ----
    derive, unresolved = [], []
    for e in entries:
        if e['type'] in ('gold_out', 'gold_in') and e.get('fine_weight') is None:
            p = await purity_for(e.get('item_id'))
            if p and e.get('weight'):
                derive.append((e, round(e['weight'] * p / 100.0, 3), p))
            else:
                unresolved.append(e)
    print(f'fine weight missing: {len(derive) + len(unresolved)}  -> derivable from purity: {len(derive)}, no purity to go on: {len(unresolved)}')
    for e, fine, p in derive[:5]:
        print(f'   e.g. {e["created_at"][:10]} {e["type"]} {e["weight"]} g x {p}% -> fine {fine} g')
    if unresolved:
        print('   unresolved:', [(e['created_at'][:10], e['type'], e.get('weight'), karigars.get(e['karigar_id'])) for e in unresolved][:10])

    # ---- 1. metal backfill ----
    missing = [e for e in entries if e['id'] not in have]
    tot = {t: round(sum(e.get('weight') or 0 for e in missing if e['type'] == t), 3) for t in MIRROR}
    print(f'metal counters missing: {len(missing)}  weights: {tot}')

    if not APPLY:
        print('DRY RUN — nothing written. Re-run with --apply.')
        return
    n_fine = 0
    for e, fine, p in derive:
        await db.karigar_ledger.update_one({'id': e['id']}, {'$set': {
            'fine_weight': fine, 'fine_backfilled': True, 'fine_backfill_note': f'weight x {p}% (item purity)'}})
        n_fine += 1
    n_metal = 0
    for e in missing:
        await db.metal_ledger.insert_one({
            'id': str(uuid.uuid4()), 'type': MIRROR[e['type']], 'weight': e.get('weight') or 0, 'karigar_id': e.get('karigar_id'),
            'karigar_name': e.get('karigar_name') or karigars.get(e.get('karigar_id'), ''), 'item_id': e.get('item_id'),
            'item_code': e.get('item_code'), 'txn_id': e.get('txn_id'), 'source_entry_id': e['id'], 'note': e.get('note') or '',
            'created_at': e.get('created_at') or now_utc().isoformat(), 'created_by': e.get('created_by'),
            'backfill': True, 'backfilled_at': now_utc().isoformat(),
        })
        n_metal += 1
    print(f'APPLIED: fine weight set on {n_fine} entries, {n_metal} metal-ledger entries added')


asyncio.run(main())
