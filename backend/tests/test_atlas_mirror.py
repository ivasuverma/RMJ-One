"""Nightly online copy (atlas_mirror.py) — copies into a second database on the
test MongoDB, standing in for Atlas. Needs a real MongoDB (CI has one), so it's
skipped where MONGO_URL isn't set."""
import asyncio
import os

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get('MONGO_URL'), reason='needs a real MongoDB (MONGO_URL)')


def test_mirror_copies_everything_and_replaces_last_copy():
    import atlas_mirror
    from server import db
    from motor.motor_asyncio import AsyncIOMotorClient

    atlas_mirror.MIRROR_URL = os.environ['MONGO_URL']
    atlas_mirror.MIRROR_DB = os.environ.get('DB_NAME', 'rmj') + '_mirror_test'

    async def go():
        dst = AsyncIOMotorClient(atlas_mirror.MIRROR_URL)[atlas_mirror.MIRROR_DB]
        await dst.client.drop_database(atlas_mirror.MIRROR_DB)
        await dst['stale_leftover'].insert_one({'x': 1})           # from an older copy: must go
        await db['mirror_probe'].drop()
        await db['mirror_probe'].insert_many([{'id': f'p{i}', 'n': i} for i in range(1234)])
        await db['mirror_probe'].create_index('id', unique=True, name='id_unique')

        before = {n for n in await db.list_collection_names() if not n.startswith('system.')}
        res = await atlas_mirror.run_mirror()
        assert res['ok'], res
        online = {n for n in await dst.list_collection_names() if n != atlas_mirror.META}
        # (the running test server may create a collection meanwhile, so compare against the set seen before)
        assert before <= online and 'stale_leftover' not in online
        assert await dst['mirror_probe'].count_documents({}) == 1234
        assert await dst['users'].count_documents({}) == await db['users'].count_documents({}) > 0
        assert 'id_unique' in await dst['mirror_probe'].index_information()
        meta = await dst[atlas_mirror.META].find_one({'id': 'last'})
        assert meta['documents'] >= 1234 and meta['collections']['mirror_probe'] == 1234

        # Next night: the copy is replaced, not added to.
        await db['mirror_probe'].delete_many({'n': {'$gte': 1000}})
        assert (await atlas_mirror.run_mirror())['ok']
        assert await dst['mirror_probe'].count_documents({}) == 1000
        assert not [n for n in await dst.list_collection_names() if n.startswith(atlas_mirror.TMP)]

        await db['mirror_probe'].drop()
        await dst.client.drop_database(atlas_mirror.MIRROR_DB)

    asyncio.run(go())
