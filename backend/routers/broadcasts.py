"""Broadcast lists and in-app templates (Work > Rate Broadcast).

Lists — named groups of people ("Bridal enquiries", "VIP") on top of the
built-in daily / customer lists. A person is one rate_subscribers record
(so STOP anywhere is honoured everywhere); membership is its `lists` array.
Someone added only through a custom list gets plan 'none', so they don't
join the rate broadcasts unless they ask.

Templates — built in the app, submitted to Meta for approval, then sent to
any list through the same paced queue as the rate (rate_broadcast.py's
start_broadcast / _drain_once). Kinds:
  text      body (+ optional {{1}} = customer name) and buttons
  image     a photo on top, body and buttons
  carousel  body, then 2–10 swipeable cards (photo + caption + one button)
Buttons: quick reply (taps are counted per send and can get an automatic
reply), website link, call. All MARKETING category.

Photos are stored here and served publicly (Meta fetches them by URL when
sending); a sample of each is uploaded to Meta for review."""
import asyncio
import base64
import re
import uuid
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel

from server import db, log_audit, now_utc
from routers.rate_broadcast import PUBLIC_API, norm_mobile, parse_contacts, require_broadcast

router = APIRouter()

MAX_LISTS = 30
MAX_TEMPLATES = 50
_MAX_UPLOAD = 15 * 1024 * 1024


# ---------------- media ----------------
def media_url(media_id: str) -> str:
    return f'{PUBLIC_API}/api/public/broadcast-media/{media_id}'


@router.post('/broadcasts/media')
async def upload_media(file: UploadFile = File(...), user: dict = Depends(require_broadcast)):
    from routers.documents import _make_view_sync
    raw = await file.read()
    if not raw or len(raw) > _MAX_UPLOAD:
        raise HTTPException(status_code=400, detail='Pick a photo under 15 MB')
    jpeg = await asyncio.to_thread(_make_view_sync, raw)
    if not jpeg:
        raise HTTPException(status_code=400, detail="That file isn't a photo we can read (use JPG or PNG).")
    if len(jpeg) > 4_800_000:
        raise HTTPException(status_code=400, detail='Photo is too large for WhatsApp even after resizing.')
    mid = str(uuid.uuid4())
    await db.broadcast_media.insert_one({'id': mid, 'image': base64.b64encode(jpeg).decode('ascii'),
                                         'created_at': now_utc().isoformat(), 'created_by': user.get('name')})
    return {'id': mid, 'url': media_url(mid)}


@router.get('/public/broadcast-media/{media_id}')
async def public_media(media_id: str):
    m = await db.broadcast_media.find_one({'id': media_id}, {'_id': 0, 'image': 1})
    if not m or not m.get('image'):
        raise HTTPException(status_code=404, detail='Not found')
    return Response(content=base64.b64decode(m['image']), media_type='image/jpeg',
                    headers={'Cache-Control': 'public, max-age=2592000, immutable'})


async def _media_bytes(media_id: str) -> bytes:
    m = await db.broadcast_media.find_one({'id': media_id}, {'_id': 0, 'image': 1})
    if not m:
        raise HTTPException(status_code=400, detail='A photo is missing — add it again')
    return base64.b64decode(m['image'])


# ---------------- lists ----------------
async def _get_list(lid: str) -> dict:
    lst = await db.broadcast_lists.find_one({'id': lid}, {'_id': 0})
    if not lst:
        raise HTTPException(status_code=404, detail='List not found')
    return lst


@router.get('/broadcasts/lists')
async def get_lists(_: dict = Depends(require_broadcast)):
    lists = await db.broadcast_lists.find({}, {'_id': 0}).sort('created_at', 1).to_list(MAX_LISTS)
    for lst in lists:
        lst['count'] = await db.rate_subscribers.count_documents({'status': 'active', 'lists': lst['id']})
    return lists


class ListIn(BaseModel):
    name: str


@router.post('/broadcasts/lists')
async def create_list(body: ListIn, user: dict = Depends(require_broadcast)):
    name = body.name.strip()[:40]
    if not name:
        raise HTTPException(status_code=400, detail='Give the list a name')
    if await db.broadcast_lists.count_documents({}) >= MAX_LISTS:
        raise HTTPException(status_code=400, detail=f'Up to {MAX_LISTS} lists — delete one first.')
    if await db.broadcast_lists.find_one({'name': {'$regex': f'^{re.escape(name)}$', '$options': 'i'}}):
        raise HTTPException(status_code=400, detail='There is already a list with that name')
    doc = {'id': str(uuid.uuid4()), 'name': name, 'created_at': now_utc().isoformat(), 'created_by': user.get('name')}
    await db.broadcast_lists.insert_one(dict(doc))
    await log_audit(user, 'broadcast.list.create', 'broadcast_list', doc['id'], name)
    return {**doc, 'count': 0}


