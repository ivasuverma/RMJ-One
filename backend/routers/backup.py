"""Backup settings + manual run + status + restore (owner only)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import gzip
import json
import backup_service
import drive_service
from server import db, now_utc, require_owner, log_audit

router = APIRouter()


@router.get('/backup/status')
async def backup_status(_: dict = Depends(require_owner)):
    cfg = await db.settings.find_one({'id': 'backup'}, {'_id': 0}) or {}
    dcfg = await drive_service.get_config()
    drive_connected = bool(dcfg and dcfg.get('refresh_token'))
    recent = []
    if drive_connected:
        try:
            files = await drive_service.list_backups(dcfg)
            recent = [{'id': f.get('id'), 'name': f.get('name'), 'size': int(f.get('size') or 0), 'created': f.get('createdTime')} for f in files[:10]]
        except Exception:
            recent = []
    return {
        'auto_enabled': cfg.get('auto_enabled', True) is not False,
        'drive_connected': drive_connected,
        'last_at': cfg.get('last_at'),
        'last_file': cfg.get('last_file'),
        'last_size': cfg.get('last_size'),
        'last_total': cfg.get('last_total'),
        'last_error': cfg.get('last_error'),
        'retention': backup_service.RETENTION,
        'recent': recent,
    }


@router.post('/backup/run')
async def backup_run(user: dict = Depends(require_owner)):
    res = await backup_service.run_backup()
    await log_audit(user, 'backup.run', 'backup', 'manual', res.get('file', ''), {'ok': res.get('ok')})
    return res


class BackupSettingsIn(BaseModel):
    auto_enabled: Optional[bool] = None


@router.put('/backup/settings')
async def backup_settings(body: BackupSettingsIn, user: dict = Depends(require_owner)):
    upd: dict = {'id': 'backup', 'updated_at': now_utc().isoformat()}
    if body.auto_enabled is not None:
        upd['auto_enabled'] = bool(body.auto_enabled)
    await db.settings.update_one({'id': 'backup'}, {'$set': upd}, upsert=True)
    await log_audit(user, 'backup.settings', 'backup', 'settings', str(upd.get('auto_enabled')))
    return await backup_status(user)


class BackupRestoreIn(BaseModel):
    file_id: str
    # 'merge' upserts each document by its 'id' field, leaving anything not in
    # the backup untouched. 'replace' clears every collection the backup
    # mentions first — an exact rollback, but it deletes live data, so it
    # additionally requires `confirm`.
    mode: str = 'merge'
    confirm: bool = False


@router.post('/backup/restore')
async def backup_restore(body: BackupRestoreIn, user: dict = Depends(require_owner)):
    """Restores one of the backups listed in GET /backup/status's `recent`
    straight from Drive — the in-app counterpart to running
    scripts/restore_backup.py by hand on the server. Same two modes, same
    upsert-by-id semantics; see that script's docstring for the full
    rationale (kept in sync deliberately)."""
    if body.mode not in ('merge', 'replace'):
        raise HTTPException(status_code=400, detail="mode must be 'merge' or 'replace'")
    if body.mode == 'replace' and not body.confirm:
        raise HTTPException(status_code=400, detail='Replace mode deletes existing data first — resend with confirm=true to proceed.')

    dcfg = await drive_service.get_config()
    if not (dcfg and dcfg.get('refresh_token')):
        raise HTTPException(status_code=400, detail='Google Drive is not connected.')

    try:
        raw = await drive_service.download(dcfg, body.file_id)
        payload = json.loads(gzip.decompress(raw))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f'Could not read that backup file: {str(e)[:200]}')

    data = payload.get('data') or {}
    meta = payload.get('meta') or {}
    if not isinstance(data, dict) or not data:
        raise HTTPException(status_code=400, detail='That file does not look like an RMJ One backup (no data).')

    restored_collections = 0
    restored_documents = 0
    for name, docs in data.items():
        col = db[name]
        if body.mode == 'replace':
            await col.delete_many({})
        for d in docs:
            if isinstance(d, dict) and 'id' in d:
                await col.replace_one({'id': d['id']}, d, upsert=True)
            else:
                await col.insert_one(d)
            restored_documents += 1
        restored_collections += 1

    await log_audit(user, 'backup.restore', 'backup', body.file_id,
                     f'mode={body.mode} collections={restored_collections} documents={restored_documents}')
    return {
        'ok': True,
        'collections': restored_collections,
        'documents': restored_documents,
        'source_created_at': meta.get('created_at'),
    }
