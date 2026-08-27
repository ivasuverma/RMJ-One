#!/usr/bin/env python3
"""Restore a RMJ One backup (.json.gz) into MongoDB.

Usage:
    python restore_backup.py <backup.json.gz>            # safe merge (upsert by id)
    python restore_backup.py <backup.json.gz> --drop     # replace each collection

Download the backup from Google Drive ('RMJ One Backups' folder) first, then run
this on the server. Reads MONGO_URL and DB_NAME from the environment (the same
values the backend uses — load them from backend/.env before running).

--drop clears each collection before inserting (a clean, exact restore). Without
it, documents are upserted by their 'id' field (a non-destructive merge). Take a
fresh backup before using --drop.
"""
import sys
import os
import gzip
import json


def main():
    args = sys.argv[1:]
    drop = '--drop' in args
    files = [a for a in args if not a.startswith('--')]
    if not files:
        print('usage: restore_backup.py <backup.json.gz> [--drop]')
        sys.exit(1)
    path = files[0]

    mongo = os.environ.get('MONGO_URL')
    dbname = os.environ.get('DB_NAME')
    if not mongo or not dbname:
        print('ERROR: set MONGO_URL and DB_NAME environment variables (see backend/.env).')
        sys.exit(1)

    try:
        from pymongo import MongoClient  # ships with motor
    except ImportError:
        print('ERROR: pymongo not available. Run inside the backend environment.')
        sys.exit(1)

    with gzip.open(path, 'rt', encoding='utf-8') as f:
        payload = json.load(f)
    meta = payload.get('meta', {})
    data = payload.get('data', {})
    print(f"Backup from {meta.get('created_at')} — {len(data)} collections, "
          f"{meta.get('total_documents')} documents. Mode: {'DROP+RESTORE' if drop else 'merge (upsert by id)'}")
    if drop:
        confirm = input("This will REPLACE existing collections. Type 'yes' to continue: ")
        if confirm.strip().lower() != 'yes':
            print('Aborted.')
            sys.exit(0)

    client = MongoClient(mongo)
    db = client[dbname]
    for name, docs in data.items():
        col = db[name]
        if drop:
            col.delete_many({})
        count = 0
        for d in docs:
            if 'id' in d:
                col.replace_one({'id': d['id']}, d, upsert=True)
            else:
                col.insert_one(d)
            count += 1
        print(f"  {name}: {count}")
    print('Restore complete.')


if __name__ == '__main__':
    main()
