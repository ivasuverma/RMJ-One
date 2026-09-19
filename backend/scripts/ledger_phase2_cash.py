"""Ledger phase 2 — repair payments into the Cash Book. One-off, idempotent, every entry tagged.

The old "Cash Ledger" (collection cash_ledger) recorded cash taken on repair bills apart from the Cash
Book. From now on the Cash Book is the single cash record, so each historical payment becomes a Cash
Book entry on the repair-payments counter (tagged source=repair, migrated_from_cash_ledger=<id>).

    python scripts/ledger_phase2_cash.py            # dry run: shows the effect on each counter's balance
    python scripts/ledger_phase2_cash.py --apply
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from server import db, IST  # noqa: E402
from routers.repairs import _repair_cash_counter_id  # noqa: E402

APPLY = '--apply' in sys.argv


async def main():
    counter_id = await _repair_cash_counter_id()
    counter = await db.cashbook_counters.find_one({'id': counter_id}, {'_id': 0, 'name': 1})
    print(f'repair payments will land on counter: {counter["name"]}')
    have = {e.get('ref_id') async for e in db.cashbook_entries.find({'source': 'repair'}, {'_id': 0, 'ref_id': 1})}
    rows = await db.cash_ledger.find({}, {'_id': 0}).sort('created_at', 1).to_list(None)
    manual = await db.cashbook_entries.find({'source': {'$ne': 'repair'}, 'type': 'received'}, {'_id': 0, 'date': 1, 'amount': 1, 'name': 1, 'note': 1, 'category': 1}).to_list(None)

    def looks_entered_by_hand(r) -> bool:
        """Staff sometimes also typed the same cash into the Cash Book by hand ("repair 800"). Same amount, within a
        day, and the words 'repair' in it -> probably the same money; don't count it twice."""
        day = datetime.fromisoformat(r['created_at']).astimezone(IST).date()
        for e in manual:
            if abs(e['amount'] - r['amount']) > 0.01 or 'repair' not in f"{e.get('name', '')} {e.get('note', '')} {e.get('category', '')}".lower():
                continue
            try:
                if abs((datetime.fromisoformat(e['date']).date() - day).days) <= 1:
                    return True
            except Exception:
                pass
        return False

    todo, skipped = [], []
    for r in rows:
        if r.get('item_id') in have:
            skipped.append(r)
        elif (r.get('payment_mode') or 'cash') != 'cash':
            skipped.append(r)
        elif looks_entered_by_hand(r):
            print(f"  HELD BACK (looks already entered by hand): {r['created_at'][:10]} ₹{r['amount']:,.2f} {r.get('item_code')} {r.get('customer_name')}")
            skipped.append(r)
        else:
            todo.append(r)
    net = 0.0
    for r in todo:
        sign = 1 if r['type'] == 'receipt' else -1
        net += sign * r['amount']
        print(f"  {r['created_at'][:10]}  {r['type']:8} ₹{r['amount']:>9,.2f}  {r.get('item_code')}  {r.get('customer_name')}")
    print(f'{len(todo)} to move (net ₹{net:,.2f}), {len(skipped)} already in the Cash Book / not cash')
    if not APPLY:
        print('DRY RUN — nothing written. Re-run with --apply.')
        return
    for r in todo:
        when = datetime.fromisoformat(r['created_at']).astimezone(IST).date().isoformat()
        refund = r['type'] == 'refund'
        await db.cashbook_entries.insert_one({
            'id': str(uuid.uuid4()), 'date': when, 'counter_id': counter_id,
            'type': 'paid' if refund else 'received', 'amount': r['amount'],
            'name': (r.get('customer_name') or r.get('item_code') or 'Repair').strip(),
            'category': 'Repair refund' if refund else 'Repair payment', 'note': (f"{r.get('item_code', '')} — {r.get('note', '')}").strip(' —'),
            'created_at': r['created_at'], 'created_by': r.get('created_by'), 'created_by_id': None,
            'linked_entry_id': None, 'transfer_counter_id': None,
            'source': 'repair', 'ref_id': r.get('item_id'), 'item_code': r.get('item_code'), 'migrated_from_cash_ledger': r['id'],
        })
    print(f'APPLIED: {len(todo)} entries added to the Cash Book')


asyncio.run(main())
