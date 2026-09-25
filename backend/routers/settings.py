"""Store Settings

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
import re
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from server import (
    META_WA_ALERT_TEMPLATE,
    db,
    now_utc,
    get_current,
    require_owner,
    require_module,
    require_staff_or_module,
    require_admin_or_module,
    require_admin_or_module_right,
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
    """Partial update — only the fields actually present in the request body
    are written.

    This document is edited from three separate screens (Attendance Settings,
    Printer Settings, and the webhook secret on Biometric Devices). A whole
    document $set meant each screen wrote back every field as it looked when
    THAT screen loaded, so saving one screen silently reverted whatever another
    had changed in between — last writer wins, on settings that control the
    attendance fence and payroll rules."""
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail='No settings provided')
    # The fence is only meaningful with both coordinates; refuse to blank out
    # one or both of them via an explicit null.
    for geo in ('latitude', 'longitude'):
        if geo in payload and payload[geo] is None:
            raise HTTPException(status_code=400, detail=f'{geo} cannot be empty')
    payload['id'] = 'store'
    payload['updated_at'] = now_utc().isoformat()
    await db.settings.update_one({'id': 'store'}, {'$set': payload}, upsert=True)
    doc = await db.settings.find_one({'id': 'store'}, {'_id': 0})
    await log_audit(user, 'settings.store.update', 'settings', 'store', doc.get('name', ''))
    return doc


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
    # Exactly one WhatsApp service is live at a time — see server.whatsapp_provider.
    # None = leave unchanged, so screens that don't send it can't reset it.
    provider: Optional[Literal['openwa', 'meta']] = None
    repair_ready_notice: bool = True
    repair_ready_template: Optional[str] = None   # None/blank = use the built-in default
    repair_received_notice: bool = True
    repair_received_template: Optional[str] = None   # None/blank = use the built-in default
    # Inbound auto-reply bot (routers/whatsapp_bot.py) — defaults OFF, unlike
    # every other flow here: this one replies to customers completely
    # unsupervised, so it needs a deliberate opt-in rather than an opt-out.
    chatbot_enabled: bool = False
    chatbot_rate_template: Optional[str] = None   # None/blank = use the built-in default
    # Per-keyword on/off — a keyword whose toggle is off is treated as
    # unrecognized (silent), same as if it didn't exist.
    chatbot_rate_enabled: bool = True
    chatbot_status_enabled: bool = True


@router.get('/settings/whatsapp')
async def get_whatsapp_settings(_: dict = Depends(get_current)):
    from routers.repairs import DEFAULT_REPAIR_READY_TEMPLATE, DEFAULT_REPAIR_RECEIVED_TEMPLATE
    from routers.whatsapp_bot import DEFAULT_RATE_TEMPLATE
    doc = await db.settings.find_one({'id': 'whatsapp'}, {'_id': 0}) or {}
    status = await get_whatsapp_status()
    return {
        'enabled': doc.get('enabled', True),
        'provider': doc.get('provider') if doc.get('provider') in ('openwa', 'meta') else 'openwa',
        'meta_alert_template': bool(META_WA_ALERT_TEMPLATE or doc.get('meta_alert_template')),
        'repair_ready_notice': doc.get('repair_ready_notice', True),
        'repair_ready_template': doc.get('repair_ready_template') or DEFAULT_REPAIR_READY_TEMPLATE,
        'repair_received_notice': doc.get('repair_received_notice', True),
        'repair_received_template': doc.get('repair_received_template') or DEFAULT_REPAIR_RECEIVED_TEMPLATE,
        'chatbot_enabled': doc.get('chatbot_enabled', False),
        'chatbot_rate_template': doc.get('chatbot_rate_template') or DEFAULT_RATE_TEMPLATE,
        'chatbot_rate_enabled': doc.get('chatbot_rate_enabled', True),
        'chatbot_status_enabled': doc.get('chatbot_status_enabled', True),
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
    if body.repair_received_template:
        sample = {'customer_name': 'Test', 'item_code': 'RJ-001', 'description': 'Ring', 'shop_name': 'Test', 'due_date': '2026-09-10'}
        try:
            body.repair_received_template.format(**sample)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f'Template has an unknown placeholder: {e}')
    if body.chatbot_rate_template:
        try:
            body.chatbot_rate_template.format(gold_rate=151050, silver_rate=242200, date='04 Sep 2026', time='12:30 PM')
        except Exception as e:
            raise HTTPException(status_code=400, detail=f'Template has an unknown placeholder: {e}')
    payload = body.model_dump()
    if payload['provider'] is None:
        del payload['provider']
    payload['id'] = 'whatsapp'
    payload['updated_at'] = now_utc().isoformat()
    await db.settings.update_one({'id': 'whatsapp'}, {'$set': payload}, upsert=True)
    await log_audit(user, 'settings.whatsapp.update', 'settings', 'whatsapp', '')
    doc = await db.settings.find_one({'id': 'whatsapp'}, {'_id': 0})
    status = await get_whatsapp_status()
    return {**doc, **status}


# ---------------- Official WhatsApp (Meta Cloud API) — test line ----------------
# A second, independent WhatsApp send path (whatsapp_meta.py) being set up
# on a spare number ahead of an eventual migration off OpenWA — see that
# module's docstring for the .env credentials it needs and why a business-
# initiated send needs an approved template, not the freeform test-send
# below. Owner-only: this exists to verify the pipeline works, not for
# day-to-day use by staff.
class WhatsAppMetaTestSendIn(BaseModel):
    mobile: str
    text: str


@router.get('/settings/whatsapp-meta')
async def get_whatsapp_meta_status(_: dict = Depends(require_owner)):
    import whatsapp_meta
    return await whatsapp_meta.get_status()


@router.get('/settings/whatsapp-meta/alert-template')
async def get_meta_alert_template(_: dict = Depends(require_owner)):
    import whatsapp_meta
    st = await whatsapp_meta.alert_template_status()
    if st['exists']:
        await db.settings.update_one({'id': 'whatsapp'}, {'$set': {'meta_alert_template': whatsapp_meta.ALERT_TEMPLATE_NAME}}, upsert=True)
    return {**st, 'name': whatsapp_meta.ALERT_TEMPLATE_NAME, 'body': whatsapp_meta.ALERT_TEMPLATE_BODY,
            'env_override': META_WA_ALERT_TEMPLATE or None}


@router.post('/settings/whatsapp-meta/alert-template')
async def create_meta_alert_template(user: dict = Depends(require_owner)):
    import whatsapp_meta
    res = await whatsapp_meta.create_alert_template()
    if not res['ok']:
        raise HTTPException(status_code=502, detail=f"Meta didn't accept the template: {res['error']}")
    await db.settings.update_one({'id': 'whatsapp'}, {'$set': {'meta_alert_template': whatsapp_meta.ALERT_TEMPLATE_NAME}}, upsert=True)
    await log_audit(user, 'settings.whatsapp_meta.alert_template', 'settings', 'whatsapp_meta', whatsapp_meta.ALERT_TEMPLATE_NAME)
    return await get_meta_alert_template(user)


@router.post('/settings/whatsapp-meta/test-send')
async def send_whatsapp_meta_test(body: WhatsAppMetaTestSendIn, user: dict = Depends(require_owner)):
    import whatsapp_meta
    if not whatsapp_meta.is_configured():
        raise HTTPException(status_code=400, detail='Add META_WA_PHONE_NUMBER_ID and META_WA_ACCESS_TOKEN to backend/.env first.')
    ok = await whatsapp_meta.send_text(body.mobile, body.text, flow='meta_test_send')
    if not ok:
        raise HTTPException(status_code=502, detail="Send failed — check this number has messaged the test line in the last 24 hours (freeform text only works inside that window), and see the backend log for the exact Graph API error.")
    await log_audit(user, 'settings.whatsapp_meta.test_send', 'settings', 'whatsapp_meta', body.mobile)
    return {'ok': True}


# ---------------- WhatsApp Sent Messages log ----------------
# Every send from either provider (OpenWA via server.py's send_whatsapp/
# send_whatsapp_channel/send_whatsapp_raw, or Meta via whatsapp_meta.py's
# send_text/send_template) is logged to db.whatsapp_messages through the
# shared log_whatsapp_message() choke point — see server.py. This is
# deliberately separate from the generic Audit Log (GET /audit/logs): that
# one records who changed what in the app, this one records what actually
# went out over WhatsApp and whether it was delivered. Owner-only, same as
# the rest of this file's WhatsApp settings.
@router.get('/settings/whatsapp-messages')
async def list_whatsapp_messages(
    provider: Optional[str] = None, flow: Optional[str] = None,
    cursor: Optional[str] = None, limit: int = 200, _: dict = Depends(require_owner),
):
    limit = max(1, min(limit, 500))
    q: dict = {}
    if provider: q['provider'] = provider
    if flow: q['flow'] = flow
    if cursor: q['created_at'] = {'$lt': cursor}
    items = await db.whatsapp_messages.find(q, {'_id': 0}).sort('created_at', -1).to_list(limit + 1)
    next_cursor = items[limit]['created_at'] if len(items) > limit else None
    return {'items': items[:limit], 'next_cursor': next_cursor}


# ---------------- Gold Rate (daily reference + Channel broadcast) ----------------
# See gold_rate.py for the fetch/schedule logic. Owner-only end to end: the
# fetched number needs a human look (margin on top, possible scrape hiccup)
# before it reaches the WhatsApp Channel's followers.
class GoldRateConfigIn(BaseModel):
    gold_margin: int = 0
    silver_margin: int = 0
    # Subtracted from the (already-margined) sell rate to get the buy rate
    # shown on the public rates page — see gold_rate._buy_rate. Independent
    # of gold_margin/silver_margin above, which only affect the sell side.
    gold_buy_margin: int = 0
    silver_buy_margin: int = 0
    template: Optional[str] = None   # None/blank = use the built-in default
    # One shared periodic schedule drives both the live rate cache and
    # today's still-open broadcast draft — see gold_rate.DEFAULT_REFRESH_*
    # and _auto_fetch_cycle for how the two used to be (and no longer are)
    # independent schedules.
    refresh_enabled: bool = True
    refresh_interval_min: int = 120
    refresh_start: str = '12:30'
    refresh_end: str = '19:00'
    # Fully-automatic daily send — off by default, deliberate owner opt-in
    # only (see gold_rate.py's DEFAULT_AUTO_SEND_ENABLED docstring). Fires
    # once a day, at auto_send_time (IST) — decoupled from refresh_* above,
    # which keeps fetching all day regardless, purely to keep the live rate
    # and the unconfirmed draft fresh.
    auto_send_enabled: bool = False
    auto_send_time: str = '12:30'
    # Commodity market is closed Sunday — on by default (see gold_rate.py's
    # DEFAULT_SKIP_WEEKEND_FETCH docstring; the name predates it meaning
    # just Sunday).
    skip_weekend_fetch: bool = True


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
    # Where to send the confirmed rate. WhatsApp defaults on (as before); `led` None means "follow the
    # LED board's own auto-update setting", True forces an update, False skips it.
    whatsapp: bool = True
    led: Optional[bool] = None


@router.get('/settings/gold-rate')
async def get_gold_rate(_: dict = Depends(require_staff_or_module('gold_rate'))):
    import gold_rate
    cfg = await gold_rate.get_config()
    today = await db.settings.find_one({'id': 'gold_rate_today'}, {'_id': 0})
    status = await get_whatsapp_status()
    # Raw scrape diagnostics (fetched_at/error + each row's raw scraped
    # text) so a stale/wrong field can be diagnosed from what was actually
    # read off the source page, without needing DB access - see
    # gold_rate._extract_extra.
    live = await db.settings.find_one({'id': 'gold_rate_live'}, {'_id': 0})
    return {**cfg, 'channel_connected': status.get('connected', False), 'today': today, 'live': live}


@router.put('/settings/gold-rate/config')
async def update_gold_rate_config(body: GoldRateConfigIn, user: dict = Depends(require_owner)):
    import gold_rate
    for label, val in (('refresh_start', body.refresh_start), ('refresh_end', body.refresh_end), ('auto_send_time', body.auto_send_time)):
        if not re.match(r'^([01]\d|2[0-3]):[0-5]\d$', val):
            raise HTTPException(status_code=400, detail=f'{label} must be HH:MM (24-hour)')
    if body.template:
        try:
            body.template.format(gold_rate=151050, silver_rate=242200, date='04 Sep 2026', time='12:30 PM')
        except Exception as e:
            raise HTTPException(status_code=400, detail=f'Template has an unknown placeholder: {e}')
    payload = {
        'id': 'gold_rate_config',
        'gold_margin': body.gold_margin, 'silver_margin': body.silver_margin,
        'gold_buy_margin': body.gold_buy_margin, 'silver_buy_margin': body.silver_buy_margin,
        'template': body.template,
        'refresh_enabled': body.refresh_enabled,
        'refresh_interval_min': max(15, body.refresh_interval_min),
        'refresh_start': body.refresh_start, 'refresh_end': body.refresh_end,
        'auto_send_enabled': body.auto_send_enabled,
        'auto_send_time': body.auto_send_time,
        'skip_weekend_fetch': body.skip_weekend_fetch,
        'updated_at': now_utc().isoformat(),
    }
    await db.settings.update_one({'id': 'gold_rate_config'}, {'$set': payload}, upsert=True)
    await log_audit(
        user, 'settings.gold_rate.config_update', 'settings', 'gold_rate_config',
        f'every {body.refresh_interval_min}min {body.refresh_start}-{body.refresh_end} '
        f'gold+{body.gold_margin}(-{body.gold_buy_margin}buy) '
        f'silver+{body.silver_margin}(-{body.silver_buy_margin}buy) '
        f'auto_send={body.auto_send_enabled}@{body.auto_send_time} skip_weekend={body.skip_weekend_fetch}',
    )
    return await gold_rate.get_config()


@router.post('/settings/gold-rate/refetch')
async def refetch_gold_rate(user: dict = Depends(require_admin_or_module('gold_rate'))):
    import gold_rate
    doc = await gold_rate.run_fetch_and_store()
    await log_audit(user, 'settings.gold_rate.refetch', 'settings', 'gold_rate_today', f"gold={doc.get('gold_rate')} silver={doc.get('silver_rate')}")
    return doc


@router.put('/settings/gold-rate')
async def set_gold_rate_manual(body: GoldRateManualIn, user: dict = Depends(require_admin_or_module_right('gold_rate', 'edit'))):
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
async def send_gold_rate(body: GoldRateSendIn, user: dict = Depends(require_admin_or_module_right('gold_rate', 'edit'))):
    """Confirm today's rate and send it to the chosen places: the WhatsApp Channel and/or the LED board.
    The rate is the same everywhere (see also the chatbot, which answers with today's confirmed rate)."""
    if not body.whatsapp and body.led is False:
        raise HTTPException(status_code=400, detail='Choose at least one place to send the rate to')
    today = await db.settings.find_one({'id': 'gold_rate_today'}, {'_id': 0})
    message = (body.message or (today or {}).get('message') or '').strip()
    if body.whatsapp:
        if not message:
            raise HTTPException(status_code=400, detail='No rate message to send yet — fetch or enter a rate first')
        ok = await send_whatsapp_channel(GOLD_RATE_CHANNEL_ID, message, flow='gold_rate_manual_send')
        if not ok:
            raise HTTPException(status_code=502, detail='Could not send — check the WhatsApp service is connected (Settings > WhatsApp)')
    import gold_rate as _gr
    # Confirming happens today, so the record is dated today — a hand-typed rate has no fetched date of its own.
    update = {'confirmed': True, 'date': _gr.today_ist()}
    if body.whatsapp:
        update.update({'sent_at': now_utc().isoformat(), 'message': message})
    if body.gold_rate is not None:
        update['gold_rate'] = body.gold_rate
    if body.silver_rate is not None:
        update['silver_rate'] = body.silver_rate
    await db.settings.update_one({'id': 'gold_rate_today'}, {'$set': update}, upsert=True)
    await log_audit(user, 'settings.gold_rate.send', 'settings', 'gold_rate_today',
                    f"{'whatsapp ' if body.whatsapp else ''}{'led' if body.led is not False else ''} {message[:50]}".strip())
    # LED board: never fails the send; the outcome is reported back so the screen can say what happened.
    led = None
    if body.led is not False:
        from routers.led_board import push_after_confirm
        led = await push_after_confirm(body.gold_rate, body.silver_rate, force=body.led is True)
    return {'ok': True, 'whatsapp': body.whatsapp, 'led': led}
