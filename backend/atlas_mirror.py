"""Online copy of the whole database in MongoDB Atlas, twice a day.

The database runs on the shop server. Twice a day (after each hour in
ATLAS_MIRROR_HOURS, IST — 3 AM and 3 PM by default) every collection is copied
to the free Atlas cluster, replacing the previous copy, so there is always a
complete, ready-to-use copy online that is never more than about 12 hours old:
if the server is lost, point MONGO_URL at Atlas on any PC and the app runs again.

It is ONE copy (the latest), not a history — a mistake copied now replaces the
previous copy. The dated backups in Google Drive (backup_service.py) stay the history.

Turned on by one line in backend/.env:
    ATLAS_MIRROR_URL=mongodb+srv://<user>:<password>@cluster0.l9rc4lu.mongodb.net/
(optional ATLAS_MIRROR_DB, default: the same name as the local database).

Each collection is written to a temporary collection first and swapped in only
once it is complete, so a copy interrupted half-way never leaves a collection
half-empty online. The free cluster holds 512 MB, so the copy is skipped (with
an alert) if the database grows past MAX_BYTES.
"""
import asyncio
import logging
import os

from pymongo.errors import OperationFailure

from server import db, now_utc, IST, DB_NAME, _notify_system_health

logger = logging.getLogger('atlas_mirror')

MIRROR_URL = os.environ.get('ATLAS_MIRROR_URL', '').strip()
MIRROR_DB = os.environ.get('ATLAS_MIRROR_DB', '').strip() or DB_NAME
# IST hours after which a copy runs; the local database dumps run at 02:30 and 14:30.
HOURS = sorted({int(h) for h in os.environ.get('ATLAS_MIRROR_HOURS', '3,15').split(',') if h.strip().isdigit() and int(h) < 24}) or [3, 15]
MAX_BYTES = 450 * 1024 * 1024          # the free (M0) cluster stores 512 MB including indexes
RETRY_AFTER_S = 3 * 3600               # after a failed copy, try again this much later
BATCH = 500
META = '_mirror_meta'
TMP = '_mirror_tmp_'


async def _copy_collection(src, dst_db, name: str) -> int:
    tmp = dst_db[TMP + name]
    await tmp.drop()
    n, batch = 0, []
    async for doc in src[name].find({}):
        batch.append(doc)
        if len(batch) >= BATCH:
            await tmp.insert_many(batch, ordered=False)
            n += len(batch)
            batch = []
    if batch:
        await tmp.insert_many(batch, ordered=False)
        n += len(batch)
    # Same indexes as the shop copy, so the online one is ready to run the app on.
    for iname, spec in (await src[name].index_information()).items():
        if iname == '_id_':
            continue
        opts = {k: v for k, v in spec.items() if k in ('unique', 'sparse', 'expireAfterSeconds', 'partialFilterExpression')}
        try:
            await tmp.create_index(spec['key'], name=iname, **opts)
        except Exception as e:
            logger.warning(f'atlas mirror: index {name}.{iname} skipped: {e}')
    if n == 0:
        await dst_db[name].drop()
        await dst_db.create_collection(name)
        await tmp.drop()
        return 0
    try:
        await tmp.rename(name, dropTarget=True)
    except OperationFailure:
        # Some shared-tier clusters refuse renames: swap by copying across instead.
        await dst_db[name].drop()
        await tmp.aggregate([{'$out': name}]).to_list(None)
        await tmp.drop()
    return n


