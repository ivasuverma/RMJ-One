"""Website module — the "Fresh at the counter" pieces shown on rmj.co.in.

Staff add a photo with a name and metal from Settings > Website; the public
site reads GET /api/public/website/pieces (visible pieces, in order) and
loads each photo from its public image URL. Photos are resized to a
web-friendly JPEG on upload and kept in the database, so they're served
straight from here with no Drive/Hostinger dependency."""
import asyncio
import base64
import hashlib
import json
import logging
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel

import r2_media
from server import db, get_current, log_audit, now_utc, resolve_modules

logger = logging.getLogger('website')

# ---- Cloudflare R2 copy of the website photos (see r2_media.py) ----
# When R2 is set up, every photo the public site shows is copied there and the
# public endpoints hand out its media.rmj.co.in address, so customers load
# photos from Cloudflare, not the shop computer. The database keeps the
# original (it's in every backup). _R2_KEYS is what's in the bucket now;
# until a photo has been copied, its address stays the API one.
_R2_KEYS: set = set()
_R2_KICK = asyncio.Event()


async def _kick_r2_after_change(request: Request):
    """Router-wide: after any change here, wake the R2 sync straight away."""
    yield
    if request.method != 'GET':
        _R2_KICK.set()


router = APIRouter(dependencies=[Depends(_kick_r2_after_change)])


def require_website(user=Depends(get_current)):
    """Owner and admin always (as before); anyone else — an employee the owner
    trusts with the site — needs the Website module (Settings › Users)."""
    if user.get('role') in ('owner', 'admin') or 'website' in resolve_modules(user):
        return user
    raise HTTPException(status_code=403, detail='No access to "Website"')

_MAX_UPLOAD = 15 * 1024 * 1024
_MAX_PIECES = 40
_ADMIN_PROJ = {'_id': 0, 'image': 0}
_PUBLIC_PROJ = {'_id': 0, 'image': 0, 'thumb': 0}


def _web_jpeg(raw: bytes) -> Optional[bytes]:
    from routers.documents import _make_view_sync
    return _make_view_sync(raw)


def _thumb_jpeg(jpeg: bytes) -> bytes:
    import io
    from PIL import Image
    img = Image.open(io.BytesIO(jpeg))
    img.thumbnail((320, 320), Image.LANCZOS)
    out = io.BytesIO()
    img.convert('RGB').save(out, 'JPEG', quality=78, optimize=True)
    return out.getvalue()


def _piece_key(p: dict) -> str:
    return f"pieces/{p['id']}-v{p.get('image_version', 1)}.jpg"


def _public(p: dict, public: bool = False) -> dict:
    """`public`: the address the website uses - on Cloudflare once copied there."""
    key = _piece_key(p)
    return {
        'id': p['id'], 'name': p.get('name') or '', 'metal': p.get('metal') or '',
        'image_url': r2_media.public_url(key) if public and key in _R2_KEYS
        else f"/api/public/website/pieces/{p['id']}/image?v={p.get('image_version', 1)}",
    }


@router.get('/website/pieces')
async def list_pieces(_: dict = Depends(require_website)):
    items = await db.website_pieces.find({}, _ADMIN_PROJ).sort('sort', 1).to_list(_MAX_PIECES)
    # Thumbnail inline: hidden pieces' photos aren't served publicly.
    return [{**{k: v for k, v in p.items() if k != 'thumb'}, 'image_url': _public(p)['image_url'],
             'thumb': f"data:image/jpeg;base64,{p['thumb']}" if p.get('thumb') else None} for p in items]


