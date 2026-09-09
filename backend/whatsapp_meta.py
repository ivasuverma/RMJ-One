"""Official WhatsApp Business Platform (Meta Cloud API) — a second,
independent send path built alongside the OpenWA gateway (see server.py's
send_whatsapp/send_whatsapp_channel), ahead of an eventual migration off
OpenWA (2026-09-09: "we will switch to it some day"). Deliberately uses a
different phone number while the two are evaluated side by side — OpenWA
keeps running unchanged on the shop's existing number
(919781800888) and nothing here touches it.

Credentials live in backend/.env (not committed), same convention as
OPENWA_API_KEY/WHATSAPP_WEBHOOK_SECRET — see Settings > WhatsApp's "Official
WhatsApp (Meta)" panel for a live configured/connected check once these are
filled in:

  META_WA_PHONE_NUMBER_ID      - the Cloud API phone number's numeric id
                                  (Meta for Developers > your app > WhatsApp
                                  > API Setup)
  META_WA_WABA_ID              - the WhatsApp Business Account id (needed
                                  later for template management, not sends)
  META_WA_ACCESS_TOKEN         - a permanent token from a System User in
                                  Business Settings (Business Manager >
                                  Users > System Users), NOT the 24-hour
                                  temporary token API Setup shows by default
  META_WA_APP_SECRET           - the Meta app's own secret (App Dashboard >
                                  Settings > Basic) — used to verify inbound
                                  webhook deliveries are really from Meta
  META_WA_WEBHOOK_VERIFY_TOKEN - a token you invent yourself; Meta's
                                  one-time webhook-registration handshake
                                  echoes it back to prove you own the
                                  callback URL (see routers/whatsapp_meta_bot.py)
  META_GRAPH_API_VERSION       - optional, defaults below; Meta deprecates
                                  old Graph API versions roughly every 2
                                  years, so bump this without a code change
                                  when that comes due

IMPORTANT — a Cloud API rule OpenWA does not have: a business can only send
freeform text (send_text below) to a customer within the 24-hour customer
service window after that customer last messaged in. Anything the SHOP
initiates on its own outside that window — a gold-rate broadcast, a
"repair ready" notice — must use a pre-approved message TEMPLATE
(send_template below) instead, or Meta rejects the send (error 131047).
Get templates approved in Meta Business Manager > WhatsApp Manager >
Message Templates before relying on send_template with a new name."""
import hashlib
import hmac
import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger('whatsapp_meta')

GRAPH_API_VERSION = os.environ.get('META_GRAPH_API_VERSION', 'v21.0')
PHONE_NUMBER_ID = os.environ.get('META_WA_PHONE_NUMBER_ID', '')
WABA_ID = os.environ.get('META_WA_WABA_ID', '')
ACCESS_TOKEN = os.environ.get('META_WA_ACCESS_TOKEN', '')
APP_SECRET = os.environ.get('META_WA_APP_SECRET', '')
WEBHOOK_VERIFY_TOKEN = os.environ.get('META_WA_WEBHOOK_VERIFY_TOKEN', '')

GRAPH_BASE = f'https://graph.facebook.com/{GRAPH_API_VERSION}'


def is_configured() -> bool:
    return bool(PHONE_NUMBER_ID and ACCESS_TOKEN)


def _to_e164_digits(mobile: str) -> Optional[str]:
    """Same 10-digit-Indian-number assumption as server.py's own
    _to_whatsapp_chat_id, but the Cloud API wants bare digits with country
    code — no '@c.us' suffix, no '+'."""
    digits = ''.join(c for c in (mobile or '') if c.isdigit())
    if not digits:
        return None
    if len(digits) == 10:
        digits = '91' + digits
    elif len(digits) == 11 and digits.startswith('0'):
        digits = '91' + digits[1:]
    if len(digits) < 11:
        return None
    return digits


