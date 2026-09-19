"""Documents module (Phase 1 backend) — replaces the shop's Telegram-group
habit of snapping photos of receipts / KYC / cash sheets / bills / statements.

A *document* is a captured photo (or PDF) that starts life **pending** (snapped
but not yet entered in the books) and becomes **done** once it's linked to a
real system record (a customer, a cash day, a repair, a bill…). Categories are
a Settings-managed master (mirrors the account-type master), each carrying its
own per-role view/record permissions, so a salesperson can file a KYC photo but
never see the cash/bank docs.

Storage & offline-tolerance: capture must never block on the network. We write
the original bytes into the record immediately (base64, same pattern the app
already uses for repair intake photos / punch selfies) and mark
`upload_state:'queued'`. A background Drive sync (wired separately once the shop
connects its Google account — see drive_connected()) later uploads and flips to
'synced', filling the drive_* fields. Until then everything works locally: snap,
list, record, view. OCR fields are reserved (Phase 5) and left null.
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, Response
from fastapi.responses import HTMLResponse, FileResponse
from typing import Optional
from pydantic import BaseModel
import asyncio
import base64
import logging
import os
import pathlib
import re
import time
import uuid
from datetime import timedelta

from server import db, now_utc, get_current, require_owner, log_audit, _notify_system_health

router = APIRouter()
logger = logging.getLogger('documents')

# ---------------- Image cache ----------------
# Document images live as base64 INSIDE the Mongo documents, and the database is
# an Atlas shared-tier cluster that hands blob-carrying documents back at
# roughly 75 KB/s — measured: ~1 s to read one 73 KB thumbnail, against ~50 ms
# for the same document with the image projected out, and the same ~1 s on
# repeat reads, so it isn't a warm-up effect. A grid of 50 thumbnails was
# ~50 s of transfer, and because every one of those requests competes for the
# same connection, it starved every other API call too.
#
# So an image only ever leaves the database (or Google Drive) ONCE: the first
# request writes it to a file on this server's own disk and every request after
# that is served straight from there. The bytes for a given id and variant never
# change, so the file can also be cached by the browser for a day.
#   thumb — the small (~520px) JPEG the grid shows
#   full  — the original, for the viewer
# Mongo stays the source of truth; this is only a cache, safe to delete.
DOC_CACHE_DIR = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'doc_cache'
# A page of thumbnails asks for ~50 images at once. Reading them all
# simultaneously just queues them behind each other AND starves the rest of the
# app of database time, so only a few are pulled from Mongo/Drive at any moment.
_BLOB_SLOTS = asyncio.Semaphore(3)
_CACHE_TTL_SECONDS = 86400


# Short-lived in-memory memo for the three small lookups every image request
# makes (the document's metadata, the category list, the caller's rights). On
# the shared-tier database each one is a ~50 ms round trip AND counts against
# its operations-per-second ceiling, so a grid of 50 thumbnails was ~200 tiny
# queries on top of the images. Kept to seconds, so a permission change is still
# picked up almost immediately — and only the image endpoint uses it, every
# other endpoint reads live.
_LOOKUPS: dict = {}


async def _memo(key, ttl: float, loader):
    now = time.monotonic()
    hit = _LOOKUPS.get(key)
    if hit and hit[0] > now:
        return hit[1]
    val = await loader()
    if val is not None:          # never memoise "not found" — a new document must be visible at once
        if len(_LOOKUPS) > 4000:
            _LOOKUPS.clear()
        _LOOKUPS[key] = (now + ttl, val)
    return val


def _forget(doc_id: str) -> None:
    _LOOKUPS.pop(('meta', doc_id), None)


def _cache_file(doc_id: str, variant: str) -> pathlib.Path:
    # doc ids are server-generated UUIDs; refuse anything else so a crafted id
    # can never walk out of the cache directory.
    if not re.fullmatch(r'[0-9a-fA-F-]{8,64}', doc_id or ''):
        raise HTTPException(status_code=404, detail='Document not found')
    return DOC_CACHE_DIR / f'{doc_id}.{variant}'


def _cache_write_sync(path: pathlib.Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'{path.name}.{uuid.uuid4().hex}.tmp')
    tmp.write_bytes(raw)
    os.replace(tmp, path)   # atomic: a reader never sees a half-written file


async def _cache_write(doc_id: str, variant: str, raw: bytes) -> None:
    try:
        await asyncio.to_thread(_cache_write_sync, _cache_file(doc_id, variant), raw)
    except Exception as e:
        logger.warning(f'doc cache write failed for {doc_id}.{variant}: {e}')


def _cache_drop(doc_id: str) -> None:
    for variant in ('thumb', 'full'):
        try:
            _cache_file(doc_id, variant).unlink(missing_ok=True)
        except Exception:
            pass

# Seeded once (see seed_document_categories, called from server startup). Tuple
# shape: key, label, Ionicons name, visible_to_roles, can_record_roles.
# Note: the shop's "sales" people are `role == 'employee'` in this app, so the
# seeded visibility uses 'employee'. All of this is editable per-category in
# Settings afterward.
DEFAULT_CATEGORIES = [
    ('customer_kyc', 'Customer KYC', 'id-card-outline', ['owner', 'admin', 'employee'], ['owner', 'admin', 'employee']),
    ('ids', 'IDs', 'card-outline', ['owner', 'admin', 'employee'], ['owner', 'admin', 'employee']),
    ('supplier', 'Supplier', 'cube-outline', ['owner', 'admin'], ['owner', 'admin']),
    ('cash_sheets', 'Cash Sheets', 'cash-outline', ['owner', 'accountant'], ['owner', 'accountant']),
    ('bills', 'Bills', 'receipt-outline', ['owner', 'admin', 'accountant'], ['owner', 'admin', 'accountant']),
    ('bank_statements', 'Bank Statements', 'business-outline', ['owner', 'accountant'], ['owner', 'accountant']),
    ('expense_bills', 'Expense Bills', 'pricetags-outline', ['owner', 'admin', 'accountant'], ['owner', 'admin', 'accountant']),
    ('credit_card', 'Credit Card Statements', 'card-outline', ['owner'], ['owner']),
]


async def seed_document_categories() -> None:
    if await db.document_categories.count_documents({}) == 0:
        for i, (key, label, icon, vis, rec) in enumerate(DEFAULT_CATEGORIES):
            await db.document_categories.insert_one({
                'id': str(uuid.uuid4()), 'key': key, 'label': label, 'icon': icon,
                'visible_to_roles': vis, 'can_record_roles': rec, 'sort_order': i,
                'active': True, 'created_at': now_utc().isoformat(), 'created_by': 'system',
            })


def _role(user: dict) -> str:
    return user.get('role', '')


def _can_see(cat: dict, role: str, rights: dict = None) -> bool:
    if role == 'owner':
        return True
    # Per-person overrides (Settings › People). As soon as ANY category is set
    # for this person, the whole map is authoritative — a category not marked
    # View is denied (it does NOT fall back to the role). Only a completely
    # empty map falls back to the category's role rules, matching the on-screen
    # hint "leave every category unchecked to fall back to role defaults".
    override = (rights or {}).get('doc_category_rights') or {}
    if override:
        return bool((override.get(cat.get('key')) or {}).get('view'))
    return role in (cat.get('visible_to_roles') or [])


def _can_record(cat: dict, role: str, rights: dict = None) -> bool:
    if role == 'owner':
        return True
    override = (rights or {}).get('doc_category_rights') or {}
    if override:
        return bool((override.get(cat.get('key')) or {}).get('record'))
    return role in (cat.get('can_record_roles') or [])


def _can_see_done(user: dict, rights: dict = None) -> bool:
    """Whether this account may browse the Documents 'Done' folder. Owner always
    can; everyone else defaults to yes unless explicitly turned off per-account."""
    if _role(user) == 'owner':
        return True
    return (rights or {}).get('doc_see_done', True) is not False


async def _account_rights(user: dict) -> dict:
    """This account's saved per-category document permissions + done-folder flag,
    or {} when none are set (in which case the category's role rules apply)."""
    uid = user.get('id')
    if not uid:
        return {}
    return (await db.users.find_one({'id': uid}, {'_id': 0, 'doc_category_rights': 1, 'doc_see_done': 1})
            or await db.employees.find_one({'id': uid}, {'_id': 0, 'doc_category_rights': 1, 'doc_see_done': 1})
            or {})


async def _categories_map() -> dict:
    out = {}
    async for c in db.document_categories.find({'active': {'$ne': False}}, {'_id': 0}):
        out[c['key']] = c
    return out


async def _visible_keys(role: str, rights: dict = None) -> set:
    return {k for k, c in (await _categories_map()).items() if _can_see(c, role, rights)}


# The real Drive uploader is wired once the shop connects its Google account
# (owner-only, stores an encrypted refresh token in settings). Until then this
# is False and docs stay 'queued' locally — which is exactly the offline path,
# so the module is fully usable without Drive.
async def drive_connected() -> bool:
    doc = await db.settings.find_one({'id': 'google_drive'}, {'_id': 0})
    return bool(doc and doc.get('refresh_token'))


# ---------------- Category master ----------------
@router.get('/document-categories')
async def list_categories(all_: bool = Query(default=False, alias='all'), user=Depends(get_current)):
    """Categories this caller may see. Owner (or ?all=1 for the Settings editor,
    owner-only) gets every category; everyone else only their visible ones."""
    role = _role(user)
    cats = await db.document_categories.find({}, {'_id': 0}).sort('sort_order', 1).to_list(100)
    if all_ and role == 'owner':
        return cats
    rights = await _account_rights(user)
    # Tag each visible category with what THIS caller may do with it, resolved
    # from their per-person rights (falling back to role) — so the app can show
    # or hide the Record button correctly instead of guessing from role alone.
    out = []
    for c in cats:
        if not c.get('active', True) or not _can_see(c, role, rights):
            continue
        out.append({**c, 'can_view': True, 'can_record': _can_record(c, role, rights)})
    return out


class CategoryIn(BaseModel):
    label: str
    icon: Optional[str] = 'document-outline'
    visible_to_roles: list = []
    can_record_roles: list = []
    active: Optional[bool] = True


@router.post('/document-categories')
async def create_category(body: CategoryIn, user=Depends(require_owner)):
    label = body.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail='Label is required')
    key = re.sub(r'[^a-z0-9]+', '_', label.lower()).strip('_') or str(uuid.uuid4())[:8]
    if await db.document_categories.find_one({'key': key}):
        key = f'{key}_{str(uuid.uuid4())[:4]}'
    count = await db.document_categories.count_documents({})
    doc = {
        'id': str(uuid.uuid4()), 'key': key, 'label': label, 'icon': body.icon or 'document-outline',
        'visible_to_roles': body.visible_to_roles or ['owner'], 'can_record_roles': body.can_record_roles or ['owner'],
        'sort_order': count, 'active': body.active is not False, 'created_at': now_utc().isoformat(), 'created_by': user['name'],
    }
    await db.document_categories.insert_one(dict(doc))
    await log_audit(user, 'documents.category.create', 'document_category', doc['id'], label)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.put('/document-categories/{cat_id}')
