"""Backup settings + manual run + status (owner only)."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
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
            recent = [{'name': f.get('name'), 'size': int(f.get('size') or 0), 'created': f.get('createdTime')} for f in files[:10]]
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
