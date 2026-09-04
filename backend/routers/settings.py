"""Store Settings

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
import re
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from server import (
    db,
    now_utc,
    get_current,
    require_owner,
    require_module,
    require_staff_or_module,
    require_admin_or_module,
    StoreSettingsIn,
    log_audit,
    get_whatsapp_status,
    send_whatsapp_channel,
    GOLD_RATE_CHANNEL_ID,
)
# gold_rate is imported lazily inside each endpoint below (not at module
# top): server.py imports this router while it's still mid-load, and
# gold_rate.py itself does `from server import ...` — importing gold_rate
# here at module top races that, resolving to a still-partially-initialized
# module in some import orders (AttributeError on its own constants).

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
    repair_ready_template: Optional[str] = None   # None/blank = use the built-in default
    # Inbound auto-reply bot (routers/whatsapp_bot.py) — defaults OFF, unlike
    # every other flow here: this one replies to customers completely
    # unsupervised, so it needs a deliberate opt-in rather than an opt-out.
    chatbot_enabled: bool = False
    chatbot_rate_template: Optional[str] = None   # None/blank = use the built-in default


@router.get('/settings/whatsapp')
async def get_whatsapp_settings(_: dict = Depends(get_current)):
    from routers.repairs import DEFAULT_REPAIR_READY_TEMPLATE
    from routers.whatsapp_bot import DEFAULT_RATE_TEMPLATE
    doc = await db.settings.find_one({'id': 'whatsapp'}, {'_id': 0}) or {}
    status = await get_whatsapp_status()
    return {
        'enabled': doc.get('enabled', True),
        'repair_ready_notice': doc.get('repair_ready_notice', True),
        'repair_ready_template': doc.get('repair_ready_template') or DEFAULT_REPAIR_READY_TEMPLATE,
        'chatbot_enabled': doc.get('chatbot_enabled', False),
        'chatbot_rate_template': doc.get('chatbot_rate_template') or DEFAULT_RATE_TEMPLATE,
        **status,
    }


@router.put('/settings/whatsapp')
async def update_whatsapp_settings(body: WhatsAppSettingsIn, user: dict = Depends(require_owner)):
    if body.repair_ready_template:
        sample = {'customer_name': 'Test', 'item_code': 'RJ-001', 'description': 'Ring', 'shop_name': 'Test', 'amount_line': 'Bill amount: Rs.100.'}
        try:
            body.repair_ready_template.format(**sample)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f'Template has an unknown placeholder: {e}')
    if body.chatbot_rate_template:
        try:
            body.chatbot_rate_template.format(gold_rate=151050, silver_rate=242200, date='04 Sep 2026', time='12:30 PM')
        except Exception as e:
            raise HTTPException(status_code=400, detail=f'Template has an unknown placeholder: {e}')
    payload = body.model_dump()
    payload['id'] = 'whatsapp'
    payload['updated_at'] = now_utc().isoformat()
    await db.settings.update_one({'id': 'whatsapp'}, {'$set': payload}, upsert=True)
    await log_audit(user, 'settings.whatsapp.update', 'settings', 'whatsapp', '')
    doc = await db.settings.find_one({'id': 'whatsapp'}, {'_id': 0})
    status = await get_whatsapp_status()
    return {**doc, **status}


# ---------------- Gold Rate (daily reference + Channel broadcast) ----------------
# See gold_rate.py for the fetch/schedule logic. Owner-only end to end: the
# fetched number needs a human look (margin on top, possible scrape hiccup)
# before it reaches the WhatsApp Channel's followers.
class GoldRateConfigIn(BaseModel):
    fetch_time: str = '12:30'   # "HH:MM", 24-hour, IST — mirrors gold_rate.DEFAULT_FETCH_TIME
    gold_margin: int = 0
    silver_margin: int = 0
    template: Optional[str] = None   # None/blank = use the built-in default


class GoldRateManualIn(BaseModel):
    gold_rate: int
    silver_rate: int
    message: Optional[str] = None


class GoldRateSendIn(BaseModel):
    message: Optional[str] = None
    # Present when the sender hand-edited the rate fields on the send screen
    # (not just the message text) — persisted so today's record reflects what
    # was actually broadcast, not just what was originally fetched.
    gold_rate: Optional[int] = None
    silver_rate: Optional[int] = None


@router.get('/settings/gold-rate')
async def get_gold_rate(_: dict = Depends(require_staff_or_module('gold_rate'))):
    import gold_rate
    cfg = await gold_rate.get_config()
    today = await db.settings.find_one({'id': 'gold_rate_today'}, {'_id': 0})
    status = await get_whatsapp_status()
    return {**cfg, 'channel_connected': status.get('connected', False), 'today': today}


@router.put('/settings/gold-rate/config')
async def update_gold_rate_config(body: GoldRateConfigIn, user: dict = Depends(require_owner)):
    import gold_rate
    if not re.match(r'^([01]\d|2[0-3]):[0-5]\d$', body.fetch_time):
        raise HTTPException(status_code=400, detail='fetch_time must be HH:MM (24-hour)')
    if body.template:
        try:
            body.template.format(gold_rate=151050, silver_rate=242200, date='04 Sep 2026', time='12:30 PM')
        except Exception as e:
            raise HTTPException(status_code=400, detail=f'Template has an unknown placeholder: {e}')
    payload = {
        'id': 'gold_rate_config', 'fetch_time': body.fetch_time,
        'gold_margin': body.gold_margin, 'silver_margin': body.silver_margin, 'template': body.template,
        'updated_at': now_utc().isoformat(),
    }
    await db.settings.update_one({'id': 'gold_rate_config'}, {'$set': payload}, upsert=True)
    await log_audit(user, 'settings.gold_rate.config_update', 'settings', 'gold_rate_config', f'{body.fetch_time} gold+{body.gold_margin} silver+{body.silver_margin}')
    return await gold_rate.get_config()


@router.post('/settings/gold-rate/refetch')
async def refetch_gold_rate(user: dict = Depends(require_admin_or_module('gold_rate'))):
    import gold_rate
    doc = await gold_rate.run_fetch_and_store()
    await log_audit(user, 'settings.gold_rate.refetch', 'settings', 'gold_rate_today', f"gold={doc.get('gold_rate')} silver={doc.get('silver_rate')}")
    return doc


@router.put('/settings/gold-rate')
async def set_gold_rate_manual(body: GoldRateManualIn, user: dict = Depends(require_admin_or_module('gold_rate'))):
    import gold_rate
    date_str = gold_rate.today_ist()
    message = (body.message or await gold_rate.default_message(body.gold_rate, body.silver_rate)).strip()
    doc = {
        'id': 'gold_rate_today', 'date': date_str, 'fetched_at': now_utc().isoformat(),
        'fetched_gold': None, 'fetched_silver': None, 'gold_margin_applied': None, 'silver_margin_applied': None,
        'gold_rate': body.gold_rate, 'silver_rate': body.silver_rate, 'error': None,
        'manual': True, 'confirmed': False, 'message': message,
    }
    await db.settings.update_one({'id': 'gold_rate_today'}, {'$set': doc}, upsert=True)
    await log_audit(user, 'settings.gold_rate.manual_set', 'settings', 'gold_rate_today', f'gold={body.gold_rate} silver={body.silver_rate}')
    return await db.settings.find_one({'id': 'gold_rate_today'}, {'_id': 0})


@router.post('/settings/gold-rate/send')
async def send_gold_rate(body: GoldRateSendIn, user: dict = Depends(require_admin_or_module('gold_rate'))):
    today = await db.settings.find_one({'id': 'gold_rate_today'}, {'_id': 0})
    message = (body.message or (today or {}).get('message') or '').strip()
    if not message:
        raise HTTPException(status_code=400, detail='No rate message to send yet — fetch or enter a rate first')
    ok = await send_whatsapp_channel(GOLD_RATE_CHANNEL_ID, message)
    if not ok:
        raise HTTPException(status_code=502, detail='Could not send — check the WhatsApp service is connected (Settings > WhatsApp)')
    update = {'confirmed': True, 'sent_at': now_utc().isoformat(), 'message': message}
    if body.gold_rate is not None:
        update['gold_rate'] = body.gold_rate
    if body.silver_rate is not None:
        update['silver_rate'] = body.silver_rate
    await db.settings.update_one({'id': 'gold_rate_today'}, {'$set': update}, upsert=True)
    await log_audit(user, 'settings.gold_rate.send', 'settings', 'gold_rate_today', message[:60])
    return {'ok': True}