async def update_category(cat_id: str, body: CategoryIn, user=Depends(require_owner)):
    cat = await db.document_categories.find_one({'id': cat_id}, {'_id': 0})
    if not cat:
        raise HTTPException(status_code=404, detail='Category not found')
    upd = {
        'label': body.label.strip(), 'icon': body.icon or cat.get('icon'),
        'visible_to_roles': body.visible_to_roles, 'can_record_roles': body.can_record_roles,
        'active': body.active is not False, 'updated_at': now_utc().isoformat(),
    }
    await db.document_categories.update_one({'id': cat_id}, {'$set': upd})
    await log_audit(user, 'documents.category.update', 'document_category', cat_id, upd['label'])
    return await db.document_categories.find_one({'id': cat_id}, {'_id': 0})


@router.delete('/document-categories/{cat_id}')
async def delete_category(cat_id: str, user=Depends(require_owner)):
    cat = await db.document_categories.find_one({'id': cat_id}, {'_id': 0})
    if not cat:
        raise HTTPException(status_code=404, detail='Category not found')
    n = await db.documents.count_documents({'category_key': cat['key'], 'deleted': {'$ne': True}})
    if n > 0:
        raise HTTPException(status_code=400, detail=f'This category has {n} document{"s" if n != 1 else ""} — move or delete them first, or turn the category off instead.')
    await db.document_categories.delete_one({'id': cat_id})
    await log_audit(user, 'documents.category.delete', 'document_category', cat_id, cat.get('label', ''))
    return {'ok': True}


