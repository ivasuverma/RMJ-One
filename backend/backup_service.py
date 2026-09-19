"""Whole-database backup → Google Drive.

Dumps every MongoDB collection to a single gzipped JSON file and uploads it to a
'RMJ One Backups' folder in the shop's Drive (reusing the existing Drive OAuth).
Pure-Python so it works whether or not the MongoDB command-line tools are
installed on the server. Restore with scripts/restore_backup.py.

The database lives locally on the server, so this is the shop's off-site copy of
all business data (documents' full images already live in Drive separately).
"""
import gzip
import json
import logging
import asyncio
import os
import pathlib
import time

from server import db, now_utc, _notify_system_health

logger = logging.getLogger('backup')

RETENTION = 30          # keep this many most-recent backups in Drive
BACKUP_EVERY_HOURS = 23  # auto-backup cadence (checked hourly)


async def create_backup_bytes() -> tuple:
    """Return (gzipped_json_bytes, meta) — a full dump of every collection,
    excluding Mongo's internal _id (the app keys everything on its own 'id')."""
    names = await db.list_collection_names()
    data: dict = {}
    counts: dict = {}
    total = 0
    for name in sorted(names):
        docs = await db[name].find({}, {'_id': 0}).to_list(None)
        data[name] = docs
        counts[name] = len(docs)
        total += len(docs)
    meta = {'created_at': now_utc().isoformat(), 'version': 1, 'collections': counts, 'total_documents': total}
    raw = json.dumps({'meta': meta, 'data': data}, ensure_ascii=False, default=str).encode('utf-8')
    return gzip.compress(raw), meta


async def _prune(cfg: dict) -> None:
    """Keep only the newest RETENTION backups in Drive."""
    try:
        import drive_service
        files = await drive_service.list_backups(cfg)   # newest first
        for f in files[RETENTION:]:
            await drive_service.delete_file(cfg, f['id'])
    except Exception as e:
        logger.warning(f'backup prune failed: {e}')


async def run_backup() -> dict:
    import drive_service
    cfg = await drive_service.get_config()
    if not (cfg and cfg.get('refresh_token')):
        return {'ok': False, 'error': 'Google Drive is not connected — connect it in Settings first.'}
    gz, meta = await create_backup_bytes()
    ts = now_utc().strftime('%Y-%m-%d_%H%M')
    fname = f'rmj-backup_{ts}.json.gz'
    try:
        await drive_service.upload_backup(cfg, fname, gz)
    except Exception as e:
        err = str(e)[:200]
        logger.warning(f'backup upload failed: {err}')
        if 'invalid_grant' in err or 'invalid_client' in err:
            await _notify_system_health('drive_disconnected', 'Google Drive disconnected',
                                         'Google Drive needs to be reconnected — the nightly backup is paused (Settings > Google Drive).', '/settings/google-drive')
        else:
            await _notify_system_health('drive_upload_failed', 'Backup failed',
                                         f'The database backup failed to upload to Google Drive: {err}', '/settings/google-drive')
        return {'ok': False, 'error': f'Upload to Drive failed: {err}'}
    await _prune(cfg)
    await db.settings.update_one({'id': 'backup'}, {'$set': {
        'id': 'backup',
        'last_at': now_utc().isoformat(),
        'last_file': fname,
        'last_size': len(gz),
        'last_total': meta.get('total_documents'),
        'last_collections': meta.get('collections'),
        'last_error': None,
    }}, upsert=True)
    return {'ok': True, 'file': fname, 'size': len(gz), 'documents': meta.get('total_documents')}


SYSTEM_BACKUP_DIR = os.environ.get('SYSTEM_BACKUP_DIR', 'D:/RMJ-One/mongodb/backups')
_SYSTEM_PATTERNS = ('rmj_one-*.gz', 'config-*.zip')   # database dump + configuration bundle
_SYSTEM_MAX_AGE_DAYS = 3


async def upload_system_backups() -> dict:
    """Send the server's own nightly backup files (full database dump + configuration
    bundle, written by the scheduled task in ops/backup) to Google Drive, so Drive is the
    one off-site place for everything. Only new files from the last few days are sent;
    Drive is pruned to the newest RETENTION files afterwards."""
    import drive_service
    cfg = await drive_service.get_config()
    if not (cfg and cfg.get('refresh_token')):
        return {'ok': False, 'error': 'Google Drive is not connected'}
    d = pathlib.Path(SYSTEM_BACKUP_DIR)
    if not d.is_dir():
        return {'ok': True, 'sent': []}
    cutoff = time.time() - _SYSTEM_MAX_AGE_DAYS * 86400
    have = {f['name'] for f in await drive_service.list_backups(cfg)}
    sent = []
    for pat in _SYSTEM_PATTERNS:
        for f in sorted(d.glob(pat), key=lambda x: x.stat().st_mtime, reverse=True):
            if f.name in have or f.stat().st_mtime < cutoff or f.stat().st_size < 1024:
                continue
            # The scheduled task may still be writing it — wait until it stops growing.
            size = f.stat().st_size
            await asyncio.sleep(3)
            if f.stat().st_size != size:
                continue
            raw = await asyncio.to_thread(f.read_bytes)
            await drive_service.upload_backup(cfg, f.name, raw, 'application/zip' if f.suffix == '.zip' else 'application/gzip')
            sent.append(f.name)
    if sent:
        await _prune(cfg)
    await db.settings.update_one({'id': 'system_backup'}, {'$set': {
        'id': 'system_backup', 'last_check_at': now_utc().isoformat(), 'last_error': None,
        **({'last_sent_at': now_utc().isoformat(), 'last_sent': sent} if sent else {}),
    }}, upsert=True)
    return {'ok': True, 'sent': sent}


async def backup_loop() -> None:
    """Runs a backup automatically ~daily when enabled and Drive is connected.
    Checks hourly and catches up if the last backup is stale (e.g. server was
    off overnight)."""
    await asyncio.sleep(60)   # let startup settle
    while True:
        try:
            cfg = await db.settings.find_one({'id': 'backup'}, {'_id': 0}) or {}
            # Off by default: the nightly database backup is now made on the server itself
            # (see ops/backup) and sent to Drive by upload_system_backups() below.
            if cfg.get('auto_enabled', False) is True:
                import drive_service
                dcfg = await drive_service.get_config()
                if dcfg and dcfg.get('refresh_token'):
                    last = cfg.get('last_at')
                    due = True
                    if last:
                        try:
                            from datetime import datetime
                            elapsed = (now_utc() - datetime.fromisoformat(last)).total_seconds() / 3600
                            due = elapsed >= BACKUP_EVERY_HOURS
                        except Exception:
                            due = True
                    if due:
                        res = await run_backup()
                        if not res.get('ok'):
                            await db.settings.update_one({'id': 'backup'}, {'$set': {'last_error': res.get('error')}}, upsert=True)
        except Exception as e:
            logger.warning(f'backup loop error: {e}')
        try:
            await upload_system_backups()
        except Exception as e:
            logger.warning(f'system backup upload failed: {e}')
            await db.settings.update_one({'id': 'system_backup'}, {'$set': {'id': 'system_backup', 'last_error': str(e)[:200]}}, upsert=True)
        await asyncio.sleep(3600)