@router.patch('/broadcasts/lists/{lid}')
async def rename_list(lid: str, body: ListIn, user: dict = Depends(require_broadcast)):
    await _get_list(lid)
    name = body.name.strip()[:40]
    if not name:
        raise HTTPException(status_code=400, detail='Give the list a name')
    await db.broadcast_lists.update_one({'id': lid}, {'$set': {'name': name}})
    return {**(await _get_list(lid)), 'count': await db.rate_subscribers.count_documents({'status': 'active', 'lists': lid})}


@router.delete('/broadcasts/lists/{lid}')
async def delete_list(lid: str, user: dict = Depends(require_broadcast)):
    lst = await _get_list(lid)
    await db.rate_subscribers.update_many({'lists': lid}, {'$pull': {'lists': lid}})
    # People who were only here (plan 'none', no other list) are dropped; opted-out records stay.
    await db.rate_subscribers.delete_many({'plan': 'none', 'status': 'active', 'lists': {'$size': 0}})
    await db.broadcast_lists.delete_one({'id': lid})
    await log_audit(user, 'broadcast.list.delete', 'broadcast_list', lid, lst['name'])
    return {'ok': True}


async def _add_to_list(lid: str, mobile: str, name: str, source: str) -> str:
    """'added' | 'already' | 'opted_out'. Never re-subscribes someone who said STOP."""
    ex = await db.rate_subscribers.find_one({'mobile': mobile}, {'_id': 0, 'id': 1, 'status': 1, 'lists': 1, 'name': 1})
    if ex:
        if ex.get('status') == 'opted_out':
            return 'opted_out'
        if lid in (ex.get('lists') or []):
            return 'already'
        upd: dict = {'$addToSet': {'lists': lid}}
        if name and not ex.get('name'):
            upd['$set'] = {'name': name}
        await db.rate_subscribers.update_one({'id': ex['id']}, upd)
        return 'added'
    await db.rate_subscribers.insert_one({'id': str(uuid.uuid4()), 'name': name, 'mobile': mobile, 'status': 'active',
                                          'plan': 'none', 'lists': [lid], 'source': source, 'added_at': now_utc().isoformat()})
    return 'added'


