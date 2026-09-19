"""One-off: move documents.local_data / thumb_data into the document_blobs
collection so metadata queries stop reading megabytes of base64. Idempotent — a
document is only stripped after its blob row is confirmed written."""
import asyncio, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from server import db


async def main():
    await db.document_blobs.create_index('id', unique=True)
    moved = 0
    ids = [d['id'] async for d in db.documents.find(
        {'$or': [{'local_data': {'$exists': True}}, {'thumb_data': {'$exists': True}}]}, {'_id': 0, 'id': 1})]
    print('to move:', len(ids))
    for i in ids:
        d = await db.documents.find_one({'id': i}, {'_id': 0, 'local_data': 1, 'thumb_data': 1}) or {}
        ld, td = d.get('local_data'), d.get('thumb_data')
        if ld or td:
            await db.document_blobs.replace_one({'id': i}, {'id': i, 'local_data': ld, 'thumb_data': td}, upsert=True)
            chk = await db.document_blobs.find_one({'id': i}, {'_id': 0, 'local_data': 1, 'thumb_data': 1})
            if not chk or chk.get('local_data') != ld or chk.get('thumb_data') != td:
                print('verify failed, skipping', i); continue
        await db.documents.update_one({'id': i}, {'$unset': {'local_data': '', 'thumb_data': ''}})
        moved += 1
    print('moved', moved)


asyncio.run(main())
