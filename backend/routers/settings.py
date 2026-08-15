"""Store Settings

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends
from server import (
    db,
    now_utc,
    get_current,
    require_owner,
    require_module,
    StoreSettingsIn,
    NotificationSettingsIn,
    NOTIFICATION_MODULES,
    log_audit,
)

router = APIRouter()

# ---------------- Settings ----------------
@router.get('/settings/store')
async def get_store(_: dict = Depends(get_current)):
    doc = await db.settings.find_one({'id': 'store'}, {'_id': 0})
    return doc or {}


@router.put('/settings/store')
async def update_store(body: StoreSettingsIn, user: dict = Depends(require_owner), _mod=Depends(require_module('store_settings'))):
    payload = body.model_dump()
    payload['id'] = 'store'
    payload['updated_at'] = now_utc().isoformat()
    await db.settings.update_one({'id': 'store'}, {'$set': payload}, upsert=True)
    await log_audit(user, 'settings.store.update', 'settings', 'store', body.name)
    return await db.settings.find_one({'id': 'store'}, {'_id': 0})


# ---------------- Notification Settings ----------------
# Per-module on/off + who receives that module's admin-facing broadcast
# notifications (e.g. "someone checked in", "a repair was created"). Doesn't
# affect the personal notifications a specific person always gets about
# their own record (leave decided, salary paid, etc.) — see _notify_module
# in server.py for the enforcement side of this.
@router.get('/settings/notifications')
async def get_notification_settings(_: dict = Depends(require_owner)):
    doc = await db.settings.find_one({'id': 'notifications'}, {'_id': 0}) or {}
    stored_modules = doc.get('modules') or {}
    # Always return every known module, fully populated — defaulting anything
    # not yet configured to enabled + that module's built-in default roles —
    # so the settings screen never has to guess at what "unset" means.
    modules = {}
    for m in NOTIFICATION_MODULES:
        cfg = stored_modules.get(m['key']) or {}
        modules[m['key']] = {
            'label': m['label'],
            'enabled': cfg.get('enabled', True),
            'roles': cfg.get('roles') if cfg.get('roles') is not None else list(m['default_roles']),
            'user_ids': cfg.get('user_ids') or [],
        }
    return {'modules': modules}


@router.put('/settings/notifications')
async def update_notification_settings(body: NotificationSettingsIn, user: dict = Depends(require_owner)):
    payload = {
        'id': 'notifications',
        'modules': {k: v.model_dump() for k, v in body.modules.items() if k in {m['key'] for m in NOTIFICATION_MODULES}},
        'updated_at': now_utc().isoformat(),
    }
    await db.settings.update_one({'id': 'notifications'}, {'$set': payload}, upsert=True)
    await log_audit(user, 'settings.notifications.update', 'settings', 'notifications', 'Notification settings')
    return await get_notification_settings(user)
