"""Inbound WhatsApp auto-reply bot — narrow, keyword-only, no AI.

OpenWA POSTs every inbound `message.received` event here (registered as a
webhook on the OpenWA side, filtered to 1:1 text messages only — see
project memory for the exact registration). Two commands, both answered
from data RMJ-One already has:

  RATE   -> today's gold/silver rate (gold_rate.py / gold_rate_today doc)
  STATUS -> the sender's most recent repair item's status

Anything else gets a short "reply RATE or STATUS" hint. Deliberately no
LLM, no freeform replies, no multi-turn state — a fixed keyword -> lookup
-> reply, same reasoning as the rest of this app's WhatsApp flows: a
customer-facing message should never be something nobody reviewed the
shape of. Off by default (see WhatsAppSettingsIn.chatbot_enabled) since,
unlike the other flows, there's no per-send human confirmation step here —
turning it on is the confirmation.
"""
import hashlib
import hmac
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Request, Response

from server import db, now_utc, IST, WHATSAPP_WEBHOOK_SECRET, send_whatsapp_raw, resolve_whatsapp_phone

router = APIRouter()
logger = logging.getLogger('whatsapp_bot')

HELP_TEXT = "Hi! Reply RATE for today's gold/silver rate, or STATUS for your repair status."

STATUS_LABELS = {
    'received': 'received at the shop, not yet with a karigar',
    'with_karigar': 'with the karigar, being worked on',
    'pending_delivery': 'billed and ready for pickup',
    'delivered': 'delivered',
}

# Owner-editable from Settings > WhatsApp (chatbot_rate_template on the
# whatsapp settings doc) — {gold_rate}/{silver_rate}/{date}/{time} are the
# only placeholders. date/time are the rate's fetch time (IST), not "now" —
# a customer texting hours after the fetch should see when it's actually from.
DEFAULT_RATE_TEMPLATE = (
    "Today's approx rate (as on {date}, {time}):\n"
    "Gold 24k: Rs.{gold_rate} /tola\n"
    "Silver: Rs.{silver_rate} /kg"
)


def _verify_signature(raw_body: bytes, signature_header: str) -> bool:
    if not WHATSAPP_WEBHOOK_SECRET or not signature_header or not signature_header.startswith('sha256='):
        return False
    expected = hmac.new(WHATSAPP_WEBHOOK_SECRET.encode('utf-8'), raw_body, hashlib.sha256).hexdigest()
    got = signature_header.split('=', 1)[1]
    return hmac.compare_digest(expected, got)


def _format_ist(iso_str: str) -> tuple:
    try:
        dt = datetime.fromisoformat(iso_str).astimezone(IST)
    except Exception:
        dt = now_utc().astimezone(IST)
    return dt.strftime('%d %b %Y'), dt.strftime('%I:%M %p').lstrip('0')


async def _rate_reply() -> str:
    today = await db.settings.find_one({'id': 'gold_rate_today'}, {'_id': 0})
    if not today or not today.get('gold_rate') or not today.get('silver_rate'):
        return "Today's rate isn't available right now — please call the store or check back later."
    date_str, time_str = _format_ist(today.get('fetched_at') or now_utc().isoformat())
    fields = {'gold_rate': today['gold_rate'], 'silver_rate': today['silver_rate'], 'date': date_str, 'time': time_str}
    wa = await db.settings.find_one({'id': 'whatsapp'}, {'_id': 0}) or {}
    template = wa.get('chatbot_rate_template') or DEFAULT_RATE_TEMPLATE
    try:
        return template.format(**fields)
    except Exception:
        # A bad edit (typo'd placeholder) must not silently block every
        # future reply — fall back to the known-good default.
        return DEFAULT_RATE_TEMPLATE.format(**fields)


async def _status_reply(mobile_digits: str) -> str:
    if not mobile_digits:
        return "We couldn't find any repair under this number. Please contact the store directly."
    orders = await db.repair_orders.find(
        {'customer_mobile': {'$regex': f'{mobile_digits}$'}}, {'_id': 0, 'id': 1},
    ).to_list(200)
    if not orders:
        return "We couldn't find any repair under this number. Please contact the store directly."
    order_ids = [o['id'] for o in orders]
    items = await db.repair_items.find(
        {'order_id': {'$in': order_ids}}, {'_id': 0},
    ).sort('created_at', -1).to_list(1)
    if not items:
        return "We couldn't find any repair items under this number. Please contact the store directly."
    item = items[0]
    label = STATUS_LABELS.get(item.get('status', ''), item.get('status') or 'unknown')
    return f"Your item {item.get('item_code', '')} ({item.get('description', '')}) is {label}."


@router.post('/webhooks/whatsapp')
async def whatsapp_webhook(request: Request):
    raw = await request.body()
    if not _verify_signature(raw, request.headers.get('x-openwa-signature', '')):
        logger.warning('whatsapp webhook: signature check failed')
        return Response(status_code=401, content='{"error":"invalid signature"}', media_type='application/json')
    try:
        payload = json.loads(raw)
    except Exception:
        return Response(status_code=400, content='{"error":"bad json"}', media_type='application/json')

    if payload.get('event') != 'message.received':
        return {'ok': True, 'skipped': 'not a message event'}

    data = payload.get('data') or {}
    # Defense in depth — the registered webhook is already filtered to
    # isGroup=false/fromMe=false/type=text, but a filter is never the only
    # boundary against a misconfigured or future-edited subscription.
    if data.get('isGroup') or data.get('fromMe') or data.get('type') != 'text':
        return {'ok': True, 'skipped': 'not a plain 1:1 text message'}

    wa = await db.settings.find_one({'id': 'whatsapp'}, {'_id': 0}) or {}
    if not wa.get('enabled', True) or not wa.get('chatbot_enabled', False):
        return {'ok': True, 'skipped': 'chatbot disabled'}

    chat_id = data.get('author') or data.get('from') or ''
    body_text = (data.get('body') or '').strip().lower()
    if not chat_id or not body_text:
        return {'ok': True, 'skipped': 'no sender/body'}

    if 'rate' in body_text:
        reply = await _rate_reply()
    elif 'status' in body_text:
        # `chat_id` is not always a `<digits>@c.us` phone JID — WhatsApp's
        # privacy-id rollout means an unsaved contact often arrives as an
        # opaque `<digits>@lid` instead, whose digits are NOT a phone number.
        # Resolve properly rather than guessing from the id's own digits.
        phone = await resolve_whatsapp_phone(chat_id)
        digits = ''.join(c for c in (phone or chat_id) if c.isdigit())
        reply = await _status_reply(digits[-10:] if len(digits) >= 10 else digits)
    else:
        reply = HELP_TEXT

    ok = await send_whatsapp_raw(chat_id, reply)
    if not ok:
        logger.warning(f'whatsapp bot: reply send failed to {chat_id}')
    return {'ok': True}
