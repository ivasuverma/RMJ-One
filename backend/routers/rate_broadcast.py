"""Rate broadcast — today's gold/silver rate sent on WhatsApp as an approved
Meta MARKETING template: a photo on top, the rate, a link to rmj.co.in, and
buttons (See live rates / Call the shop / Stop updates). Goes out on the
official Meta number, which is used for nothing else — every other WhatsApp
message stays on OpenWA, whose shop number a bulk send could get banned.

Two lists, one Rate Subscribers collection (kept apart from the repair
Customers, which each mirror into the ledger), split by `plan`:
  daily  — people who asked: sent START/DAILY to the Meta number (the
           website's "Get the daily rate on WhatsApp" button pre-fills it).
           Sent every day at `daily_time`.
  weekly — the shop's imported customer list (Excel/CSV), or anyone who
           replied WEEKLY. Sent once a week at `weekday`/`time`.
STOP (or the Stop updates button) opts out for good; an import never
re-subscribes someone who opted out.

Sending is paced: a broadcast is a queue of recipients drained by
broadcast_loop() a few at a time, never more than `daily_limit` a day in
total (Meta caps how many different people a number may message per day;
new numbers start at 250). Anything over the cap carries on the next day,
and a scheduled send replaces a still-unfinished one for the same list so
nobody gets a stale rate."""
import asyncio
import base64
import csv
import io
import logging
import os
import pathlib
import re
import uuid
import zipfile
from typing import List, Literal, Optional
from xml.etree import ElementTree

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel

from server import IST, db, get_current, log_audit, now_utc, resolve_modules

router = APIRouter()


def require_broadcast(user=Depends(get_current)):
    """Owner, or anyone the owner gave the Rate Broadcast module (Settings › Users)."""
    if user.get('role') == 'owner' or 'rate_broadcast' in resolve_modules(user):
        return user
    raise HTTPException(status_code=403, detail='No access to "Rate Broadcast"')
logger = logging.getLogger('rate_broadcast')

TEMPLATE_NAME = 'rmj_rate_update'
TEMPLATE_LANG = 'en'
# Meta rejects a body that starts or ends with a variable.
TEMPLATE_BODY = (
    'Namaste {{1}},\n\n'
    "Today's rates at Ram Murti Jewellers, Ludhiana:\n"
    'Gold (995, 10 g): Rs. {{2}}\n'
    'Silver (999, 1 kg): Rs. {{3}}\n\n'
    'Live rate anytime: https://rmj.co.in'
)
TEMPLATE_EXAMPLE = ['Rahul', '1,50,850', '2,35,500']
SHOP_PHONE = '+919781800888'
STOP_BUTTON = 'Stop updates'
TEMPLATE_BUTTONS = [
    {'type': 'URL', 'text': 'See live rates', 'url': 'https://rmj.co.in'},
    {'type': 'PHONE_NUMBER', 'text': 'Call the shop', 'phone_number': SHOP_PHONE},
    {'type': 'QUICK_REPLY', 'text': STOP_BUTTON},
]
DEFAULT_NAME = 'valued customer'
PUBLIC_API = os.environ.get('PUBLIC_API_URL', 'https://api.rmj.co.in').rstrip('/')
DEFAULT_PHOTO_URL = 'https://rmj.co.in/assets/photos/dsc_0033-YBg891rw9PtK9XaM.JPG'
DEFAULT_PHOTO_FILE = pathlib.Path(__file__).resolve().parents[2] / 'website' / 'assets' / 'photos' / 'dsc_0033-YBg891rw9PtK9XaM.JPG'

DEFAULTS = {'weekly_enabled': False, 'weekday': 0, 'time': '11:00',
            'daily_enabled': False, 'daily_time': '11:30', 'daily_skip_sunday': True, 'daily_limit': 250}
WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
PLANS = ('daily', 'weekly')
TICK_SEC = 20
PER_TICK = 20          # sends per loop tick, ~1 per second
SEND_GAP_SEC = 1.0