@router.post('/website/pieces')
async def add_piece(
    file: UploadFile = File(...), name: str = Form(default=''), metal: str = Form(default=''),
    user: dict = Depends(require_website),
):
    if await db.website_pieces.count_documents({}) >= _MAX_PIECES:
        raise HTTPException(status_code=400, detail=f'Up to {_MAX_PIECES} pieces — remove an old one first.')
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail='Empty file')
    if len(raw) > _MAX_UPLOAD:
        raise HTTPException(status_code=400, detail='Photo too large (max 15 MB)')
    jpeg = await asyncio.to_thread(_web_jpeg, raw)
    if not jpeg:
        raise HTTPException(status_code=400, detail="That file isn't a photo we can read (use JPG or PNG).")
    thumb = await asyncio.to_thread(_thumb_jpeg, jpeg)
    first = await db.website_pieces.find_one({}, {'_id': 0, 'sort': 1}, sort=[('sort', 1)])
    now = now_utc().isoformat()
    doc = {
        'id': str(uuid.uuid4()), 'name': name.strip()[:60], 'metal': metal.strip()[:40],
        'visible': True, 'sort': (first['sort'] - 1) if first else 0,  # newest goes first
        'image': base64.b64encode(jpeg).decode('ascii'), 'thumb': base64.b64encode(thumb).decode('ascii'),
        'image_version': 1, 'size': len(jpeg),
        'created_at': now, 'updated_at': now, 'created_by': user.get('name'),
    }
    await db.website_pieces.insert_one(dict(doc))
    await log_audit(user, 'website.piece.add', 'website_piece', doc['id'], doc['name'] or doc['metal'])
    doc.pop('image')
    doc['thumb'] = f"data:image/jpeg;base64,{doc['thumb']}"
    return {**doc, 'image_url': _public(doc)['image_url']}


class PieceIn(BaseModel):
    name: Optional[str] = None
    metal: Optional[str] = None
    visible: Optional[bool] = None


@router.patch('/website/pieces/{piece_id}')
async def update_piece(piece_id: str, body: PieceIn, user: dict = Depends(require_website)):
    changes = {k: (v.strip()[:60] if isinstance(v, str) else v) for k, v in body.model_dump().items() if v is not None}
    if not changes:
        raise HTTPException(status_code=400, detail='Nothing to change')
    changes['updated_at'] = now_utc().isoformat()
    res = await db.website_pieces.update_one({'id': piece_id}, {'$set': changes})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail='Piece not found')
    await log_audit(user, 'website.piece.update', 'website_piece', piece_id, ', '.join(sorted(changes)))
    return await db.website_pieces.find_one({'id': piece_id}, _PUBLIC_PROJ)


class OrderIn(BaseModel):
    ids: List[str]


@router.put('/website/pieces/order')
async def reorder_pieces(body: OrderIn, user: dict = Depends(require_website)):
    for i, pid in enumerate(body.ids):
        await db.website_pieces.update_one({'id': pid}, {'$set': {'sort': i}})
    await log_audit(user, 'website.piece.reorder', 'website_piece', '', str(len(body.ids)))
    return {'ok': True}


