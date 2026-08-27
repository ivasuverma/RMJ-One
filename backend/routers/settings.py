"""Store Settings

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from server import (
    db,
    now_utc,
    get_current,
    require_owner,
    require_module,
    StoreSettingsIn,
    NotificationSettingsIn,
    NOTIFICATION_MODULES,
    NOTIFICATION_SCRIPTS_BY_MODULE,
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
        disabled_scripts = set(cfg.get('disabled_scripts') or [])
        modules[m['key']] = {
            'label': m['label'],
            'enabled': cfg.get('enabled', True),
            'roles': cfg.get('roles') if cfg.get('roles') is not None else list(m['default_roles']),
            'user_ids': cfg.get('user_ids') or [],
            'disabled_scripts': sorted(disabled_scripts),
            # Full script catalog for this module, each flagged with its
            # current on/off state, so the settings screen can render every
            # individual notification toggle without hardcoding labels.
            'scripts': [
                {'key': s['key'], 'label': s['label'], 'enabled': s['key'] not in disabled_scripts}
                for s in NOTIFICATION_SCRIPTS_BY_MODULE.get(m['key'], [])
            ],
        }
    return {'modules': modules}


@router.put('/settings/notifications')
async def update_notification_settings(body: NotificationSettingsIn, user: dict = Depends(require_owner)):
    valid_module_keys = {m['key'] for m in NOTIFICATION_MODULES}
    modules_payload = {}
    for k, v in body.modules.items():
        if k not in valid_module_keys:
            continue
        d = v.model_dump()
        # Defensive: only persist script keys that actually belong to this
        # module, so a stale/mistaken key can't silently do nothing forever.
        valid_script_keys = {s['key'] for s in NOTIFICATION_SCRIPTS_BY_MODULE.get(k, [])}
        d['disabled_scripts'] = [s for s in (d.get('disabled_scripts') or []) if s in valid_script_keys]
        modules_payload[k] = d
    payload = {
        'id': 'notifications',
        'modules': modules_payload,
        'updated_at': now_utc().isoformat(),
    }
    await db.settings.update_one({'id': 'notifications'}, {'$set': payload}, upsert=True)
    await log_audit(user, 'settings.notifications.update', 'settings', 'notifications', 'Notification settings')
    return await get_notification_settings(user)


# ---------------- Security Settings ----------------
# Auto sign-out after a stretch of inactivity. 0 = disabled (stay signed in).
# Any authenticated user can READ it (the app needs the number to arm its
# idle timer); only the owner can change it.
class SecuritySettingsIn(BaseModel):
    auto_signout_minutes: int = 0


@router.get('/settings/security')
async def get_security(_: dict = Depends(get_current)):
    doc = await db.settings.find_one({'id': 'security'}, {'_id': 0}) or {}
    return {'auto_signout_minutes': int(doc.get('auto_signout_minutes', 0) or 0)}


@router.put('/settings/security')
async def update_security(body: SecuritySettingsIn, user: dict = Depends(require_owner)):
    # Clamp to a sane range: 0 (off) up to 12 hours.
    mins = max(0, min(int(body.auto_signout_minutes or 0), 720))
    await db.settings.update_one(
        {'id': 'security'},
        {'$set': {'id': 'security', 'auto_signout_minutes': mins, 'updated_at': now_utc().isoformat()}},
        upsert=True,
    )
    await log_audit(user, 'settings.security.update', 'settings', 'security', str(mins))
    return {'auto_signout_minutes': mins}