# ---------------- helpers ----------------
def norm_mobile(raw) -> Optional[str]:
    """10-digit Indian mobile, or None. Accepts +91 / 91 / 0 prefixes, spaces, dashes, and
    Excel's habit of turning numbers into floats ('9876543210.0')."""
    s = str(raw or '').strip()
    if re.fullmatch(r'\d+\.0+', s):
        s = s.split('.')[0]
    d = re.sub(r'\D', '', s)
    if len(d) == 12 and d.startswith('91'):
        d = d[2:]
    elif len(d) == 11 and d.startswith('0'):
        d = d[1:]
    return d if len(d) == 10 and d[0] in '6789' else None


def inr(n) -> str:
    """Indian digit grouping: 150850 -> '1,50,850'."""
    n = int(round(float(n)))
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        head = re.sub(r'(\d)(?=(\d\d)+$)', r'\1,', head)
        s = f'{head},{tail}'
    return ('-' if n < 0 else '') + s


def _xlsx_rows(raw: bytes) -> List[List[str]]:
    """First sheet of an .xlsx as rows of strings — stdlib only (the server
    deploy doesn't install new packages)."""
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        shared: List[str] = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ElementTree.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns):
                shared.append(''.join(t.text or '' for t in si.iter(f"{{{ns['m']}}}t")))
        sheets = sorted(n for n in z.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n))
        if not sheets:
            return []
        root = ElementTree.fromstring(z.read(sheets[0]))
    rows = []
    for r in root.iter(f"{{{ns['m']}}}row"):
        cells = {}
        for c in r.findall('m:c', ns):
            ref = c.get('r', '')
            col = 0
            for ch in re.match(r'[A-Z]*', ref).group(0):
                col = col * 26 + (ord(ch) - 64)
            t = c.get('t')
            v = c.find('m:v', ns)
            if t == 's' and v is not None:
                val = shared[int(v.text)]
            elif t == 'inlineStr':
                val = ''.join(x.text or '' for x in c.iter(f"{{{ns['m']}}}t"))
            else:
                val = v.text if v is not None else ''
            cells[max(col - 1, 0)] = (val or '').strip()
        if cells:
            rows.append([cells.get(i, '') for i in range(max(cells) + 1)])
    return rows


def parse_contacts(filename: str, raw: bytes) -> List[dict]:
    """[{name, mobile_raw}] from a CSV or Excel list. Finds the name and mobile
    columns by header ('name', 'mobile', 'phone', 'number', 'contact',
    'whatsapp'); without headers, the column that looks like phone numbers is
    the mobile and the first other column is the name."""
    if raw[:2] == b'PK' or filename.lower().endswith('.xlsx'):
        rows = _xlsx_rows(raw)
    else:
        text = raw.decode('utf-8-sig', errors='replace')
        rows = [[c.strip() for c in r] for r in csv.reader(io.StringIO(text))]
    rows = [r for r in rows if any(c for c in r)]
    if not rows:
        return []
    head = [c.lower() for c in rows[0]]
    mob_i = next((i for i, h in enumerate(head) if re.search(r'mobile|phone|number|contact|whatsapp|cell', h)), None)
    name_i = next((i for i, h in enumerate(head) if re.search(r'name', h) and i != mob_i), None)
    if mob_i is not None:
        body = rows[1:]
    else:
        body = rows
        width = max(len(r) for r in rows)
        scores = [sum(1 for r in rows if i < len(r) and norm_mobile(r[i])) for i in range(width)]
        mob_i = max(range(width), key=lambda i: scores[i])
        name_i = next((i for i in range(width) if i != mob_i), None)
    out = []
    for r in body:
        mob = r[mob_i] if mob_i < len(r) else ''
        name = r[name_i] if name_i is not None and name_i < len(r) else ''
        out.append({'name': name.strip()[:60], 'mobile_raw': mob})
    return out


async def get_settings() -> dict:
    doc = await db.settings.find_one({'id': 'rate_broadcast'}, {'_id': 0}) or {}
    out = {**DEFAULTS, **{k: doc[k] for k in DEFAULTS if k in doc}}
    out['last_weekly_date'] = doc.get('last_weekly_date') or doc.get('last_scheduled_date')
    out['last_daily_date'] = doc.get('last_daily_date')
    return out