async def run_mirror() -> dict:
    if not MIRROR_URL:
        return {'ok': False, 'error': 'Not set up — ATLAS_MIRROR_URL is missing from backend/.env'}
    from motor.motor_asyncio import AsyncIOMotorClient
    stats = await db.command('dbStats')
    size = int(stats.get('dataSize', 0)) + int(stats.get('indexSize', 0))
    if size > MAX_BYTES:
        return {'ok': False, 'error': f'The database is {size // (1024 * 1024)} MB — too big for the free online copy (limit ~{MAX_BYTES // (1024 * 1024)} MB)'}
    client = AsyncIOMotorClient(MIRROR_URL, serverSelectionTimeoutMS=20000)
    started = now_utc()
    try:
        dst = client[MIRROR_DB]
        names = sorted(n for n in await db.list_collection_names() if not n.startswith('system.'))
        counts = {}
        for name in names:
            counts[name] = await _copy_collection(db, dst, name)
        # Drop anything online that no longer exists in the shop copy (and stray temp collections).
        for name in await dst.list_collection_names():
            if name != META and not name.startswith('system.') and name not in counts:
                await dst[name].drop()
        meta = {'id': 'last', 'completed_at': now_utc().isoformat(), 'started_at': started.isoformat(),
                'source_db': DB_NAME, 'collections': counts, 'documents': sum(counts.values()), 'source_bytes': size}
        await dst[META].replace_one({'id': 'last'}, meta, upsert=True)
        return {'ok': True, 'collections': len(counts), 'documents': meta['documents'], 'bytes': size,
                'seconds': int((now_utc() - started).total_seconds())}
    finally:
        client.close()


def current_slot(local) -> str:
    """The copy that should exist by now, e.g. '2026-10-03@15'. Before the day's
    first hour it is yesterday's last one."""
    from datetime import timedelta
    done = [h for h in HOURS if local.hour >= h]
    if done:
        return f"{local.date().isoformat()}@{done[-1]}"
    return f"{(local.date() - timedelta(days=1)).isoformat()}@{HOURS[-1]}"


async def mirror_and_record() -> dict:
    try:
        res = await run_mirror()
    except Exception as e:
        res = {'ok': False, 'error': str(e)[:300]}
    now = now_utc()
    if res.get('ok'):
        await db.settings.update_one({'id': 'atlas_mirror'}, {'$set': {
            'id': 'atlas_mirror', 'last_at': now.isoformat(), 'last_date': now.astimezone(IST).date().isoformat(),
            'last_documents': res['documents'], 'last_collections': res['collections'], 'last_bytes': res['bytes'],
            'last_seconds': res['seconds'], 'last_error': None, 'last_attempt_at': now.isoformat(),
            'last_slot': current_slot(now.astimezone(IST)),
        }}, upsert=True)
        logger.info(f"atlas mirror: {res['documents']} documents in {res['collections']} collections, {res['seconds']}s")
    else:
        await db.settings.update_one({'id': 'atlas_mirror'}, {'$set': {
            'id': 'atlas_mirror', 'last_error': res.get('error'), 'last_attempt_at': now.isoformat(),
        }}, upsert=True)
        logger.warning(f"atlas mirror failed: {res.get('error')}")
        if MIRROR_URL:
            await _notify_system_health('atlas_mirror_failed', 'Online database copy failed',
                                         f"The copy to MongoDB Atlas didn't finish: {res.get('error')}", '/settings/backup')
    return res


async def atlas_mirror_loop() -> None:
    """Checks every 30 minutes; copies once per slot (after each hour in HOURS)."""
    if not MIRROR_URL:
        return
    await asyncio.sleep(180)
    while True:
        try:
            st = await db.settings.find_one({'id': 'atlas_mirror'}, {'_id': 0}) or {}
            now = now_utc()
            local = now.astimezone(IST)
            slot = current_slot(local)
            # A copy made before slots existed counts for that day's first slot.
            done = st.get('last_slot') == slot or (not st.get('last_slot') and st.get('last_date') == local.date().isoformat()
                                                   and slot.endswith(f'@{HOURS[0]}'))
            last_try = st.get('last_attempt_at')
            recently_tried = False
            if last_try and st.get('last_error'):
                from datetime import datetime
                recently_tried = (now - datetime.fromisoformat(last_try)).total_seconds() < RETRY_AFTER_S
            if not done and not recently_tried:
                await mirror_and_record()
        except Exception as e:
            logger.warning(f'atlas mirror loop: {e}')
        await asyncio.sleep(1800)