# ---------------- Documents ----------------
_LIST_PROJECTION = {'_id': 0, 'local_data': 0, 'thumb_data': 0, 'ocr': 0}  # never ship raw bytes in a list


@router.post('/documents')
async def create_document(
    file: UploadFile = File(...),
    category_key: str = Form(...),
    note: str = Form(default=''),
    thumb: str = Form(default=''),   # small base64 JPEG (images only) for fast grid
    client_id: str = Form(default=''),   # idempotency key from the upload queue
    pages: int = Form(default=0),        # >1 for a multi-photo PDF made by Quick Capture
    user=Depends(get_current),
):
    """Capture: create a PENDING doc immediately and return fast. The bytes are
    kept locally (base64) so it works offline; the Drive upload is queued."""
    # Idempotency: if the upload queue retries after a timeout where we actually
    # saved the doc, return the existing one instead of creating a duplicate.
    if client_id:
        existing = await db.documents.find_one({'client_id': client_id, 'deleted': {'$ne': True}}, _LIST_PROJECTION)
        if existing:
            return existing
    cats = await _categories_map()
    cat = cats.get(category_key)
    if not cat:
        raise HTTPException(status_code=404, detail='Unknown category')
    rights = await _account_rights(user)
    # Uploading a document is a VIEW-level right: anyone who can see the
    # category may add photos into its Pending tab. RECORD is only needed to
    # then mark a pending document as done (see record_document below).
    if not _can_see(cat, _role(user), rights):
        raise HTTPException(status_code=403, detail='You do not have access to this category')
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail='Empty file')
    # Absolute ceiling to bound server memory (the whole file is read in). Well
    # above any realistic scanned document.
    if len(raw) > 60 * 1024 * 1024:
        raise HTTPException(status_code=400, detail='File too large (max 60 MB).')

    import drive_service
    connected = await drive_service.is_connected()
    # A small client-made thumbnail (images only) lets us drop the heavy
    # full-size copy once it's safely in Drive, while grid views stay instant.
    thumb_clean = ''
    if thumb:
        thumb_clean = thumb.split(',', 1)[-1].strip()   # tolerate a data-URL prefix

    mime = file.content_type or 'image/jpeg'
    orig_name = file.filename or 'capture.jpg'
    now_iso = now_utc().isoformat()
    base_doc = {
        'id': str(uuid.uuid4()), 'category_key': category_key, 'status': 'pending',
        'client_id': client_id or None,
        'linked_ref': None, 'note': (note or '').strip(),
        'uploaded_by': user['id'], 'uploaded_by_name': user['name'],
        'created_at': now_iso, 'recorded_at': None, 'recorded_by': None, 'recorded_by_name': None,
        'last_pending_reminder_at': None,
        'ocr': {'text': None, 'fields': {}, 'status': 'none'},
        'deleted': False,
        # Photos captured in one stretch arrive merged as ONE multi-page PDF; the
        # count lets the grid badge it and show the first page as its cover.
        'pages': pages if 1 < pages <= 200 else None,
    }

    # The bytes are normally stored inline as base64 in the Mongo document, and
    # base64 inflates size by ~4/3 against MongoDB's 16 MB per-document cap — so
    # a file over ~11 MB can't be inlined. Those STREAM STRAIGHT TO GOOGLE DRIVE
    # here (no copy kept in the database), landing as a Drive-only document just
    # like a small one becomes after the background sync. Anything the database
    # can hold still takes the fast inline path (instant return, offline-safe).
    INLINE_MAX = 11 * 1024 * 1024
    if len(raw) > INLINE_MAX:
        if not connected:
            raise HTTPException(
                status_code=400,
                detail='This file is too large to store without Google Drive. Ask the owner to connect Google Drive in Settings, then upload it again.',
            )
        cfg = await drive_service.get_config()
        file_meta = {'drive_file_id': None, 'mime': mime, 'size': len(raw), 'orig_name': orig_name}
        try:
            res = await drive_service.upload_raw(
                cfg, cat.get('label', category_key),
                _drive_filename({**base_doc, 'file': file_meta}, cat), raw, mime,
            )
        except Exception:
            # Transient Drive/network failure → 502 so the upload queue RETRIES
            # (not a permanent 4xx), instead of losing the file.
            raise HTTPException(status_code=502, detail='Could not reach Google Drive — will retry.')
        doc = {
            **base_doc,
            'local_data': thumb_clean or None,
            'local_kind': 'thumb' if thumb_clean else 'none',   # full-size lives only in Drive
            'thumb_data': None,
            'file': {'drive_file_id': res['drive_file_id'], 'drive_view_link': res['drive_view_link'],
                     'drive_thumbnail_link': res['drive_thumbnail_link'],
                     'mime': mime, 'size': len(raw), 'orig_name': orig_name},
            'upload_state': 'synced',
        }
    else:
        doc = {
            **base_doc,
            'local_data': base64.b64encode(raw).decode('ascii'),
            'local_kind': 'full',                # 'full' | 'thumb' | 'none' (Drive-only)
            'thumb_data': thumb_clean or None,
            'file': {'drive_file_id': None, 'drive_view_link': None, 'drive_thumbnail_link': None,
                     'mime': mime, 'size': len(raw), 'orig_name': orig_name},
            # 'queued' → the worker uploads it; 'local' → no Drive yet, lives
            # locally until the owner connects Google (then re-queued).
            'upload_state': 'queued' if connected else 'local',
        }
    await db.documents.insert_one(dict(doc))
    # The thumbnail is already in memory — cache it now, so the first time this
    # photo shows up in the grid it doesn't have to be read back out of Mongo.
    if thumb_clean:
        try:
            await _cache_write(doc['id'], 'thumb', base64.b64decode(thumb_clean))
        except Exception:
            pass
    # Likewise the original: once it syncs to Drive the database keeps only the
    # thumbnail, so without this the FIRST time anyone opens the photo would be a
    # multi-second Google download. (Capped — nothing above 30 MB is worth a copy.)
    if len(raw) <= 30 * 1024 * 1024:
        await _cache_write(doc['id'], 'full', raw)
    await log_audit(user, 'documents.create', 'document', doc['id'], f'{cat["label"]} · {doc["file"]["orig_name"]}')
    await _notify_record_holders(cat, doc, user)
    return {k: v for k, v in doc.items() if k not in ('_id', 'local_data', 'ocr')}