async def current_rates() -> Optional[dict]:
    """Same rule as the chatbot's RATE reply: today's confirmed rate if there
    is one, else the background-refreshed live rate."""
    from gold_rate import today_ist
    conf = await db.settings.find_one({'id': 'gold_rate_today'}, {'_id': 0}) or {}
    if conf.get('confirmed') and conf.get('date') == today_ist() and conf.get('gold_rate') and conf.get('silver_rate'):
        return {'gold': conf['gold_rate'], 'silver': conf['silver_rate']}
    live = await db.settings.find_one({'id': 'gold_rate_live'}, {'_id': 0}) or {}
    if live.get('gold_rate') and live.get('silver_rate'):
        return {'gold': live['gold_rate'], 'silver': live['silver_rate']}
    return None


async def photo_url() -> str:
    """The photo on top of the message: the owner's uploaded one, else the
    shop showcase photo from the website. Meta fetches it by URL on send."""
    p = await db.settings.find_one({'id': 'rate_broadcast_photo'}, {'_id': 0, 'version': 1})
    if p and p.get('version'):
        return f"{PUBLIC_API}/api/public/rate-broadcast/photo?v={p['version']}"
    return DEFAULT_PHOTO_URL


def _plan_query(plan: str) -> dict:
    # Subscribers imported before plans existed have no 'plan' — they're the weekly list.
    return {'plan': 'daily'} if plan == 'daily' else {'plan': {'$ne': 'daily'}}


def _ist_day_start_utc_iso() -> str:
    now_ist = now_utc().astimezone(IST)
    start = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(now_utc().tzinfo).isoformat()


async def _sent_today() -> int:
    return await db.rate_broadcast_recipients.count_documents(
        {'state': {'$in': ['sent', 'failed']}, 'sent_at': {'$gte': _ist_day_start_utc_iso()}})


async def _stop_job(bid: str, status: str = 'stopped') -> int:
    res = await db.rate_broadcast_recipients.update_many({'broadcast_id': bid, 'state': 'pending'}, {'$set': {'state': 'cancelled'}})
    await db.rate_broadcasts.update_one({'id': bid}, {'$set': {'status': status, 'finished_at': now_utc().isoformat()}})
    return res.modified_count


async def start_broadcast(trigger: str, actor: str, audience: str) -> dict:
    """audience: 'daily' | 'weekly' | 'all'."""
    rates = await current_rates()
    if not rates:
        raise HTTPException(status_code=400, detail="No rate available yet today — fetch or confirm today's rate first.")
    running = await db.rate_broadcasts.find_one({'status': 'sending', 'audience': {'$in': [audience, 'all']}}, {'_id': 0, 'id': 1})
    if running:
        if trigger != 'schedule':
            raise HTTPException(status_code=400, detail='A send to this list is still going — stop it first or wait for it to finish.')
        await _stop_job(running['id'], 'replaced')  # never deliver last week's rate after this week's
    q: dict = {'status': 'active'}
    if audience in PLANS:
        q.update(_plan_query(audience))
    subs = await db.rate_subscribers.find(q, {'_id': 0, 'id': 1, 'name': 1, 'mobile': 1}).to_list(50000)
    if not subs:
        raise HTTPException(status_code=400, detail='Nobody on this list yet.')
    bid = str(uuid.uuid4())
    now = now_utc().isoformat()
    await db.rate_broadcasts.insert_one({
        'id': bid, 'created_at': now, 'created_by': actor, 'trigger': trigger, 'audience': audience, 'status': 'sending',
        'gold': rates['gold'], 'silver': rates['silver'], 'photo_url': await photo_url(), 'total': len(subs),
    })
    await db.rate_broadcast_recipients.insert_many([
        {'id': str(uuid.uuid4()), 'broadcast_id': bid, 'subscriber_id': s['id'], 'name': s.get('name') or '',
         'mobile': s['mobile'], 'state': 'pending', 'created_at': now} for s in subs
    ])
    return {'id': bid, 'total': len(subs), 'gold': rates['gold'], 'silver': rates['silver'], 'audience': audience}