@router.delete('/website/pieces/{piece_id}')
async def delete_piece(piece_id: str, user: dict = Depends(require_website)):
    res = await db.website_pieces.delete_one({'id': piece_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail='Piece not found')
    await log_audit(user, 'website.piece.delete', 'website_piece', piece_id, '')
    return {'ok': True}


# ---------------- Public (no auth) — read by rmj.co.in ----------------
@router.get('/public/website/pieces')
async def public_pieces():
    items = await db.website_pieces.find({'visible': True}, _PUBLIC_PROJ).sort('sort', 1).to_list(_MAX_PIECES)
    return {'pieces': [_public(p, public=True) for p in items]}


@router.get('/public/website/pieces/{piece_id}/image')
async def public_piece_image(piece_id: str):
    p = await db.website_pieces.find_one({'id': piece_id, 'visible': True}, {'_id': 0, 'image': 1})
    if not p or not p.get('image'):
        raise HTTPException(status_code=404, detail='Not found')
    # The URL carries ?v=<image_version>, so it's safe to cache hard.
    return Response(content=base64.b64decode(p['image']), media_type='image/jpeg',
                    headers={'Cache-Control': 'public, max-age=604800'})


# ================================================================
# Page editor — every heading, paragraph and photo on rmj.co.in, plus
# sections the shop adds itself. The static page keeps its own text as the
# default (so it still reads right if this API is down, and search engines
# see real copy); it fetches GET /public/website/content and swaps in only
# what's been edited here. Element ids are the `data-cms` / `data-cms-img`
# attributes in website/index.html — tests/test_website_content.py checks
# every default below is still in that file, so the two can't drift apart.
# ================================================================
_SITE = 'https://rmj.co.in/'
_MAX_SECTIONS = 12
_MAX_SECTION_PHOTOS = 24
_TITLE_MAX = 120
_TEXT_MAX = 1500


def _f(key, label, default, multiline=False):
    return {'key': key, 'label': label, 'default': default, 'multiline': multiline}


def _img(key, label, path):
    return {'key': key, 'label': label, 'default_url': _SITE + path}


# Built-in sections, in page order. `hideable`: can be switched off on the site.
PAGE = [
    {'key': 'hero', 'label': "Today's rate", 'hideable': False, 'fields': [
        _f('hero_fine', 'Disclaimer — first paragraph', 'Rates are indicative and exclude making charges, wastage and GST — they can change through the day, and the rate applicable to any transaction is the one in effect at billing, not the rate shown here. Buyback is offered only on items purchased from us, subject to purity verification.', True),
    ], 'images': []},
    {'key': 'showcase', 'label': 'Showcase', 'hideable': True, 'fields': [
        _f('showcase_title', 'Heading', 'Three generations of craftsmanship.'),
        _f('showcase_text', 'Text', 'From everyday gold to wedding sets and one-of-a-kind pieces, everything still comes out of the same Ludhiana counter our family has run since 1932.', True),
    ], 'images': [_img('showcase_photo', 'Main photo', 'assets/photos/dsc_0033-YBg891rw9PtK9XaM.JPG')]},
    {'key': 'collections', 'label': 'Find your piece', 'hideable': True, 'fields': [
        _f('collections_title', 'Heading', 'Find your piece.'),
        _f('collections_text', 'Text', "Choose a collection and a piece, and we'll send you what's on the counter right now, on WhatsApp.", True),
        _f('finder_gold_desc', 'Gold — description', 'Hallmarked gold in five styles, from heirloom Polki and Kundan to everyday yellow and rose gold.', True),
        _f('finder_diamond_desc', 'Diamond — description', 'Natural diamond jewellery, for every day and every occasion.', True),
        _f('finder_silver_desc', 'Silver — description', 'Everyday silver, traditional kadas and idols for the home mandir.', True),
        _f('finder_lab_desc', 'Lab grown — description', 'Lab-grown diamond rings, bangles and earrings.', True),
    ], 'images': [
        _img('finder_gold', 'Gold photo', 'assets/photos/9-m5K2JDMlpjsyXlrp.jpg'),
        _img('finder_diamond', 'Diamond photo', 'assets/photos/dsc_0031-m6LDQMw935H1Mopx.JPG'),
        _img('finder_silver', 'Silver photo', 'assets/photos/7-YKbaGv3PlOFBr657.jpg'),
        _img('finder_lab', 'Lab grown photo', 'assets/photos/dsc_0020-mk3ygxz6kbheoowk.JPG'),
    ]},
    {'key': 'counter', 'label': 'Fresh at the counter', 'hideable': True, 'pieces': True, 'fields': [
        _f('counter_title', 'Heading', 'Fresh at the counter.'),
        _f('counter_text', 'Text', "Ask about any piece and we'll send more photos and the price, right on WhatsApp.", True),
        _f('promise1_title', 'Promise 1 — title', 'Hallmarked gold'),
        _f('promise1_text', 'Promise 1 — text', 'Every piece we sell carries a BIS hallmark and HUID number you can verify yourself.', True),
        _f('promise2_title', 'Promise 2 — title', 'Old gold exchange'),
        _f('promise2_text', 'Promise 2 — text', "We test your old jewellery in front of you and value it fairly at today's rate.", True),
        _f('promise3_title', 'Promise 3 — title', 'Custom orders'),
        _f('promise3_text', 'Promise 3 — text', 'Designed with you and crafted right here by our own karigars.', True),
        _f('promise4_title', 'Promise 4 — title', 'Repairs and polish'),
        _f('promise4_text', 'Promise 4 — text', 'Resizing, clasps, stone setting and polishing, with a receipt for every piece.', True),
    ], 'images': []},
    {'key': 'about', 'label': 'About', 'hideable': True, 'fields': [
        _f('about_title', 'Heading', 'Three generations, one family counter.'),
        _f('about_p1', 'First paragraph', "Ram Murti Jewellers was founded in 1932 by Sh. Ram Murti, whose name we still carry with pride. His son, Mr. Jugal Kishore Verma, carried the counter forward for decades, and today it's run by Mr. Vasu Verma — the same family, the same street, for over nine decades.", True),
        _f('about_p2', 'Second paragraph', "Our counter holds a carefully chosen range of hallmarked gold jewellery — fine necklaces and bracelets, detailed earrings and rings — each piece made with care and finished by hand. Alongside it sits our diamond collection: stones we handpick for their quality and brilliance, set into engagement rings, statement pendants and earrings made for life's biggest moments.", True),
        _f('about_p3', 'Third paragraph', "Many families who bought their wedding jewellery here now bring their children, and we look after every visit the same way. We take the time to understand what you're looking for, explain every rate and charge clearly, and help you find a piece that suits you — for your own collection or as a gift for someone you love. Come and see us at Field Ganj, Ludhiana.", True),
    ], 'images': [_img('about_photo', 'Photo', 'assets/photos/dsc_0021-m5K2JDwG4zs2MZbz.JPG')]},
    {'key': 'visit', 'label': 'Visit', 'hideable': False, 'fields': [
        _f('visit_title', 'Heading', 'Visit our counter.'),
        _f('visit_text', 'Text', "Walk in any time, or message us ahead and we'll keep pieces ready for you.", True),
        _f('visit_address', 'Address', 'Ludhiana, Punjab'),
    ], 'images': []},
]
_FIELDS = {f['key']: f for s in PAGE for f in s['fields']}
_IMAGES = {i['key']: i for s in PAGE for i in s['images']}
_HIDEABLE = {s['key'] for s in PAGE if s['hideable']}


async def _content_doc() -> dict:
    d = await db.settings.find_one({'id': 'website_content'}, {'_id': 0}) or {}
    return {'texts': d.get('texts') or {}, 'images': d.get('images') or {}, 'hidden': d.get('hidden') or [],
            'brand': {**BRAND_DEFAULT, **(d.get('brand') or {})}}


# Size of the logo and the RAMMURTI JEWELLERS name in the site's header (and,
# in proportion, the footer and other places they appear), as % of the
# built-in size. The site applies them as CSS scale variables.
BRAND_DEFAULT = {'logo': 100, 'name': 85}
BRAND_RANGE = (60, 140)


def _image_url(image_id: str, public: bool = False) -> str:
    key = f'images/{image_id}.jpg'
    if public and key in _R2_KEYS:
        return r2_media.public_url(key)
    return f'/api/public/website/images/{image_id}'


async def _store_image(raw: bytes) -> str:
    if not raw:
        raise HTTPException(status_code=400, detail='Empty file')
    if len(raw) > _MAX_UPLOAD:
        raise HTTPException(status_code=400, detail='Photo too large (max 15 MB)')
    jpeg = await asyncio.to_thread(_web_jpeg, raw)
    if not jpeg:
        raise HTTPException(status_code=400, detail="That file isn't a photo we can read (use JPG or PNG).")
    thumb = await asyncio.to_thread(_thumb_jpeg, jpeg)
    iid = str(uuid.uuid4())  # a new id per upload, so the URL itself busts caches
    await db.website_images.insert_one({
        'id': iid, 'image': base64.b64encode(jpeg).decode('ascii'), 'thumb': base64.b64encode(thumb).decode('ascii'),
        'created_at': now_utc().isoformat(),
    })
    return iid


def _section_out(s: dict, admin: bool) -> dict:
    out = {'id': s['id'], 'title': s.get('title') or '', 'text': s.get('text') or '',
           'photos': [{'id': p['id'], 'caption': p.get('caption') or '', 'url': _image_url(p['id'], public=not admin)} for p in s.get('photos') or []]}
    if admin:
        out['visible'] = s.get('visible', True)
    return out


@router.get('/website/content')
async def get_content(_: dict = Depends(require_website)):
    c = await _content_doc()
    sections = await db.website_sections.find({}, {'_id': 0}).sort('sort', 1).to_list(_MAX_SECTIONS)
    page = []
    for s in PAGE:
        page.append({
            'key': s['key'], 'label': s['label'], 'hideable': s['hideable'], 'pieces': s.get('pieces', False),
            'visible': s['key'] not in c['hidden'],
            'fields': [{**f, 'value': c['texts'].get(f['key'], f['default']), 'edited': f['key'] in c['texts']} for f in s['fields']],
            'images': [{**i, 'url': _image_url(c['images'][i['key']]) if i['key'] in c['images'] else i['default_url'],
                        'edited': i['key'] in c['images']} for i in s['images']],
        })
    return {'page': page, 'sections': [_section_out(s, True) for s in sections],
            'pieces': await db.website_pieces.count_documents({'visible': True}),
            'brand': c['brand'], 'brand_default': BRAND_DEFAULT, 'brand_range': list(BRAND_RANGE)}


class BrandIn(BaseModel):
    logo: int
    name: int


@router.put('/website/content/brand')
async def save_brand(body: BrandIn, user: dict = Depends(require_website)):
    lo, hi = BRAND_RANGE
    if not (lo <= body.logo <= hi and lo <= body.name <= hi):
        raise HTTPException(status_code=400, detail=f'Sizes go from {lo}% to {hi}%')
    brand = {'logo': body.logo, 'name': body.name}
    await db.settings.update_one({'id': 'website_content'}, {'$set': {'id': 'website_content', 'brand': brand}}, upsert=True)
    await log_audit(user, 'website.brand', 'settings', 'website_content', f"logo {body.logo}%, name {body.name}%")
    return await get_content(user)


class TextsIn(BaseModel):
    texts: dict   # {key: text}; blank or null = back to the original wording


@router.put('/website/content/texts')
async def save_texts(body: TextsIn, user: dict = Depends(require_website)):
    c = await _content_doc()
    texts = dict(c['texts'])
    for k, v in body.texts.items():
        f = _FIELDS.get(k)
        if not f:
            raise HTTPException(status_code=400, detail=f'Unknown text "{k}"')
        v = (v or '').strip() if isinstance(v, str) or v is None else str(v)
        cap = _TEXT_MAX if f['multiline'] else _TITLE_MAX
        if len(v) > cap:
            raise HTTPException(status_code=400, detail=f"{f['label']}: keep it under {cap} characters")
        if not v or v == f['default']:
            texts.pop(k, None)
        else:
            texts[k] = v
    await db.settings.update_one({'id': 'website_content'}, {'$set': {'id': 'website_content', 'texts': texts}}, upsert=True)
    await log_audit(user, 'website.texts', 'settings', 'website_content', ', '.join(sorted(body.texts))[:200])
    return await get_content(user)


class VisibleIn(BaseModel):
    visible: bool


@router.put('/website/content/sections/{key}/visible')
async def set_builtin_visible(key: str, body: VisibleIn, user: dict = Depends(require_website)):
    if key not in _HIDEABLE:
        raise HTTPException(status_code=400, detail='This part of the page is always shown')
    c = await _content_doc()
    hidden = [h for h in c['hidden'] if h != key] + ([] if body.visible else [key])
    await db.settings.update_one({'id': 'website_content'}, {'$set': {'id': 'website_content', 'hidden': hidden}}, upsert=True)
    await log_audit(user, 'website.section_visible', 'settings', key, 'shown' if body.visible else 'hidden')
    return {'ok': True}


@router.post('/website/content/images/{key}')
async def set_page_image(key: str, file: UploadFile = File(...), user: dict = Depends(require_website)):
    if key not in _IMAGES:
        raise HTTPException(status_code=404, detail='Unknown photo')
    iid = await _store_image(await file.read())
    c = await _content_doc()
    old = c['images'].get(key)
    await db.settings.update_one({'id': 'website_content'}, {'$set': {'id': 'website_content', f'images.{key}': iid}}, upsert=True)
    if old:
        await db.website_images.delete_one({'id': old})
    await log_audit(user, 'website.image', 'settings', key, 'custom')
    return {'key': key, 'url': _image_url(iid)}


@router.delete('/website/content/images/{key}')
async def reset_page_image(key: str, user: dict = Depends(require_website)):
    if key not in _IMAGES:
        raise HTTPException(status_code=404, detail='Unknown photo')
    c = await _content_doc()
    old = c['images'].get(key)
    await db.settings.update_one({'id': 'website_content'}, {'$unset': {f'images.{key}': ''}})
    if old:
        await db.website_images.delete_one({'id': old})
    await log_audit(user, 'website.image', 'settings', key, 'original')
    return {'key': key, 'url': _IMAGES[key]['default_url']}


# ---- The shop's own sections (shown between About and Visit) ----
class SectionIn(BaseModel):
    title: Optional[str] = None
    text: Optional[str] = None
    visible: Optional[bool] = None


def _clean_section(body: SectionIn) -> dict:
    out = {}
    if body.title is not None:
        t = body.title.strip()
        if len(t) > _TITLE_MAX:
            raise HTTPException(status_code=400, detail=f'Heading: keep it under {_TITLE_MAX} characters')
        out['title'] = t
    if body.text is not None:
        t = body.text.strip()
        if len(t) > _TEXT_MAX:
            raise HTTPException(status_code=400, detail=f'Text: keep it under {_TEXT_MAX} characters')
        out['text'] = t
    if body.visible is not None:
        out['visible'] = body.visible
    return out


async def _get_section(sid: str) -> dict:
    s = await db.website_sections.find_one({'id': sid}, {'_id': 0})
    if not s:
        raise HTTPException(status_code=404, detail='Section not found')
    return s


@router.post('/website/sections')
async def add_section(body: SectionIn, user: dict = Depends(require_website)):
    data = _clean_section(body)
    if not data.get('title'):
        raise HTTPException(status_code=400, detail='Give the section a heading')
    if await db.website_sections.count_documents({}) >= _MAX_SECTIONS:
        raise HTTPException(status_code=400, detail=f'Up to {_MAX_SECTIONS} sections — remove one first.')
    last = await db.website_sections.find_one({}, {'_id': 0, 'sort': 1}, sort=[('sort', -1)])
    now = now_utc().isoformat()
    doc = {'id': str(uuid.uuid4()), 'title': data['title'], 'text': data.get('text', ''), 'visible': data.get('visible', True),
           'sort': (last['sort'] + 1) if last else 0, 'photos': [], 'created_at': now, 'updated_at': now}
    await db.website_sections.insert_one(dict(doc))
    await log_audit(user, 'website.section.add', 'website_section', doc['id'], doc['title'])
    return _section_out(doc, True)


@router.patch('/website/sections/{sid}')
async def update_section(sid: str, body: SectionIn, user: dict = Depends(require_website)):
    await _get_section(sid)
    data = _clean_section(body)
    if 'title' in data and not data['title']:
        raise HTTPException(status_code=400, detail='A section needs a heading')
    if data:
        data['updated_at'] = now_utc().isoformat()
        await db.website_sections.update_one({'id': sid}, {'$set': data})
        await log_audit(user, 'website.section.update', 'website_section', sid, ', '.join(sorted(data)))
    return _section_out(await _get_section(sid), True)


@router.put('/website/sections/order')
async def reorder_sections(body: OrderIn, user: dict = Depends(require_website)):
    for i, sid in enumerate(body.ids):
        await db.website_sections.update_one({'id': sid}, {'$set': {'sort': i}})
    await log_audit(user, 'website.section.reorder', 'website_section', '', str(len(body.ids)))
    return {'ok': True}


@router.delete('/website/sections/{sid}')
async def delete_section(sid: str, user: dict = Depends(require_website)):
    s = await _get_section(sid)
    ids = [p['id'] for p in s.get('photos') or []]
    if ids:
        await db.website_images.delete_many({'id': {'$in': ids}})
    await db.website_sections.delete_one({'id': sid})
    await log_audit(user, 'website.section.delete', 'website_section', sid, s.get('title') or '')
    return {'ok': True}


@router.post('/website/sections/{sid}/photos')
async def add_section_photo(sid: str, file: UploadFile = File(...), caption: str = Form(default=''),
                            user: dict = Depends(require_website)):
    s = await _get_section(sid)
    if len(s.get('photos') or []) >= _MAX_SECTION_PHOTOS:
        raise HTTPException(status_code=400, detail=f'Up to {_MAX_SECTION_PHOTOS} photos in a section.')
    iid = await _store_image(await file.read())
    await db.website_sections.update_one({'id': sid}, {'$push': {'photos': {'id': iid, 'caption': caption.strip()[:80]}},
                                                       '$set': {'updated_at': now_utc().isoformat()}})
    await log_audit(user, 'website.section.photo_add', 'website_section', sid, caption.strip()[:80])
    return _section_out(await _get_section(sid), True)


class CaptionIn(BaseModel):
    caption: str = ''


@router.patch('/website/sections/{sid}/photos/{pid}')
async def caption_section_photo(sid: str, pid: str, body: CaptionIn, user: dict = Depends(require_website)):
    res = await db.website_sections.update_one({'id': sid, 'photos.id': pid}, {'$set': {'photos.$.caption': body.caption.strip()[:80]}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail='Photo not found')
    return _section_out(await _get_section(sid), True)


@router.delete('/website/sections/{sid}/photos/{pid}')
async def delete_section_photo(sid: str, pid: str, user: dict = Depends(require_website)):
    res = await db.website_sections.update_one({'id': sid}, {'$pull': {'photos': {'id': pid}}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail='Section not found')
    await db.website_images.delete_one({'id': pid})
    await log_audit(user, 'website.section.photo_delete', 'website_section', sid, pid)
    return _section_out(await _get_section(sid), True)


# ---- Public (no auth) — read by rmj.co.in ----
@router.get('/public/website/content')
async def public_content():
    c = await _content_doc()
    sections = await db.website_sections.find({'visible': {'$ne': False}}, {'_id': 0}).sort('sort', 1).to_list(_MAX_SECTIONS)
    return {
        'texts': {k: v for k, v in c['texts'].items() if k in _FIELDS},
        'images': {k: _image_url(v, public=True) for k, v in c['images'].items() if k in _IMAGES},
        'hidden': [h for h in c['hidden'] if h in _HIDEABLE],
        'sections': [_section_out(s, False) for s in sections],
        'brand': c['brand'],
    }


@router.get('/public/website/images/{image_id}')
async def public_image(image_id: str, thumb: bool = False):
    p = await db.website_images.find_one({'id': image_id}, {'_id': 0, 'thumb' if thumb else 'image': 1})
    data = p and p.get('thumb' if thumb else 'image')
    if not data:
        raise HTTPException(status_code=404, detail='Not found')
    # Every upload gets a new id, so the URL never changes content — cache hard.
    return Response(content=base64.b64decode(data), media_type='image/jpeg',
                    headers={'Cache-Control': 'public, max-age=2592000, immutable'})


# ---- keeping R2 in step (started from server startup) ----
_R2_STATE = 'website_r2'
_JSON_CACHE = 'public, max-age=60'
_PHOTO_CACHE = 'public, max-age=31536000, immutable'   # every key names one version of one photo


async def sync_r2() -> dict:
    """Copy what the public site shows to R2, remove what it no longer shows,
    and publish site/pieces.json + site/content.json - the website reads those
    when the shop computer can't be reached."""
    state = await db.settings.find_one({'id': _R2_STATE}, {'_id': 0}) or {}
    have = set(state.get('keys') or [])
    _R2_KEYS.clear()
    _R2_KEYS.update(have)
    pieces = await db.website_pieces.find({'visible': True}, {'_id': 0, 'id': 1, 'image_version': 1}).to_list(_MAX_PIECES)
    want = {_piece_key(p): ('piece', p['id']) for p in pieces}
    async for im in db.website_images.find({}, {'_id': 0, 'id': 1}):
        want[f"images/{im['id']}.jpg"] = ('image', im['id'])
    sent = removed = 0
    for key, (kind, oid) in want.items():
        if key in have:
            continue
        coll = db.website_pieces if kind == 'piece' else db.website_images
        doc = await coll.find_one({'id': oid}, {'_id': 0, 'image': 1})
        if not doc or not doc.get('image'):
            continue
        await r2_media.put(key, base64.b64decode(doc['image']), 'image/jpeg', _PHOTO_CACHE)
        have.add(key)
        _R2_KEYS.add(key)
        sent += 1
    for key in sorted(have - set(want)):
        await r2_media.delete(key)
        have.discard(key)
        _R2_KEYS.discard(key)
        removed += 1
    # The website's fallback copies, with every photo address on Cloudflare.
    published = dict(state.get('published') or {})
    for name, payload in (('site/pieces.json', await public_pieces()), ('site/content.json', await public_content())):
        body = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        digest = hashlib.sha256(body).hexdigest()
        if published.get(name) != digest:
            await r2_media.put(name, body, 'application/json; charset=utf-8', _JSON_CACHE)
            published[name] = digest
    await db.settings.update_one({'id': _R2_STATE}, {'$set': {
        'id': _R2_STATE, 'keys': sorted(have), 'published': published, 'last_sync_at': now_utc().isoformat(), 'last_error': None,
    }}, upsert=True)
    return {'sent': sent, 'removed': removed, 'objects': len(have)}


async def website_r2_loop() -> None:
    """Every 10 minutes, and straight after any change in Settings › Website."""
    if not r2_media.enabled():
        return
    await asyncio.sleep(20)
    while True:
        try:
            res = await sync_r2()
            if res['sent'] or res['removed']:
                logger.info(f"website R2: {res['sent']} sent, {res['removed']} removed, {res['objects']} in the bucket")
        except Exception as e:
            logger.warning(f'website R2 sync: {e}')
            await db.settings.update_one({'id': _R2_STATE}, {'$set': {'id': _R2_STATE, 'last_error': str(e)[:300]}}, upsert=True)
        try:
            await asyncio.wait_for(_R2_KICK.wait(), timeout=600)
            await asyncio.sleep(2)   # let a burst of edits finish first
        except asyncio.TimeoutError:
            pass
        _R2_KICK.clear()
