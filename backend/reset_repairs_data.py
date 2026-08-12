"""
One-off maintenance script: wipes all Repairs module TRANSACTIONAL data so
tag/order numbering restarts from scratch, and clears karigar ledger balances.

Deletes ALL documents in:
  - repair_orders
  - repair_items
  - karigar_transactions
  - karigar_ledger

Leaves everything else untouched, including:
  - customers        (customer master records / names / mobiles)
  - karigars          (karigar master records / names / mobiles)
  - employees, users, attendance, payroll, tasks, etc.

Order numbers (RO-0001...) and tag codes (R-000001...) are derived from
count_documents() at creation time, so once repair_orders/repair_items are
empty, the very next intake will start again at RO-0001 / R-000001.

This is IRREVERSIBLE. Run it from the backend folder on the server where
.env (MONGO_URL / DB_NAME) points at your live database:

    cd backend
    python3 reset_repairs_data.py

You will be asked to type DELETE to confirm before anything is removed.
"""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']

COLLECTIONS_TO_WIPE = ['repair_orders', 'repair_items', 'karigar_transactions', 'karigar_ledger']


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    print(f"Connecting to database '{DB_NAME}' ...")
    print()
    print("Current document counts:")
    counts_before = {}
    for name in COLLECTIONS_TO_WIPE:
        n = await db[name].count_documents({})
        counts_before[name] = n
        print(f"  {name}: {n}")
    print()
    print("Customers and Karigars master records will NOT be touched.")
    print()

    if sum(counts_before.values()) == 0:
        print("Nothing to delete — all target collections are already empty.")
        client.close()
        return

    confirm = input("Type DELETE (all caps) to permanently wipe the collections above: ").strip()
    if confirm != 'DELETE':
        print("Aborted — nothing was deleted.")
        client.close()
        return

    print()
    for name in COLLECTIONS_TO_WIPE:
        result = await db[name].delete_many({})
        print(f"  Deleted {result.deleted_count} document(s) from {name}")

    print()
    print("Done. Repair order/tag numbering will restart at RO-0001 / R-000001")
    print("on the next intake, and all karigar balances are now zero.")
    client.close()


if __name__ == '__main__':
    asyncio.run(main())