async def _drain_once() -> None:
    import whatsapp_meta
    job = await db.rate_broadcasts.find_one({'status': 'sending'}, {'_id': 0}, sort=[('created_at', 1)])
    if not job:
        return
    cfg = await get_settings()
    room = int(cfg['daily_limit']) - await _sent_today()
    if room <= 0:
        return  # carries on after midnight IST
    n = min(room, PER_TICK)
    batch = await db.rate_broadcast_recipients.find(
        {'broadcast_id': job['id'], 'state': 'pending'}, {'_id': 0}).sort('created_at', 1).limit(n).to_list(n)
    if not batch:
        await db.rate_broadcasts.update_one({'id': job['id']}, {'$set': {'status': 'done', 'finished_at': now_utc().isoformat()}})
        return
    gold, silver = inr(job['gold']), inr(job['silver'])
    for r in batch:
        sub = await db.rate_subscribers.find_one({'id': r['subscriber_id']}, {'_id': 0, 'status': 1})
        if not sub or sub.get('status') != 'active':
            await db.rate_broadcast_recipients.update_one({'id': r['id']}, {'$set': {'state': 'skipped'}})
            continue
        ok = await whatsapp_meta.send_template(
            r['mobile'], TEMPLATE_NAME, TEMPLATE_LANG,
            body_params=[r.get('name') or DEFAULT_NAME, gold, silver], flow=f"rate_broadcast:{job['id']}",
            header_image_link=job.get('photo_url') or DEFAULT_PHOTO_URL,
        )
        await db.rate_broadcast_recipients.update_one(
            {'id': r['id']}, {'$set': {'state': 'sent' if ok else 'failed', 'sent_at': now_utc().isoformat()}})
        await asyncio.sleep(SEND_GAP_SEC)


def _due(now_ist, hhmm: str) -> bool:
    try:
        hh, mm = (int(x) for x in str(hhmm).split(':'))
    except Exception:
        return False
    return now_ist.hour * 60 + now_ist.minute >= hh * 60 + mm


async def _maybe_schedule() -> None:
    cfg = await get_settings()
    now_ist = now_utc().astimezone(IST)
    today = now_ist.date().isoformat()
    plans = []
    if cfg['weekly_enabled'] and now_ist.weekday() == int(cfg['weekday']) and cfg['last_weekly_date'] != today and _due(now_ist, cfg['time']):
        plans.append(('weekly', 'last_weekly_date'))
    if (cfg['daily_enabled'] and cfg['last_daily_date'] != today and _due(now_ist, cfg['daily_time'])
            and not (cfg['daily_skip_sunday'] and now_ist.weekday() == 6)):
        plans.append(('daily', 'last_daily_date'))
    for plan, marker in plans:
        # Mark first, so a failure below can't retry every tick all day.
        await db.settings.update_one({'id': 'rate_broadcast'}, {'$set': {'id': 'rate_broadcast', marker: today}}, upsert=True)
        try:
            job = await start_broadcast('schedule', f'{plan.title()} schedule', plan)
            logger.info(f"{plan} rate broadcast started: {job['total']} recipients")
        except HTTPException as e:
            logger.info(f'{plan} rate broadcast not started: {e.detail}')


async def broadcast_loop() -> None:
    await asyncio.sleep(90)
    while True:
        try:
            await _maybe_schedule()
            await _drain_once()
        except Exception as e:
            logger.warning(f'rate broadcast loop error: {e}')
        await asyncio.sleep(TICK_SEC)


_STOP_WORDS = ('STOP', 'UNSUBSCRIBE', 'STOP ALL', STOP_BUTTON.upper())
_JOIN_WORDS = {'START': 'daily', 'DAILY': 'daily', 'SUBSCRIBE': 'daily', 'WEEKLY': 'weekly'}


def _keyword(text: str) -> str:
    return re.sub(r'[^A-Z ]', '', (text or '').strip().upper()).strip()


def is_subscribe_word(text: str) -> bool:
    """Whole message is one of the subscription keywords (not merely contains one)."""
    w = _keyword(text)
    return w in _STOP_WORDS or w in _JOIN_WORDS