@router.post('/broadcasts/lists/{lid}/import')
async def import_into_list(lid: str, file: UploadFile = File(...), user: dict = Depends(require_broadcast)):
    lst = await _get_list(lid)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail='Empty file')
    try:
        rows = parse_contacts(file.filename or '', raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Couldn't read that file — upload an Excel (.xlsx) or CSV list with name and mobile columns.")
    out = {'added': 0, 'already': 0, 'opted_out': 0, 'invalid': 0}
    seen = set()
    for r in rows:
        m = norm_mobile(r['mobile_raw'])
        if not m:
            out['invalid'] += 1
            continue
        if m in seen:
            continue
        seen.add(m)
        out[await _add_to_list(lid, m, r['name'], 'import')] += 1
    await log_audit(user, 'broadcast.list.import', 'broadcast_list', lid, f"{lst['name']}: {out['added']} added")
    return out


class MemberIn(BaseModel):
    mobile: str
    name: str = ''


@router.post('/broadcasts/lists/{lid}/members')
async def add_member(lid: str, body: MemberIn, user: dict = Depends(require_broadcast)):
    await _get_list(lid)
    m = norm_mobile(body.mobile)
    if not m:
        raise HTTPException(status_code=400, detail='Enter a valid 10-digit mobile number')
    res = await _add_to_list(lid, m, body.name.strip()[:60], 'manual')
    if res == 'opted_out':
        raise HTTPException(status_code=400, detail='This customer replied STOP — they can’t be added back.')
    if res == 'already':
        raise HTTPException(status_code=400, detail='Already on this list')
    return {'ok': True}


@router.delete('/broadcasts/lists/{lid}/members/{sid}')
async def remove_member(lid: str, sid: str, user: dict = Depends(require_broadcast)):
    s = await db.rate_subscribers.find_one({'id': sid}, {'_id': 0})
    if not s:
        raise HTTPException(status_code=404, detail='Not found')
    await db.rate_subscribers.update_one({'id': sid}, {'$pull': {'lists': lid}})
    if s.get('plan') == 'none' and s.get('status') == 'active' and set(s.get('lists') or []) <= {lid}:
        await db.rate_subscribers.delete_one({'id': sid})
    return {'ok': True}


# ---------------- templates ----------------
class ButtonIn(BaseModel):
    type: Literal['quick_reply', 'url', 'phone']
    text: str
    url: Optional[str] = None
    phone: Optional[str] = None


class CardIn(BaseModel):
    media_id: str
    body: str
    button: ButtonIn


class TemplateIn(BaseModel):
    label: str
    kind: Literal['text', 'image', 'carousel']
    body: str
    media_id: Optional[str] = None           # image kind
    buttons: List[ButtonIn] = []             # text / image kinds
    cards: List[CardIn] = []                 # carousel kind
    ack_text: str = ''                       # automatic reply when someone taps a quick reply


def _clean_button(b: ButtonIn) -> dict:
    text = b.text.strip()
    if not text or len(text) > 25:
        raise HTTPException(status_code=400, detail='Button labels need 1–25 characters')
    out = {'type': b.type, 'text': text}
    if b.type == 'url':
        url = (b.url or '').strip()
        if not re.match(r'^https?://\S+$', url):
            raise HTTPException(status_code=400, detail=f'“{text}”: enter a website link starting with https://')
        out['url'] = url
    if b.type == 'phone':
        digits = re.sub(r'\D', '', b.phone or '')
        if len(digits) == 10:
            digits = '91' + digits
        if len(digits) < 11:
            raise HTTPException(status_code=400, detail=f'“{text}”: enter a phone number')
        out['phone'] = '+' + digits
    return out


def _graph_button(b: dict) -> dict:
    if b['type'] == 'url':
        return {'type': 'URL', 'text': b['text'], 'url': b['url']}
    if b['type'] == 'phone':
        return {'type': 'PHONE_NUMBER', 'text': b['text'], 'phone_number': b['phone']}
    return {'type': 'QUICK_REPLY', 'text': b['text']}


def _validate(body: TemplateIn) -> dict:
    label = body.label.strip()[:60]
    if not label:
        raise HTTPException(status_code=400, detail='Give the template a name')
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=400, detail='Write the message text')
    if len(text) > 1024:
        raise HTTPException(status_code=400, detail='Keep the message under 1,024 characters')
    uses_name = '{{1}}' in text
    if re.search(r'\{\{(?!1\}\})[^}]*\}\}', text):
        raise HTTPException(status_code=400, detail='Only {{1}} (the customer’s name) can be used in the text')
    if uses_name and (text.startswith('{{1}}') or text.endswith('{{1}}')):
        raise HTTPException(status_code=400, detail='Meta doesn’t allow the message to start or end with the customer’s name — add a word before/after it')
    doc = {'label': label, 'kind': body.kind, 'body': text, 'uses_name': uses_name, 'ack_text': body.ack_text.strip()[:500],
           'media_id': None, 'buttons': [], 'cards': []}
    if body.kind in ('text', 'image'):
        if len(body.buttons) > 3:
            raise HTTPException(status_code=400, detail='Up to 3 buttons')
        doc['buttons'] = [_clean_button(b) for b in body.buttons]
        if sum(1 for b in doc['buttons'] if b['type'] == 'phone') > 1:
            raise HTTPException(status_code=400, detail='Only one Call button')
        if body.kind == 'image':
            if not body.media_id:
                raise HTTPException(status_code=400, detail='Add the photo')
            doc['media_id'] = body.media_id
    else:
        if not 2 <= len(body.cards) <= 10:
            raise HTTPException(status_code=400, detail='Scrollable photos need 2 to 10 cards')
        cards = []
        for i, c in enumerate(body.cards, 1):
            cb = c.body.strip()
            if not cb or len(cb) > 160:
                raise HTTPException(status_code=400, detail=f'Card {i}: caption needs 1–160 characters')
            cards.append({'media_id': c.media_id, 'body': cb, 'button': _clean_button(c.button)})
        if len({c['button']['type'] for c in cards}) > 1:
            raise HTTPException(status_code=400, detail='Every card’s button must be the same kind (all quick replies, all links or all calls)')
        doc['cards'] = cards
    return doc