async def _notify_record_holders(cat: dict, doc: dict, actor: dict) -> None:
    """Tell whoever can RECORD this category that a new document is waiting —
    resolved per person from their record rights (falling back to role). Skips
    the person who captured it. Gated by each recipient's master notification
    switch (handled inside notify_user)."""
    from server import notify_user
    title = f'New {cat.get("label", "document")} to record'
    body = (doc.get('note') or (doc.get('file') or {}).get('orig_name') or 'A document was captured.')[:120]
    actor_id = actor.get('id')
    proj = {'_id': 0, 'id': 1, 'role': 1, 'doc_category_rights': 1, 'status': 1}
    sent = set()
    try:
        async for u in db.users.find({}, proj):
            if u['id'] == actor_id:
                continue
            if _can_record(cat, u.get('role', ''), u):
                await notify_user(u['id'], title, body, '/documents?tab=pending')
                sent.add(u['id'])
        async for e in db.employees.find({'status': {'$ne': 'inactive'}}, proj):
            if e['id'] == actor_id or e['id'] in sent:
                continue
            if _can_record(cat, 'employee', e):
                await notify_user(e['id'], title, body, '/documents?tab=pending')
    except Exception:
        pass


async def _notify_document_done(cat: dict, doc: dict, actor: dict) -> None:
    """Tell owner/admin a document was filed into Done — gated by each
    recipient's own 'document_recorded' preference (Settings › People ›
    Alerts), independent of the pending-reminder toggle below. Skips the
    actor themselves, same as the pending-doc notify above."""
    from server import notify_user, _wants_script
    title = f'{cat.get("label", "Document")} recorded'
    body = ((doc.get('linked_ref') or {}).get('label') or doc.get('note') or 'Moved to Done.')[:120]
    proj = {'_id': 0, 'id': 1, 'role': 1, 'notifications_enabled': 1, 'notif_prefs': 1}
    try:
        async for u in db.users.find({'role': {'$in': ['owner', 'admin']}}, proj):
            if u['id'] == actor.get('id'):
                continue
            if _wants_script(u, u.get('role', ''), 'documents', 'document_recorded'):
                await notify_user(u['id'], title, body, '/documents?tab=done')
    except Exception:
        pass


PENDING_REMINDER_GRACE_HOURS = 24  # "pending for more than 1 day" — also the repeat spacing thereafter


async def check_pending_reminders() -> None:
    """Daily nudge: any document still pending after PENDING_REMINDER_GRACE_HOURS
    gets its record-holders notified again — same audience as the initial
    "new document to record" alert — repeating roughly once a day until it's
    recorded (or deleted). Gated by each recipient's own
    'document_pending_reminder' preference, independent of the "recorded"
    toggle above. Called from the server's existing 15-minute reminder loop,
    not a dedicated one — this only ever needs day-granularity."""
    from server import notify_user, now_utc, _wants_script
    cutoff = (now_utc() - timedelta(hours=PENDING_REMINDER_GRACE_HOURS)).isoformat()
    cats = await _categories_map()
    async for d in db.documents.find(
        {'deleted': {'$ne': True}, 'status': 'pending', 'created_at': {'$lt': cutoff},
         '$or': [{'last_pending_reminder_at': None}, {'last_pending_reminder_at': {'$lt': cutoff}}]},
        {'_id': 0},
    ):
        cat = cats.get(d['category_key'])
        if not cat:
            continue
        await db.documents.update_one({'id': d['id']}, {'$set': {'last_pending_reminder_at': now_utc().isoformat()}})
        title = f'Still pending: {cat.get("label", "document")}'
        body = (d.get('note') or (d.get('file') or {}).get('orig_name') or 'Waiting to be recorded.')[:120]
        proj = {'_id': 0, 'id': 1, 'role': 1, 'notifications_enabled': 1, 'notif_prefs': 1}
        sent = set()
        try:
            async for u in db.users.find({}, proj):
                if _can_record(cat, u.get('role', ''), u) and _wants_script(u, u.get('role', ''), 'documents', 'document_pending_reminder'):
                    await notify_user(u['id'], title, body, '/documents?tab=pending')
                    sent.add(u['id'])
            async for e in db.employees.find({'status': {'$ne': 'inactive'}}, proj):
                if e['id'] in sent:
                    continue
                if _can_record(cat, 'employee', e) and _wants_script(e, 'employee', 'documents', 'document_pending_reminder'):
                    await notify_user(e['id'], title, body, '/documents?tab=pending')
        except Exception:
            pass


