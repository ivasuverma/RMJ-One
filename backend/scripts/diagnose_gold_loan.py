r"""Read-only diagnostic: dumps a single gold loan's raw stored record plus
every transaction and interest-generation guard doc tied to it, so we can
see exactly what's in the database for a loan that looks wrong on screen.

WRITES NOTHING. Pure db.find(), no update/delete/insert calls anywhere.

USAGE (from backend/, with the venv active)
    python scripts/diagnose_gold_loan.py GL-0003
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


async def main(loan_no: str):
    mongo_url = os.environ.get('MONGO_URL')
    db_name = os.environ.get('DB_NAME', 'rmj_one')
    if not mongo_url:
        print('ERROR: MONGO_URL is not set in the environment.')
        sys.exit(1)

    db = AsyncIOMotorClient(mongo_url)[db_name]

    loan = await db.gold_loans.find_one({'loan_no': loan_no}, {'_id': 0})
    if not loan:
        print(f'No loan found with loan_no={loan_no!r}')
        return
    print('=== gold_loans doc ===')
    for k, v in loan.items():
        print(f'  {k}: {v!r}')

    print(f"\n=== gold_loan_transactions for loan_id={loan['id']} (all types, sorted by created_at) ===")
    txns = await db.gold_loan_transactions.find({'loan_id': loan['id']}, {'_id': 0}) \
        .sort('created_at', 1).to_list(5000)
    print(f'  {len(txns)} transaction(s):')
    for t in txns:
        print(f"  - id={t.get('id')} type={t.get('type')} period={t.get('period')!r} "
              f"amount={t.get('amount')} date={t.get('date')} auto={t.get('auto')} "
              f"created_at={t.get('created_at')} created_by={t.get('created_by')}")

    print(f"\n=== gold_loan_interest_generations guard docs for loan_id={loan['id']} ===")
    gens = await db.gold_loan_interest_generations.find({'loan_id': loan['id']}, {'_id': 0}) \
        .sort('period', 1).to_list(5000)
    print(f'  {len(gens)} guard doc(s):')
    for g in gens:
        print(f'  - {g}')

    print(f"\nMongo host in use: {mongo_url.split('@')[-1].split('/')[0] if '@' in mongo_url else mongo_url.split('//')[-1].split('/')[0]}")
    print(f'Database: {db_name}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: python scripts/diagnose_gold_loan.py <LOAN_NO>')
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