def _slug(label: str) -> str:
    s = re.sub(r'[^a-z0-9]+', '_', label.lower()).strip('_')[:30] or 'template'
    return f'rmj_{s}_{uuid.uuid4().hex[:6]}'


async def _graph_components(doc: dict) -> list:
    """Creation components for Meta, uploading each photo as a review sample."""
    import whatsapp_meta
    comps: list = []

    async def handle(media_id: str) -> str:
        up = await whatsapp_meta.upload_example_media(await _media_bytes(media_id))
        if not up['ok']:
            raise HTTPException(status_code=502, detail=f"Couldn't upload a photo to Meta: {up['error']}")
        return up['handle']

    body = {'type': 'BODY', 'text': doc['body']}
    if doc['uses_name']:
        body['example'] = {'body_text': [['Rahul']]}
    if doc['kind'] == 'image':
        comps.append({'type': 'HEADER', 'format': 'IMAGE', 'example': {'header_handle': [await handle(doc['media_id'])]}})
    comps.append(body)
    if doc['kind'] in ('text', 'image') and doc['buttons']:
        comps.append({'type': 'BUTTONS', 'buttons': [_graph_button(b) for b in doc['buttons']]})
    if doc['kind'] == 'carousel':
        cards = []
        for c in doc['cards']:
            cards.append({'components': [
                {'type': 'HEADER', 'format': 'IMAGE', 'example': {'header_handle': [await handle(c['media_id'])]}},
                {'type': 'BODY', 'text': c['body']},
                {'type': 'BUTTONS', 'buttons': [_graph_button(c['button'])]},
            ]})
        comps.append({'type': 'CAROUSEL', 'cards': cards})
    return comps


def send_components(tpl: dict, name: str) -> list:
    """Per-recipient send components for a custom template snapshot."""
    comps: list = []
    if tpl['kind'] == 'image':
        comps.append({'type': 'header', 'parameters': [{'type': 'image', 'image': {'link': media_url(tpl['media_id'])}}]})
    if tpl.get('uses_name'):
        comps.append({'type': 'body', 'parameters': [{'type': 'text', 'text': name}]})
    if tpl['kind'] in ('text', 'image'):
        for i, b in enumerate(tpl.get('buttons') or []):
            if b['type'] == 'quick_reply':
                comps.append({'type': 'button', 'sub_type': 'quick_reply', 'index': str(i),
                              'parameters': [{'type': 'payload', 'payload': b['text']}]})
    if tpl['kind'] == 'carousel':
        cards = []
        for i, c in enumerate(tpl['cards']):
            cc = [{'type': 'header', 'parameters': [{'type': 'image', 'image': {'link': media_url(c['media_id'])}}]}]
            if c['button']['type'] == 'quick_reply':
                cc.append({'type': 'button', 'sub_type': 'quick_reply', 'index': '0',
                           'parameters': [{'type': 'payload', 'payload': c['button']['text']}]})
            cards.append({'card_index': i, 'components': cc})
        comps.append({'type': 'carousel', 'cards': cards})
    return comps


def _out(t: dict) -> dict:
    t = {k: v for k, v in t.items() if k != '_id'}
    if t.get('media_id'):
        t['media_url'] = media_url(t['media_id'])
    for c in t.get('cards') or []:
        c['media_url'] = media_url(c['media_id'])
    return t


async def _refresh_status(t: dict) -> dict:
    import whatsapp_meta
    if t.get('status') in ('APPROVED', 'REJECTED', 'DELETED'):
        return t
    st = await whatsapp_meta.template_status(t['name'])
    if st.get('exists'):
        upd = {'status': st.get('status'), 'reason': st.get('reason')}
        await db.broadcast_templates.update_one({'id': t['id']}, {'$set': upd})
        t = {**t, **upd}
    return t


@router.get('/broadcasts/templates')
async def list_templates(_: dict = Depends(require_broadcast)):
    out = []
    for t in await db.broadcast_templates.find({}, {'_id': 0}).sort('created_at', -1).to_list(MAX_TEMPLATES):
        out.append(_out(await _refresh_status(t)))
    return out