@router.get('/documents')
async def list_documents(
    status: Optional[str] = None, category: Optional[str] = None, q: Optional[str] = None,
    cursor: Optional[str] = None, limit: int = 50,
    user=Depends(get_current),
):
    role = _role(user)
    rights = await _account_rights(user)
    visible = await _visible_keys(role, rights)
    limit = max(1, min(limit, 200))
    query: dict = {'deleted': {'$ne': True}, 'category_key': {'$in': list(visible)}}
    if category and category != 'all':
        if category not in visible:
            raise HTTPException(status_code=403, detail='No access to this category')
        query['category_key'] = category
    if status in ('pending', 'done'):
        # Someone without Done-folder access can never list done documents.
        if status == 'done' and not _can_see_done(user, rights):
            return {'items': [], 'next_cursor': None}
        query['status'] = status
    if q and q.strip():
        q_esc = re.escape(q.strip())
        query['$or'] = [
            {'note': {'$regex': q_esc, '$options': 'i'}},
            {'file.orig_name': {'$regex': q_esc, '$options': 'i'}},
            {'linked_ref.label': {'$regex': q_esc, '$options': 'i'}},
        ]
    if cursor:
        query['created_at'] = {'$lt': cursor}
    items = await db.documents.find(query, _LIST_PROJECTION).sort('created_at', -1).to_list(limit + 1)
    next_cursor = items[limit]['created_at'] if len(items) > limit else None
    return {'items': items[:limit], 'next_cursor': next_cursor}


@router.get('/documents/summary')
async def documents_summary(user=Depends(get_current)):
    """Role-filtered counts — feeds the Work row and Home needs-attention item."""
    import drive_service
    connected = await drive_service.is_connected()
    role = _role(user)
    rights = await _account_rights(user)
    visible = await _visible_keys(role, rights)
    can_see_done = _can_see_done(user, rights)
    pending = 0
    done = 0
    uploading = 0
    by_category: dict = {}
    # One grouped count over an index that holds every field it touches (see
    # the summary_covering index in seed()) — so MongoDB answers from the index
    # alone. This used to stream every document to the server just to count
    # three small fields, and since documents carry their image bytes inline,
    # that meant reading the whole collection on every Work/Home/Documents load.
    async for g in db.documents.aggregate([
        {'$match': {'deleted': {'$ne': True}, 'category_key': {'$in': list(visible)}}},
        {'$group': {'_id': {'c': '$category_key', 's': '$status', 'u': '$upload_state'}, 'n': {'$sum': 1}}},
    ]):
        key, n = g['_id'], g['n']
        b = by_category.setdefault(key['c'], {'pending': 0, 'done': 0})
        if key['s'] == 'pending':
            pending += n; b['pending'] += n
        else:
            done += n; b['done'] += n
        # Only count as "uploading" when Drive is actually connected and working.
        if connected and key['u'] in ('queued', 'uploading'):
            uploading += n
    if not can_see_done:
        done = 0
        for b in by_category.values():
            b['done'] = 0
    return {'pending_count': pending, 'done_count': done, 'uploading_count': uploading,
            'by_category': by_category, 'drive_connected': connected, 'can_see_done': can_see_done}


class RecordIn(BaseModel):
    linked_ref_type: Optional[str] = None      # customer|karigar|employee|repair|cashbook|bill
    linked_ref_id: Optional[str] = None
    linked_ref_label: Optional[str] = None
    note: Optional[str] = None


@router.patch('/documents/{doc_id}/record')
async def record_document(doc_id: str, body: RecordIn, user=Depends(get_current)):
    """Pending → Done. Links the doc to the real record it proves. Only roles in
    the category's can_record_roles may do this."""
    d = await db.documents.find_one({'id': doc_id, 'deleted': {'$ne': True}}, {'_id': 0, 'local_data': 0})
    if not d:
        raise HTTPException(status_code=404, detail='Document not found')
    cats = await _categories_map()
    cat = cats.get(d['category_key'])
    rights = await _account_rights(user)
    if not cat or not _can_see(cat, _role(user), rights):
        raise HTTPException(status_code=403, detail='No access to this document')
    if not _can_record(cat, _role(user), rights):
        raise HTTPException(status_code=403, detail='You do not have permission to record this category')
    upd = {
        'status': 'done', 'recorded_at': now_utc().isoformat(), 'recorded_by': user['id'], 'recorded_by_name': user['name'],
        'linked_ref': ({'type': body.linked_ref_type, 'id': body.linked_ref_id, 'label': body.linked_ref_label}
                       if body.linked_ref_type else None),
    }
    if body.note is not None:
        upd['note'] = body.note.strip()
    await db.documents.update_one({'id': doc_id}, {'$set': upd})
    await log_audit(user, 'documents.record', 'document', doc_id, body.linked_ref_label or cat['label'])
    await _notify_document_done(cat, {**d, **upd}, user)
    return await db.documents.find_one({'id': doc_id}, _LIST_PROJECTION)