async def handle_subscribe_reply(mobile: str, text: str, source: str = 'whatsapp') -> Optional[str]:
    """Inbound messages on either number come through here — the official Meta
    line (routers/whatsapp_meta_bot.py) and the shop's OpenWA number
    (routers/whatsapp_bot.py; source='shop_whatsapp'). STOP / the Stop
    updates button opt out; START / DAILY subscribe to the daily rate; WEEKLY
    to the weekly one (always the customer's own choice). Returns a reply to
    send, or None when the message isn't one of these."""
    word = _keyword(text)
    m = norm_mobile(mobile)
    if not m:
        return None
    now = now_utc().isoformat()
    if word in _STOP_WORDS:
        res = await db.rate_subscribers.update_one({'mobile': m}, {'$set': {'status': 'opted_out', 'opted_out_at': now}})
        if not res.matched_count:  # remember the choice even if they were never on a list
            await db.rate_subscribers.insert_one({'id': str(uuid.uuid4()), 'name': '', 'mobile': m, 'status': 'opted_out',
                                                  'plan': 'weekly', 'source': source, 'added_at': now, 'opted_out_at': now})
        return "You won't receive rate updates from Ram Murti Jewellers anymore. Reply START to subscribe again."
    plan = _JOIN_WORDS.get(word)
    if not plan:
        return None
    res = await db.rate_subscribers.update_one(
        {'mobile': m}, {'$set': {'status': 'active', 'plan': plan}, '$unset': {'opted_out_at': ''}})
    if not res.matched_count:
        await db.rate_subscribers.insert_one({'id': str(uuid.uuid4()), 'name': '', 'mobile': m, 'status': 'active',
                                              'plan': plan, 'source': source, 'added_at': now})
    if plan == 'daily':
        return ("You're subscribed to the daily gold & silver rate from Ram Murti Jewellers. "
                "Reply WEEKLY for once a week instead, or STOP anytime to stop.")
    return "You'll get our rates once a week. Reply DAILY for every day, or STOP anytime to stop."


async def subscribe_link() -> Optional[str]:
    """wa.me link to the Meta number with START pre-filled — for the website
    button and a printable QR at the counter. Cached: the number rarely changes."""
    import whatsapp_meta
    cache = await db.settings.find_one({'id': 'rate_broadcast_link'}, {'_id': 0}) or {}
    phone = cache.get('phone')
    if not phone and whatsapp_meta.is_configured():
        st = await whatsapp_meta.get_status()
        phone = re.sub(r'\D', '', st.get('phone') or '')
        if phone:
            await db.settings.update_one({'id': 'rate_broadcast_link'}, {'$set': {'id': 'rate_broadcast_link', 'phone': phone}}, upsert=True)
    return f'https://wa.me/{phone}?text=START' if phone else None


# ---------------- public (no auth) ----------------
@router.get('/public/rate-broadcast/subscribe')
async def public_subscribe_link():
    return {'url': await subscribe_link()}


@router.get('/public/rate-broadcast/photo')
async def public_photo():
    p = await db.settings.find_one({'id': 'rate_broadcast_photo'}, {'_id': 0, 'image': 1})
    if not p or not p.get('image'):
        raise HTTPException(status_code=404, detail='Not found')
    return Response(content=base64.b64decode(p['image']), media_type='image/jpeg',
                    headers={'Cache-Control': 'public, max-age=604800'})


# ---------------- endpoints (owner) ----------------
async def _counts() -> dict:
    return {
        'daily': await db.rate_subscribers.count_documents({'status': 'active', **_plan_query('daily')}),
        'weekly': await db.rate_subscribers.count_documents({'status': 'active', **_plan_query('weekly')}),
        'opted_out': await db.rate_subscribers.count_documents({'status': 'opted_out'}),
    }


@router.get('/rate-broadcast/overview')
async def overview(_: dict = Depends(require_broadcast)):
    import whatsapp_meta
    rates = await current_rates()
    return {
        'settings': await get_settings(), 'weekdays': WEEKDAYS, 'counts': await _counts(), 'rates': rates,
        'preview': TEMPLATE_BODY.replace('{{1}}', 'Rahul').replace('{{2}}', inr(rates['gold']) if rates else '—')
                                .replace('{{3}}', inr(rates['silver']) if rates else '—'),
        'buttons': [b['text'] for b in TEMPLATE_BUTTONS],
        'photo_url': await photo_url(), 'photo_custom': (await photo_url()) != DEFAULT_PHOTO_URL,
        'subscribe_link': await subscribe_link(),
        'template': {**(await whatsapp_meta.template_status(TEMPLATE_NAME)), 'name': TEMPLATE_NAME},
        'meta_configured': whatsapp_meta.is_configured(),
        'sending': await db.rate_broadcasts.find({'status': 'sending'}, {'_id': 0}).to_list(5),
        'sent_today': await _sent_today(),
    }


