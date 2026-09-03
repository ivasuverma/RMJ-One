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
    log_audit,
    get_whatsapp_status,
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


# ---------------- WhatsApp Settings ----------------
# Master + per-flow toggles for customer-facing WhatsApp messages sent via
# the OpenWA gateway (see server.py's send_whatsapp/whatsapp_flow_enabled).
# Both default True: the feature works out of the box once OpenWA is
# connected, and staff turn OFF what they don't want. New flows get their
# own field here as they're added (only 'repair_ready_notice' exists today).
class WhatsAppSettingsIn(BaseModel):
    enabled: bool = True
    repair_ready_notice: bool = True


@router.get('/settings/whatsapp')
async def get_whatsapp_settings(_: dict = Depends(get_current)):
    doc = await db.settings.find_one({'id': 'whatsapp'}, {'_id': 0}) or {}
    status = await get_whatsapp_status()
    return {
        'enabled': doc.get('enabled', True),
        'repair_ready_notice': doc.get('repair_ready_notice', True),
        **status,
    }


@router.put('/settings/whatsapp')
async def update_whatsapp_settings(body: WhatsAppSettingsIn, user: dict = Depends(require_owner)):
    payload = body.model_dump()
    payload['id'] = 'whatsapp'
    payload['updated_at'] = now_utc().isoformat()
    await db.settings.update_one({'id': 'whatsapp'}, {'$set': payload}, upsert=True)
    await log_audit(user, 'settings.whatsapp.update', 'settings', 'whatsapp', '')
    doc = await db.settings.find_one({'id': 'whatsapp'}, {'_id': 0})
    status = await get_whatsapp_status()
    return {**doc, **status}