@router.patch('/documents/{doc_id}/unrecord')
async def unrecord_document(doc_id: str, user=Depends(get_current)):
    """Done → Pending. Undo an accidental record — same permission as recording
    it in the first place (whoever can file a category can also un-file it)."""
    d = await db.documents.find_one({'id': doc_id, 'deleted': {'$ne': True}}, {'_id': 0, 'local_data': 0})
    if not d:
        raise HTTPException(status_code=404, detail='Document not found')
    if d.get('status') != 'done':
        raise HTTPException(status_code=400, detail='This document is not recorded')
    cats = await _categories_map()
    cat = cats.get(d['category_key'])
    rights = await _account_rights(user)
    if not cat or not _can_see(cat, _role(user), rights):
        raise HTTPException(status_code=403, detail='No access to this document')
    if not _can_record(cat, _role(user), rights):
        raise HTTPException(status_code=403, detail='You do not have permission to undo a record in this category')
    await db.documents.update_one({'id': doc_id}, {'$set': {
        'status': 'pending', 'recorded_at': None, 'recorded_by': None, 'recorded_by_name': None, 'linked_ref': None,
    }})
    await log_audit(user, 'documents.unrecord', 'document', doc_id, cat['label'])
    return await db.documents.find_one({'id': doc_id}, _LIST_PROJECTION)


class RecategorizeIn(BaseModel):
    category_key: str


@router.patch('/documents/{doc_id}/category')
async def recategorize_document(doc_id: str, body: RecategorizeIn, user=Depends(get_current)):
    """Move a document to a different category (e.g. it was filed under the wrong
    one). Needs record permission on the target category."""
    d = await db.documents.find_one({'id': doc_id, 'deleted': {'$ne': True}}, {'_id': 0, 'local_data': 0})
    if not d:
        raise HTTPException(status_code=404, detail='Document not found')
    cats = await _categories_map()
    rights = await _account_rights(user)
    old = cats.get(d['category_key'])
    new = cats.get(body.category_key)
    if not new:
        raise HTTPException(status_code=404, detail='Unknown category')
    if not old or not _can_see(old, _role(user), rights):
        raise HTTPException(status_code=403, detail='No access to this document')
    if not _can_record(new, _role(user), rights):
        raise HTTPException(status_code=403, detail='You do not have permission to file into that category')
    await db.documents.update_one({'id': doc_id}, {'$set': {'category_key': body.category_key}})
    _forget(doc_id)
    await log_audit(user, 'documents.recategorize', 'document', doc_id, f"{d['category_key']} → {body.category_key}")
    return await db.documents.find_one({'id': doc_id}, _LIST_PROJECTION)


@router.delete('/documents/{doc_id}')
async def delete_document(doc_id: str, user=Depends(get_current)):
    if _role(user) not in ('owner', 'admin'):
        raise HTTPException(status_code=403, detail='Only owner/admin can delete documents')
    d = await db.documents.find_one({'id': doc_id}, {'_id': 0, 'local_data': 0})
    if not d:
        raise HTTPException(status_code=404, detail='Document not found')
    # Delete everywhere: remove the original from Google Drive (if synced), then
    # remove the record + any local bytes from this server.
    drive_id = (d.get('file') or {}).get('drive_file_id')
    if drive_id:
        try:
            import drive_service
            cfg = await drive_service.get_config()
            await drive_service.delete_file(cfg, drive_id)
        except Exception:
            pass   # Drive delete failed — still remove from the app below
    await db.documents.delete_one({'id': doc_id})
    _cache_drop(doc_id)
    _forget(doc_id)
    await log_audit(user, 'documents.delete', 'document', doc_id, (d.get('file') or {}).get('orig_name', ''))
    return {'ok': True}


async def _load_variant(meta: dict, doc_id: str, variant: str):
    """Fetch one variant's bytes from Mongo / Google Drive. Returns
    (bytes, cacheable) — bytes is None when this document has no such image.
    `cacheable` is False for a stand-in (e.g. the thumbnail served because the
    full-size original couldn't be fetched): caching that under "full" would pin
    a low-resolution copy there for good."""
    async with _BLOB_SLOTS:
        if variant == 'thumb':
            row = await db.documents.find_one({'id': doc_id}, {'_id': 0, 'thumb_data': 1, 'local_data': 1, 'local_kind': 1}) or {}
            data = row.get('thumb_data') or (row.get('local_data') if row.get('local_kind') == 'thumb' else None)
            return (base64.b64decode(data) if data else None), True
        local_kind = meta.get('local_kind', 'full')
        drive_id = (meta.get('file') or {}).get('drive_file_id')
        if local_kind == 'full':
            row = await db.documents.find_one({'id': doc_id}, {'_id': 0, 'local_data': 1}) or {}
            if row.get('local_data'):
                return base64.b64decode(row['local_data']), True
        if drive_id:
            try:
                import drive_service
                cfg = await drive_service.get_config()
                return await drive_service.download(cfg, drive_id), True
            except Exception:
                pass   # fall through to whatever local copy still exists
        # Stand-in when the original can't be fetched: use the thumbnail already
        # saved on disk rather than reading it out of Mongo a second time (~1 s).
        tp = _cache_file(doc_id, 'thumb')
        if tp.is_file():
            return await asyncio.to_thread(tp.read_bytes), False
        row = await db.documents.find_one({'id': doc_id}, {'_id': 0, 'local_data': 1, 'thumb_data': 1}) or {}
        data = row.get('local_data') or row.get('thumb_data')
        return (base64.b64decode(data) if data else None), False