@router.post('/broadcasts/templates')
async def create_template(body: TemplateIn, user: dict = Depends(require_broadcast)):
    import whatsapp_meta
    doc = _validate(body)
    for mid in [doc['media_id']] + [c['media_id'] for c in doc['cards']]:
        if mid:
            await _media_bytes(mid)
    if not whatsapp_meta.is_configured():
        raise HTTPException(status_code=400, detail='The official WhatsApp (Meta) number is not set up yet.')
    if await db.broadcast_templates.count_documents({}) >= MAX_TEMPLATES:
        raise HTTPException(status_code=400, detail=f'Up to {MAX_TEMPLATES} templates — delete one first.')
    name = _slug(doc['label'])
    res = await whatsapp_meta.create_template_components(name, await _graph_components(doc))
    if not res['ok']:
        raise HTTPException(status_code=502, detail=f"Meta didn't accept it: {res['error']}")
    doc.update({'id': str(uuid.uuid4()), 'name': name, 'status': res.get('status') or 'PENDING', 'reason': None,
                'meta_id': res.get('id'), 'created_at': now_utc().isoformat(), 'created_by': user.get('name')})
    await db.broadcast_templates.insert_one(dict(doc))
    await log_audit(user, 'broadcast.template.create', 'broadcast_template', doc['id'], doc['label'])
    return _out(doc)


@router.post('/broadcasts/templates/{tid}/refresh')
async def refresh_template(tid: str, _: dict = Depends(require_broadcast)):
    t = await db.broadcast_templates.find_one({'id': tid}, {'_id': 0})
    if not t:
        raise HTTPException(status_code=404, detail='Template not found')
    t['status'] = t.get('status') if t.get('status') == 'APPROVED' else 'PENDING'
    return _out(await _refresh_status(t))


@router.delete('/broadcasts/templates/{tid}')
async def delete_template(tid: str, user: dict = Depends(require_broadcast)):
    import whatsapp_meta
    t = await db.broadcast_templates.find_one({'id': tid}, {'_id': 0})
    if not t:
        raise HTTPException(status_code=404, detail='Template not found')
    if await db.rate_broadcasts.find_one({'status': 'sending', 'template_id': tid}):
        raise HTTPException(status_code=400, detail='A send with this template is still going — stop it first.')
    await whatsapp_meta.delete_template(t['name'])  # best-effort: gone here even if Meta already removed it
    await db.broadcast_templates.delete_one({'id': tid})
    await log_audit(user, 'broadcast.template.delete', 'broadcast_template', tid, t['label'])
    return {'ok': True}


# ---------------- taps on quick-reply buttons ----------------
async def record_tap(msg: dict) -> Optional[str]:
    """A quick-reply tap on one of our templates: count it against the send it
    came from (the tapped message's wamid → whatsapp_messages flow) and return
    that template's automatic reply, if it has one."""
    ctx_id = (msg.get('context') or {}).get('id')
    text = (msg.get('button') or {}).get('text') or (msg.get('button') or {}).get('payload') or ''
    if not ctx_id or not text:
        return None
    wm = await db.whatsapp_messages.find_one({'wa_message_id': ctx_id}, {'_id': 0, 'flow': 1})
    flow = (wm or {}).get('flow') or ''
    if not flow.startswith('rate_broadcast:'):
        return None
    job_id = flow.split(':', 1)[1]
    mobile = norm_mobile(msg.get('from') or '') or (msg.get('from') or '')
    await db.broadcast_responses.update_one(
        {'job_id': job_id, 'mobile': mobile},
        {'$set': {'job_id': job_id, 'mobile': mobile, 'text': text[:40], 'at': now_utc().isoformat()}}, upsert=True)
    job = await db.rate_broadcasts.find_one({'id': job_id}, {'_id': 0, 'template': 1})
    return ((job or {}).get('template') or {}).get('ack_text') or None


async def response_counts(job_id: str) -> dict:
    out: dict = {}
    async for r in db.broadcast_responses.find({'job_id': job_id}, {'_id': 0, 'text': 1}):
        out[r['text']] = out.get(r['text'], 0) + 1
    return out


async def approved_template(tid: str) -> dict:
    """Snapshot of an approved template for a send (edits/deletes later don't touch a running send)."""
    t = await db.broadcast_templates.find_one({'id': tid}, {'_id': 0})
    if not t:
        raise HTTPException(status_code=404, detail='Template not found')
    t = await _refresh_status(t)
    if t.get('status') != 'APPROVED':
        raise HTTPException(status_code=400, detail=f"“{t['label']}” is not approved by Meta yet.")
    return t