async def get_status() -> dict:
    """Configured/connected check for Settings > WhatsApp's Meta panel,
    same shape as server.py's get_whatsapp_status() for OpenWA.
    'connected' here means the Graph API actually accepted a call for this
    phone number id with the stored token — the closest equivalent to
    OpenWA's session 'ready'."""
    if not is_configured():
        return {'configured': False, 'connected': False, 'phone': None, 'display_name': None}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                f'{GRAPH_BASE}/{PHONE_NUMBER_ID}',
                params={'fields': 'display_phone_number,verified_name,code_verification_status'},
                headers={'Authorization': f'Bearer {ACCESS_TOKEN}'},
            )
            if res.status_code != 200:
                logger.warning(f'meta whatsapp status check failed: {res.status_code} {res.text[:200]}')
                return {'configured': True, 'connected': False, 'phone': None, 'display_name': None}
            data = res.json()
            return {
                'configured': True, 'connected': True,
                'phone': data.get('display_phone_number'), 'display_name': data.get('verified_name'),
            }
    except Exception as e:
        logger.warning(f'meta whatsapp status check failed: {e}')
        return {'configured': True, 'connected': False, 'phone': None, 'display_name': None}


async def _send(payload: dict) -> tuple[bool, Optional[str], str]:
    """Returns (ok, wa_message_id, error) — the message id (once Meta
    accepts the API call) is what a later delivery-status webhook uses to
    find and update this same send's logged entry, and the error string is
    what actually explains a failure (e.g. the 131047 24-hour-window
    rejection) instead of just a bare False."""
    if not is_configured():
        logger.warning('meta whatsapp send skipped: not configured')
        return False, None, 'not configured'
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                f'{GRAPH_BASE}/{PHONE_NUMBER_ID}/messages',
                headers={'Authorization': f'Bearer {ACCESS_TOKEN}', 'Content-Type': 'application/json'},
                json=payload,
            )
            if res.status_code == 200:
                data = res.json()
                msg_id = ((data.get('messages') or [{}])[0]).get('id')
                return True, msg_id, ''
            logger.warning(f'meta whatsapp send failed: {res.status_code} {res.text[:300]}')
            return False, None, res.text[:300]
    except Exception as e:
        logger.warning(f'meta whatsapp send failed: {e}')
        return False, None, str(e)


async def send_text(mobile: str, text: str, flow: str = '') -> bool:
    """Freeform text — only actually deliverable inside the 24-hour
    customer-service window (see module docstring). Fine for manual testing
    (message the test number first, then send back), not for anything
    business-initiated — use send_template for that."""
    from server import log_whatsapp_message
    to = _to_e164_digits(mobile)
    if not to:
        await log_whatsapp_message('meta', mobile, 'text', text, False, flow, error='invalid or missing mobile number')
        return False
    ok, msg_id, error = await _send({'messaging_product': 'whatsapp', 'to': to, 'type': 'text', 'text': {'body': text}})
    await log_whatsapp_message('meta', to, 'text', text, ok, flow, error=error, wa_message_id=msg_id)
    return ok


async def send_template(mobile: str, template_name: str, language_code: str = 'en', body_params: Optional[list] = None, flow: str = '') -> bool:
    """Sends an already-approved message template — the only way to reach a
    customer outside the 24-hour window. body_params, if given, fill the
    template's {{1}}, {{2}}... placeholders in order, as plain text."""
    from server import log_whatsapp_message
    to = _to_e164_digits(mobile)
    if not to:
        await log_whatsapp_message('meta', mobile, 'template', template_name, False, flow, error='invalid or missing mobile number')
        return False
    template: dict = {'name': template_name, 'language': {'code': language_code}}
    if body_params:
        template['components'] = [{
            'type': 'body',
            'parameters': [{'type': 'text', 'text': str(p)} for p in body_params],
        }]
    ok, msg_id, error = await _send({'messaging_product': 'whatsapp', 'to': to, 'type': 'template', 'template': template})
    await log_whatsapp_message('meta', to, 'template', template_name, ok, flow, error=error, wa_message_id=msg_id)
    return ok


def verify_webhook_signature(raw_body: bytes, signature_header: str) -> bool:
    """Meta signs webhook deliveries with the APP SECRET (not a token you
    invent, unlike WHATSAPP_WEBHOOK_SECRET on the OpenWA side) —
    'X-Hub-Signature-256: sha256=<hex>' over the raw request body."""
    if not APP_SECRET or not signature_header or not signature_header.startswith('sha256='):
        return False
    expected = hmac.new(APP_SECRET.encode('utf-8'), raw_body, hashlib.sha256).hexdigest()
    got = signature_header.split('=', 1)[1]
    return hmac.compare_digest(expected, got)