@router.get('/documents/{doc_id}/file')
async def document_file(
    doc_id: str, full: bool = Query(default=False), thumb: bool = Query(default=False), user=Depends(get_current),
):
    """Serve a document's image. `?thumb=1` is the small grid thumbnail;
    `?full=1` is the full-size original (fetched from Drive when only a
    thumbnail is still held locally); with neither, the best local copy.
    Permission-checked against the caller's category visibility exactly as
    before — but the permission check reads only the document's metadata, and
    the image itself is served from the on-disk cache once it has been fetched
    a single time (see DOC_CACHE_DIR above)."""
    d = await _memo(('meta', doc_id), 60, lambda: db.documents.find_one(
        {'id': doc_id, 'deleted': {'$ne': True}}, {'_id': 0, 'local_data': 0, 'thumb_data': 0, 'ocr': 0}))
    if not d:
        raise HTTPException(status_code=404, detail='Document not found')
    cats = await _memo(('cats',), 30, _categories_map)
    cat = cats.get(d['category_key'])
    rights = await _memo(('rights', user.get('id')), 30, lambda: _account_rights(user))
    if not cat or not _can_see(cat, _role(user), rights):
        raise HTTPException(status_code=403, detail='No access to this document')
    mime = (d.get('file') or {}).get('mime', 'image/jpeg')
    local_kind = d.get('local_kind', 'full')
    if thumb:
        variant = 'thumb'
    elif full:
        variant = 'full'
    else:
        variant = 'full' if local_kind == 'full' else 'thumb'
    media_type = 'image/jpeg' if variant == 'thumb' else mime
    cache_headers = {'Cache-Control': f'private, max-age={_CACHE_TTL_SECONDS}'}

    path = _cache_file(doc_id, variant)
    if path.is_file():
        return FileResponse(path, media_type=media_type, headers=cache_headers)

    raw, cacheable = await _load_variant(d, doc_id, variant)
    if not raw:
        raise HTTPException(status_code=404, detail='No local copy (see Drive link)')
    if not cacheable:
        return Response(content=raw, media_type=media_type)
    await _cache_write(doc_id, variant, raw)
    return Response(content=raw, media_type=media_type, headers=cache_headers)


# Don't let the cache of originals grow without bound on the shop server's disk.
_FULL_CACHE_BUDGET_BYTES = 2 * 1024 ** 3


def _cache_dir_bytes() -> int:
    try:
        return sum(f.stat().st_size for f in DOC_CACHE_DIR.iterdir() if f.is_file())
    except Exception:
        return 0


async def doc_cache_warm_loop() -> None:
    """Fills the image cache for documents that predate it, in the background,
    so nobody's first look at a photo is the slow one. New uploads are written
    to the cache as they arrive, so after the first pass there is normally
    nothing left to do. Thumbnails first (they're what the grid needs), then the
    full-size originals — which otherwise cost a 2-5 s Google Drive download the
    first time each one is opened. Gentle by design: one image at a time,
    through the same limiter the request path uses."""
    await asyncio.sleep(45)
    while True:
        try:
            names = os.listdir(DOC_CACHE_DIR) if DOC_CACHE_DIR.is_dir() else []
            have_thumb = {n[:-len('.thumb')] for n in names if n.endswith('.thumb')}
            have_full = {n[:-len('.full')] for n in names if n.endswith('.full')}
            rows = await db.documents.find(
                {'deleted': {'$ne': True}}, {'_id': 0, 'id': 1, 'local_kind': 1, 'file': 1},
            ).to_list(None)
            thumbs = [r for r in rows if (r.get('file') or {}).get('mime', '').startswith('image/') and r['id'] not in have_thumb]
            fulls = [r for r in rows if r['id'] not in have_full and (r.get('local_kind') == 'full' or (r.get('file') or {}).get('drive_file_id'))]
            if thumbs or fulls:
                logger.info(f'doc cache: warming {len(thumbs)} thumbnail(s), {len(fulls)} original(s)')
            for r in thumbs:
                raw, cacheable = await _load_variant(r, r['id'], 'thumb')
                if raw and cacheable:
                    await _cache_write(r['id'], 'thumb', raw)
                await asyncio.sleep(0.2)
            for r in fulls:
                if await asyncio.to_thread(_cache_dir_bytes) > _FULL_CACHE_BUDGET_BYTES:
                    logger.warning('doc cache: size budget reached, not fetching more originals')
                    break
                raw, cacheable = await _load_variant(r, r['id'], 'full')
                if raw and cacheable:
                    await _cache_write(r['id'], 'full', raw)
                await asyncio.sleep(0.5)
        except Exception as e:
            logger.warning(f'doc cache warm error: {e}')
        await asyncio.sleep(3600)


# ---------------- Google Drive (owner) ----------------
def _drive_filename(doc: dict, cat: dict) -> str:
    """`<record-or-name>_<date>.<ext>` so Drive stays browsable on its own."""
    orig = (doc.get('file') or {}).get('orig_name') or 'document'
    ext = orig.rsplit('.', 1)[-1] if '.' in orig else 'jpg'
    lr = doc.get('linked_ref') or {}
    base = (lr.get('label') or doc.get('note') or orig.rsplit('.', 1)[0] or cat.get('label', 'doc'))
    base = re.sub(r'[^\w\- ]+', '', str(base)).strip()[:60] or 'document'
    date = (doc.get('created_at') or '')[:10]
    return f'{base}_{date}.{ext}'


