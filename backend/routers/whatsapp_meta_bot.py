"""Webhook receiver for the official WhatsApp Business Platform (Meta Cloud
API) number, which is used only for Rate Broadcast — separate from
routers/whatsapp_bot.py, which handles OpenWA's inbound bot on the shop's
live number. Handles Meta's one-time GET verification handshake and POST
event deliveries.

Inbound START / DAILY / WEEKLY / STOP (and the "Stop updates" button) manage
the broadcast lists (see routers/rate_broadcast.py). It also matches
every delivery-status update (sent/delivered/read/failed)
against the whatsapp_messages doc server.py's log_whatsapp_message() wrote
for that send (matched by wa_message_id), and fill in its real outcome —
this is how Settings > WhatsApp Messages shows Meta sends' actual delivery
status, not just "the API call succeeded." Register the callback URL (this
box's public address + /webhooks/whatsapp-meta) and
META_WA_WEBHOOK_VERIFY_TOKEN in Meta Business Manager > WhatsApp >
Configuration > Webhooks once the test number is set up."""
import logging

from fastapi import APIRouter, Request, Response

from whatsapp_meta import verify_webhook_signature, WEBHOOK_VERIFY_TOKEN

router = APIRouter()
logger = logging.getLogger('whatsapp_meta_bot')


async def _apply_status_updates(payload: dict) -> None:
    from server import db
    for entry in payload.get('entry') or []:
        for change in entry.get('changes') or []:
            value = change.get('value') or {}
            for status in value.get('statuses') or []:
                wamid = status.get('id')
                new_status = status.get('status')
                if not wamid or not new_status:
                    continue
                error = ''
                errs = status.get('errors') or []
                if errs:
                    e = errs[0]
                    error = e.get('error_data', {}).get('details') or e.get('message') or e.get('title') or ''
                try:
                    await db.whatsapp_messages.update_one(
                        {'wa_message_id': wamid},
                        {'$set': {'status': new_status, 'status_error': error or None}},
                    )
                except Exception as e:
                    logger.warning(f'whatsapp-meta status update failed: {e}')


async def _stop_start_replies(payload: dict) -> None:
    """Rate-update subscriptions (routers/rate_broadcast.py): START/DAILY,
    WEEKLY, STOP, and the template's "Stop updates" quick-reply button.
    Always honoured, whatever the chatbot or active-provider settings — an
    opt-out must never be ignored."""
    from routers.rate_broadcast import handle_subscribe_reply
    import whatsapp_meta
    for entry in payload.get('entry') or []:
        for change in entry.get('changes') or []:
            for msg in (change.get('value') or {}).get('messages') or []:
                if msg.get('type') == 'text':
                    text = (msg.get('text') or {}).get('body') or ''
                elif msg.get('type') == 'button':  # quick-reply tap on a template
                    text = (msg.get('button') or {}).get('text') or ''
                else:
                    continue
                reply = await handle_subscribe_reply(msg.get('from') or '', text)
                if reply:
                    await whatsapp_meta.send_text(msg['from'], reply, flow='rate_broadcast_optin')


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
    await _apply_status_updates(payload)
    try:
        await _stop_start_replies(payload)
    except Exception as e:
        logger.warning(f'whatsapp-meta STOP/START handling failed: {e}')
    return {'ok': True}