@router.post('/rate-broadcast/template')
async def create_rate_template(user: dict = Depends(require_broadcast)):
    import whatsapp_meta
    sample = None
    p = await db.settings.find_one({'id': 'rate_broadcast_photo'}, {'_id': 0, 'image': 1})
    if p and p.get('image'):
        sample = base64.b64decode(p['image'])
    elif DEFAULT_PHOTO_FILE.is_file():
        sample = DEFAULT_PHOTO_FILE.read_bytes()
    if not sample:
        raise HTTPException(status_code=400, detail='Add a photo first — Meta needs a sample image to review the template.')
    up = await whatsapp_meta.upload_example_media(sample)
    if not up['ok']:
        raise HTTPException(status_code=502, detail=f"Couldn't upload the sample photo to Meta: {up['error']}")
    res = await whatsapp_meta.create_template(TEMPLATE_NAME, 'MARKETING', TEMPLATE_BODY, TEMPLATE_EXAMPLE, TEMPLATE_LANG,
                                              header_image_handle=up['handle'], buttons=TEMPLATE_BUTTONS)
    if not res['ok']:
        raise HTTPException(status_code=502, detail=f"Meta didn't accept the template: {res['error']}")
    await log_audit(user, 'rate_broadcast.template_create', 'settings', 'rate_broadcast', TEMPLATE_NAME)
    return {**(await whatsapp_meta.template_status(TEMPLATE_NAME)), 'name': TEMPLATE_NAME}


@router.post('/rate-broadcast/photo')
async def upload_photo(file: UploadFile = File(...), user: dict = Depends(require_broadcast)):
    from routers.documents import _make_view_sync
    raw = await file.read()
    if not raw or len(raw) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail='Pick a photo under 15 MB')
    jpeg = await asyncio.to_thread(_make_view_sync, raw)
    if not jpeg:
        raise HTTPException(status_code=400, detail="That file isn't a photo we can read (use JPG or PNG).")
    if len(jpeg) > 4_800_000:
        raise HTTPException(status_code=400, detail='Photo is too large for WhatsApp even after resizing.')
    prev = await db.settings.find_one({'id': 'rate_broadcast_photo'}, {'_id': 0, 'version': 1}) or {}
    await db.settings.update_one({'id': 'rate_broadcast_photo'}, {'$set': {
        'id': 'rate_broadcast_photo', 'image': base64.b64encode(jpeg).decode('ascii'),
        'version': int(prev.get('version') or 0) + 1, 'updated_at': now_utc().isoformat()}}, upsert=True)
    await log_audit(user, 'rate_broadcast.photo', 'settings', 'rate_broadcast', 'custom')
    return {'photo_url': await photo_url(), 'photo_custom': True}


@router.delete('/rate-broadcast/photo')
async def reset_photo(user: dict = Depends(require_broadcast)):
    await db.settings.delete_one({'id': 'rate_broadcast_photo'})
    await log_audit(user, 'rate_broadcast.photo', 'settings', 'rate_broadcast', 'default')
    return {'photo_url': DEFAULT_PHOTO_URL, 'photo_custom': False}


class SettingsIn(BaseModel):
    weekly_enabled: bool
    weekday: int
    time: str
    daily_enabled: bool = False
    daily_time: str = '11:30'
    daily_skip_sunday: bool = True
    daily_limit: int


_HHMM = re.compile(r'([01]\d|2[0-3]):[0-5]\d')


@router.put('/rate-broadcast/settings')
async def save_settings(body: SettingsIn, user: dict = Depends(require_broadcast)):
    if not 0 <= body.weekday <= 6:
        raise HTTPException(status_code=400, detail='Pick a day of the week')
    if not (_HHMM.fullmatch(body.time.strip()) and _HHMM.fullmatch(body.daily_time.strip())):
        raise HTTPException(status_code=400, detail='Times must be HH:MM (24-hour), e.g. 11:00')
    if not 1 <= body.daily_limit <= 100000:
        raise HTTPException(status_code=400, detail='Daily limit must be at least 1')
    data = {**body.model_dump(), 'time': body.time.strip(), 'daily_time': body.daily_time.strip()}
    await db.settings.update_one({'id': 'rate_broadcast'}, {'$set': {'id': 'rate_broadcast', **data}}, upsert=True)
    await log_audit(user, 'rate_broadcast.settings', 'settings', 'rate_broadcast',
                    f"weekly {'on' if body.weekly_enabled else 'off'}, daily {'on' if body.daily_enabled else 'off'}")
    return await get_settings()