@router.get('/google-drive/status')
async def drive_status(user=Depends(require_owner)):
    import drive_service
    cfg = await drive_service.get_config()
    return {
        'connected': bool(cfg.get('refresh_token')),
        'email': cfg.get('email'),
        'env_ready': drive_service.env_ready(),
        'connected_at': cfg.get('connected_at'),
        'auth_error': cfg.get('auth_error'),
    }


@router.get('/google-drive/auth-url')
async def drive_auth_url(user=Depends(require_owner)):
    import drive_service
    if not drive_service.env_ready():
        raise HTTPException(status_code=400, detail='Google credentials not configured on the server (GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI).')
    state = str(uuid.uuid4())
    await db.settings.update_one({'id': 'google_drive'}, {'$set': {'id': 'google_drive', 'oauth_state': state}}, upsert=True)
    return {'url': drive_service.auth_url(state)}


@router.get('/google-drive/callback')
async def drive_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    """Google redirects the owner's browser here after consent. No bearer token —
    validated by the one-time `state` we issued. Returns a plain HTML page."""
    import drive_service

    def page(msg: str, ok: bool) -> HTMLResponse:
        color = '#5FB07E' if ok else '#E5695B'
        return HTMLResponse(f"<html><body style='background:#0B0B0C;color:#F4F3EF;font-family:-apple-system,sans-serif;text-align:center;padding:60px'>"
                            f"<div style='font-size:44px;color:{color}'>{'✓' if ok else '✕'}</div>"
                            f"<h2>{msg}</h2><p style='color:#B7B6B0'>You can close this tab and return to RMJ One.</p></body></html>")

    if error or not code:
        return page('Google Drive was not connected.', False)
    cfg = await drive_service.get_config()
    if not state or state != cfg.get('oauth_state'):
        return page('Link expired — please start again from Settings.', False)
    try:
        refresh_token, email = await drive_service.exchange_code(code)
    except Exception:
        return page('Could not complete the Google sign-in.', False)
    if not refresh_token:
        return page('Google did not return a refresh token — remove RMJ One from your Google account permissions and try again.', False)
    await db.settings.update_one({'id': 'google_drive'}, {'$set': {
        'refresh_token': refresh_token, 'email': email, 'connected_at': now_utc().isoformat(), 'oauth_state': None,
        'auth_error': None, 'auth_error_at': None,
    }}, upsert=True)
    # Any docs/photos captured while offline/unconnected can now sync.
    await db.documents.update_many({'upload_state': {'$in': ['local', 'failed']}, 'deleted': {'$ne': True}}, {'$set': {'upload_state': 'queued'}})
    await db.record_photos.update_many({'upload_state': {'$in': ['local', 'failed']}, 'deleted': {'$ne': True}}, {'$set': {'upload_state': 'queued'}})
    return page('Google Drive connected.', True)


@router.post('/google-drive/disconnect')
async def drive_disconnect(user=Depends(require_owner)):
    await db.settings.update_one({'id': 'google_drive'}, {'$set': {'refresh_token': None, 'email': None, 'connected_at': None}})
    await log_audit(user, 'documents.drive.disconnect', 'settings', 'google_drive', '')
    return {'ok': True}


# Background worker (started from server.py). Uploads one queued doc per tick to
# keep memory flat; flips 'synced' with the Drive links, or 'failed' on error.
async def upload_worker():
    import drive_service
    while True:
        try:
            if await drive_service.is_connected():
                cfg = await drive_service.get_config()
                # 'uploading' here can only be a doc orphaned by a prior process
                # dying mid-upload — this loop never leaves one in that state while
                # also polling, so it's safe to treat it as re-queued.
                doc = await db.documents.find_one({'upload_state': {'$in': ['queued', 'uploading']}, 'deleted': {'$ne': True}, 'local_data': {'$ne': None}}, {'_id': 0})
                if doc:
                    await db.documents.update_one({'id': doc['id']}, {'$set': {'upload_state': 'uploading'}})
                    try:
                        cat = (await _categories_map()).get(doc['category_key'], {})
                        res = await drive_service.upload(cfg, cat.get('label', doc['category_key']), _drive_filename(doc, cat), doc['local_data'], (doc.get('file') or {}).get('mime', 'image/jpeg'))
                        # Now that the original is safely in Drive, free the heavy
                        # local copy: keep the small thumbnail for a fast grid if
                        # we have one, otherwise go Drive-only (full-size is then
                        # fetched from Drive on demand). This is what stops the
                        # database from ballooning with full-size base64.
                        thumb = doc.get('thumb_data')
                        set_fields = {
                            'upload_state': 'synced',
                            'file.drive_file_id': res['drive_file_id'],
                            'file.drive_view_link': res['drive_view_link'],
                            'file.drive_thumbnail_link': res['drive_thumbnail_link'],
                            'local_data': thumb or None,
                            'local_kind': 'thumb' if thumb else 'none',
                            'thumb_data': None,
                        }
                        await db.documents.update_one({'id': doc['id']}, {'$set': set_fields})
                    except Exception as e:
                        err = str(e)[:200]
                        await db.documents.update_one({'id': doc['id']}, {'$set': {'upload_state': 'failed', 'upload_error': err}})
                        if 'invalid_grant' in err or 'invalid_client' in err:
                            await _notify_system_health('drive_disconnected', 'Google Drive disconnected',
                                                         'Google Drive needs to be reconnected — document uploads and backups are paused (Settings > Google Drive).', '/settings/google-drive')
                        else:
                            await _notify_system_health('drive_upload_failed', 'Document upload failed',
                                                         f'A document failed to upload to Google Drive: {err}', '/settings/google-drive')
                    continue  # grab the next queued doc without waiting
        except Exception:
            pass
        await asyncio.sleep(6)
