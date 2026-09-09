"""Webhook receiver for the official WhatsApp Business Platform (Meta Cloud
API) test line — separate from routers/whatsapp_bot.py, which handles
OpenWA's inbound bot on the shop's live number. Handles Meta's one-time GET
verification handshake and POST event deliveries.

Currently just logs inbound events — no auto-reply wired up here yet, since
this number is a side-by-side test line while the app is evaluated, not a
customer-facing channel. Register the callback URL (this box's public
address + /webhooks/whatsapp-meta) and META_WA_WEBHOOK_VERIFY_TOKEN in Meta
Business Manager > WhatsApp > Configuration > Webhooks once the test number
is set up."""
import logging

from fastapi import APIRouter, Request, Response

from whatsapp_meta import verify_webhook_signature, WEBHOOK_VERIFY_TOKEN

router = APIRouter()
logger = logging.getLogger('whatsapp_meta_bot')


@router.get('/webhooks/whatsapp-meta')
async def verify(request: Request):
    """Meta's one-time handshake when you register the callback URL: it
    GETs this URL with hub.mode=subscribe, hub.verify_token=<whatever you
    entered there>, and hub.challenge=<random string>. Echo the challenge
    back verbatim if the token matches, else refuse."""
    params = request.query_params
    if WEBHOOK_VERIFY_TOKEN and params.get('hub.mode') == 'subscribe' and params.get('hub.verify_token') == WEBHOOK_VERIFY_TOKEN:
        return Response(content=params.get('hub.challenge', ''), media_type='text/plain')
    logger.warning('whatsapp-meta webhook: verification handshake failed')
    return Response(status_code=403, content='verification failed')


@router.post('/webhooks/whatsapp-meta')
async def receive(request: Request):
    raw = await request.body()
    if not verify_webhook_signature(raw, request.headers.get('x-hub-signature-256', '')):
        logger.warning('whatsapp-meta webhook: signature check failed')
        return Response(status_code=401, content='{"error":"invalid signature"}', media_type='application/json')
    try:
        payload = await request.json()
    except Exception:
        return Response(status_code=400, content='{"error":"bad json"}', media_type='application/json')
    logger.info(f'whatsapp-meta webhook received: {payload}')
    return {'ok': True}