@router.get('/rate-broadcast/subscribers')
async def list_subscribers(q: Optional[str] = None, status: Optional[str] = None, plan: Optional[str] = None,
                           _: dict = Depends(require_broadcast)):
    query: dict = {}
    if status in ('active', 'opted_out'):
        query['status'] = status
    if plan in PLANS:
        query.update(_plan_query(plan))
    if q:
        qe = re.escape(q.strip())
        query['$or'] = [{'name': {'$regex': qe, '$options': 'i'}}, {'mobile': {'$regex': qe}}]
    return await db.rate_subscribers.find(query, {'_id': 0}).sort('added_at', -1).limit(300).to_list(300)


@router.post('/rate-broadcast/subscribers/import')
async def import_subscribers(file: UploadFile = File(...), user: dict = Depends(require_broadcast)):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail='Empty file')
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail='File too large (max 10 MB)')
    try:
        rows = parse_contacts(file.filename or '', raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Couldn't read that file — upload an Excel (.xlsx) or CSV list with name and mobile columns.")
    existing = {s['mobile']: s async for s in db.rate_subscribers.find({}, {'_id': 0, 'id': 1, 'mobile': 1, 'name': 1, 'status': 1})}
    added = updated = invalid = duplicate = kept_out = 0
    seen = set()
    now = now_utc().isoformat()
    new_docs = []
    for r in rows:
        m = norm_mobile(r['mobile_raw'])
        if not m:
            invalid += 1
            continue
        if m in seen:
            duplicate += 1
            continue
        seen.add(m)
        ex = existing.get(m)
        if not ex:
            new_docs.append({'id': str(uuid.uuid4()), 'name': r['name'], 'mobile': m, 'status': 'active',
                             'plan': 'weekly', 'source': 'import', 'added_at': now})
        elif ex.get('status') == 'opted_out':
            kept_out += 1  # they said STOP — an import must never re-subscribe them
        elif r['name'] and not ex.get('name'):
            await db.rate_subscribers.update_one({'id': ex['id']}, {'$set': {'name': r['name']}})
            updated += 1
        else:
            duplicate += 1
    for i in range(0, len(new_docs), 1000):
        await db.rate_subscribers.insert_many(new_docs[i:i + 1000])
    added = len(new_docs)
    await log_audit(user, 'rate_broadcast.import', 'rate_subscriber', '', f'{added} added', {'file': file.filename})
    return {'rows': len(rows), 'added': added, 'updated': updated, 'already_there': duplicate,
            'invalid': invalid, 'opted_out_kept': kept_out}


class SubscriberIn(BaseModel):
    name: str = ''
    mobile: str
    plan: Literal['daily', 'weekly'] = 'weekly'


@router.post('/rate-broadcast/subscribers')
async def add_subscriber(body: SubscriberIn, user: dict = Depends(require_broadcast)):
    m = norm_mobile(body.mobile)
    if not m:
        raise HTTPException(status_code=400, detail='Enter a valid 10-digit mobile number')
    existing = await db.rate_subscribers.find_one({'mobile': m}, {'_id': 0})
    if existing:
        raise HTTPException(status_code=400, detail='Already on the list' + (' (they opted out with STOP)' if existing.get('status') == 'opted_out' else ''))
    doc = {'id': str(uuid.uuid4()), 'name': body.name.strip()[:60], 'mobile': m, 'status': 'active',
           'plan': body.plan, 'source': 'manual', 'added_at': now_utc().isoformat()}
    await db.rate_subscribers.insert_one(dict(doc))
    await log_audit(user, 'rate_broadcast.subscriber_add', 'rate_subscriber', doc['id'], m)
    return doc


@router.delete('/rate-broadcast/subscribers/{sid}')
async def remove_subscriber(sid: str, user: dict = Depends(require_broadcast)):
    s = await db.rate_subscribers.find_one({'id': sid}, {'_id': 0})
    if not s:
        raise HTTPException(status_code=404, detail='Not found')
    if s.get('status') == 'opted_out':
        # keep the record so a later import can't re-add someone who said STOP
        raise HTTPException(status_code=400, detail='This customer opted out — kept on file so they are never re-added.')
    await db.rate_subscribers.delete_one({'id': sid})
    await log_audit(user, 'rate_broadcast.subscriber_remove', 'rate_subscriber', sid, s.get('mobile', ''))
    return {'ok': True}


class SendIn(BaseModel):
    audience: Literal['daily', 'weekly', 'all'] = 'weekly'


@router.post('/rate-broadcast/send')
async def send_now(body: SendIn = SendIn(), user: dict = Depends(require_broadcast)):
    import whatsapp_meta
    if not whatsapp_meta.is_configured():
        raise HTTPException(status_code=400, detail='The official WhatsApp (Meta) line is not configured.')
    st = await whatsapp_meta.template_status(TEMPLATE_NAME)
    if st.get('status') != 'APPROVED':
        raise HTTPException(status_code=400, detail='The rate template is not approved by Meta yet.')
    job = await start_broadcast('manual', user.get('name') or 'Owner', body.audience)
    await log_audit(user, 'rate_broadcast.send', 'rate_broadcast', job['id'], f"{body.audience}: {job['total']} recipients")
    return job


@router.get('/rate-broadcast/diagnostics')
async def diagnostics(_: dict = Depends(require_broadcast)):
    """Why aren't START messages arriving? Answers the three usual causes."""
    import whatsapp_meta
    hits = await db.meta_webhook_log.find({}, {'_id': 0}).sort('at', -1).to_list(15)
    return {
        'app_secret_set': bool(whatsapp_meta.APP_SECRET),
        'verify_token_set': bool(whatsapp_meta.WEBHOOK_VERIFY_TOKEN),
        'subscription': await whatsapp_meta.app_subscription(),
        'number': await whatsapp_meta.number_health(),
        'hits': hits,
    }


class RegisterIn(BaseModel):
    pin: str


@router.post('/rate-broadcast/diagnostics/register-number')
async def diagnostics_register_number(body: RegisterIn, user: dict = Depends(require_broadcast)):
    import whatsapp_meta
    pin = (body.pin or '').strip()
    if not re.fullmatch(r'\d{6}', pin):
        raise HTTPException(status_code=400, detail='The PIN is 6 digits')
    res = await whatsapp_meta.register_number(pin)
    if not res['ok']:
        raise HTTPException(status_code=502, detail=f"Meta refused: {res['error']}")
    await log_audit(user, 'rate_broadcast.register_number', 'settings', 'whatsapp_meta', 'registered')
    return await diagnostics(user)


@router.post('/rate-broadcast/diagnostics/subscribe-app')
async def diagnostics_subscribe_app(user: dict = Depends(require_broadcast)):
    import whatsapp_meta
    res = await whatsapp_meta.subscribe_app()
    if not res['ok']:
        raise HTTPException(status_code=502, detail=f"Meta refused: {res['error']}")
    await log_audit(user, 'rate_broadcast.subscribe_app', 'settings', 'whatsapp_meta', 'waba subscribed to app')
    return await diagnostics(user)


@router.post('/rate-broadcast/{bid}/stop')
async def stop_broadcast(bid: str, user: dict = Depends(require_broadcast)):
    n = await _stop_job(bid)
    await log_audit(user, 'rate_broadcast.stop', 'rate_broadcast', bid, f'{n} cancelled')
    return {'ok': True, 'cancelled': n}


@router.get('/rate-broadcast/history')
async def history(_: dict = Depends(require_broadcast)):
    jobs = await db.rate_broadcasts.find({}, {'_id': 0}).sort('created_at', -1).to_list(12)
    for j in jobs:
        states = {}
        for s in ('pending', 'sent', 'failed', 'skipped', 'cancelled'):
            states[s] = await db.rate_broadcast_recipients.count_documents({'broadcast_id': j['id'], 'state': s})
        delivery = {}
        async for m in db.whatsapp_messages.find({'flow': f"rate_broadcast:{j['id']}"}, {'_id': 0, 'status': 1}):
            k = m.get('status') or 'accepted'
            delivery[k] = delivery.get(k, 0) + 1
        j['states'] = states
        j['delivery'] = delivery  # sent / delivered / read / failed, from Meta's status webhooks
    return jobs
