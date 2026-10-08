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
from typing import List, Optional
from pydantic import BaseModel, Field
import asyncio
import threading
import base64
import logging
import os
import pathlib
import re
import time
import uuid
from datetime import timedelta

from server import db, now_utc, get_current, require_owner, log_audit, _notify_system_health, resolve_modules

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


def replace_file(tmp: pathlib.Path, path: pathlib.Path) -> None:
    """Move a finished temp file into place. On Windows the move is refused
    while someone is still reading the old file (e.g. two people opening the
    same photo at once); then the copy already there is just as good, so the
    temp file is dropped instead of failing the request."""
    for attempt in range(3):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt < 2:
                time.sleep(0.05)
    try:
        tmp.unlink()
    except OSError:
        pass
    if not path.exists():
        raise PermissionError(f'could not write {path.name}')


def _cache_write_sync(path: pathlib.Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'{path.name}.{uuid.uuid4().hex}.tmp')
    tmp.write_bytes(raw)
    replace_file(tmp, path)   # atomic: a reader never sees a half-written file


async def _cache_write(doc_id: str, variant: str, raw: bytes) -> None:
    try:
        await asyncio.to_thread(_cache_write_sync, _cache_file(doc_id, variant), raw)
    except Exception as e:
        logger.warning(f'doc cache write failed for {doc_id}.{variant}: {e}')


def _cache_drop(doc_id: str) -> None:
    for variant in ('thumb', 'view', 'full'):
        try:
            _cache_file(doc_id, variant).unlink(missing_ok=True)
        except Exception:
            pass
    try:
        _cache_file(doc_id, 'thumb')   # validates the id
        for f in DOC_CACHE_DIR.glob(f'{doc_id}.page*'):
            f.unlink(missing_ok=True)
    except Exception:
        pass

# This directory is a TEMPORARY cache, not storage: Google Drive holds the only
# permanent copy of every document and photo (the shop doesn't want them kept on
# this computer). `.full` is the untouched original, `.view` a readable-size copy
# the app shows on screen (long side <= 1600 px, ~200-400 KB — text stays sharp but
# a photo doesn't drag on a phone's connection), `.thumb` the small grid thumbnail.
# A file that has reached Drive is deleted from here once it hasn't been opened for
# CACHE_RETAIN_DAYS, or oldest-first when the cache passes CACHE_RETAIN_BYTES (see
# doc_store_maintenance_loop); opening it later simply fetches it from Drive again.
# Nothing not yet in Drive is ever deleted. Only the tiny thumbnails are kept.
CACHE_RETAIN_DAYS = 7
# The untouched original (`.full`) of a document that's in Drive is kept at most a
# day after it was last used; the on-screen copy and thumbnails are the cache above —
# except for a document marked done, whose on-screen copy also goes after a day.
FULL_RETAIN_DAYS = 1
CACHE_RETAIN_BYTES = 1024 ** 3
THUMB_SIDE = 240
VIEW_MAX_SIDE = 1600
VIEW_QUALITY = 82
_VIEW_REUSE_BYTES = 600 * 1024   # an already-small JPEG is served as-is


MAX_PDF_PAGES = 200   # pages shown in the app; Open / Share still give the whole file

# PDFium (the PDF engine) must never run on two threads at once - it isn't
# thread-safe, and overlapping calls crash the whole server process ("double
# free or corruption"). Opening a PDF asks for all its pages together, so every
# PDFium call below holds this lock: pages are drawn one after another.
_PDFIUM = threading.Lock()


def _can_draw_pdfs() -> bool:
    try:
        import pypdfium2  # noqa: F401
        return True
    except Exception:
        return False


def _is_pdf(raw: bytes) -> bool:
    return raw[:1024].lstrip().startswith(b'%PDF')


def _pdf_info_sync(raw: bytes) -> tuple:
    """(pages, locked): pages is None when PDFs can't be read here (pypdfium2
    missing or a broken file) — the app then just offers Open; locked is True
    for a password-protected PDF (the app offers to unlock it)."""
    try:
        import pypdfium2
        with _PDFIUM:
            pdf = pypdfium2.PdfDocument(raw)
            try:
                return len(pdf), False
            finally:
                pdf.close()
    except Exception as e:
        return None, 'password' in str(e).lower()


class PdfPasswordError(Exception):
    pass


def _unlock_pdf_sync(raw: bytes, password: str) -> bytes:
    """The same PDF with its password removed. Raises PdfPasswordError for a
    wrong password, ValueError if it isn't a PDF that can be read."""
    import io
    import pypdfium2
    import pypdfium2.raw as pdfium_c
    with _PDFIUM:
        try:
            pdf = pypdfium2.PdfDocument(raw, password=password)
        except Exception as e:
            if 'password' in str(e).lower():
                raise PdfPasswordError() from e
            raise ValueError('not a readable PDF') from e
        try:
            out = io.BytesIO()
            pdf.save(out, flags=pdfium_c.FPDF_REMOVE_SECURITY)
            return out.getvalue()
        finally:
            pdf.close()


# ---- Saved PDF passwords ----
# Banks use the same password for every statement, so passwords that worked are
# remembered (db.pdf_passwords) and tried first: a statement with a known
# password unlocks with no question. Only the owner can see or change the list
# (Settings › PDF passwords). They're stored encrypted with a key made from the
# server's JWT_SECRET, so the database backups and the Atlas copy never hold
# them readable. (If JWT_SECRET ever changes, the old ones just stop working.)
def _pw_box():
    import hashlib
    from cryptography.fernet import Fernet
    from server import JWT_SECRET
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(f'rmj-pdf-passwords:{JWT_SECRET}'.encode()).digest()))


async def _saved_passwords() -> list:
    """[(id, password)], most recently used first."""
    box, out = _pw_box(), []
    async for r in db.pdf_passwords.find({}, {'_id': 0, 'id': 1, 'secret': 1}).sort([('last_used_at', -1), ('created_at', -1)]):
        try:
            out.append((r['id'], box.decrypt(r['secret'].encode()).decode()))
        except Exception:
            pass   # made with another JWT_SECRET
    return out


async def _remember_password(password: str, user: dict, label: str = '', used: bool = True) -> None:
    """Save a password (encrypted) unless it's already saved. `used`: it just
    unlocked a PDF (vs typed in by the owner in Settings)."""
    if not password or any(p == password for _, p in await _saved_passwords()):
        return
    now = now_utc().isoformat()
    await db.pdf_passwords.insert_one({
        'id': str(uuid.uuid4()), 'secret': _pw_box().encrypt(password.encode()).decode(), 'label': label.strip()[:60],
        'created_at': now, 'created_by': user.get('name'), 'last_used_at': now if used else None, 'uses': 1 if used else 0,
    })


async def _try_saved_passwords(raw: bytes):
    """The PDF unlocked with a saved password, or None if none of them fit."""
    for pid, pw in await _saved_passwords():
        try:
            out = await asyncio.to_thread(_unlock_pdf_sync, raw, pw)
        except PdfPasswordError:
            continue
        except ValueError:
            return None
        await db.pdf_passwords.update_one({'id': pid}, {'$set': {'last_used_at': now_utc().isoformat()}, '$inc': {'uses': 1}})
        return out
    return None


async def _unlock_or_400(raw: bytes, password: str, user: dict, remember: bool = True) -> tuple:
    """(unlocked bytes, 'saved' | 'typed'). No password given: the saved ones are
    tried, and 423 means none fit (ask for it). A typed one that works is
    remembered unless `remember` is off."""
    if not _can_draw_pdfs():
        raise HTTPException(status_code=503, detail='Unlocking PDFs is not available on this server yet')
    if not _is_pdf(raw):
        raise HTTPException(status_code=400, detail="That file isn't a PDF")
    if not password:
        out = await _try_saved_passwords(raw)
        if out is None:
            raise HTTPException(status_code=423, detail='This PDF needs its password')
        return out, 'saved'
    try:
        out = await asyncio.to_thread(_unlock_pdf_sync, raw, password)
    except PdfPasswordError:
        raise HTTPException(status_code=400, detail='Wrong password - please check and try again')
    except ValueError:
        raise HTTPException(status_code=400, detail="This PDF couldn't be opened")
    if remember:
        await _remember_password(password, user)
    return out, 'typed'



def _pdf_page_jpeg_sync(raw: bytes, index: int, side: int, quality: int):
    """One PDF page as a JPEG, long side `side` px. None if it can't be drawn."""
    try:
        import io
        import pypdfium2
        with _PDFIUM:
            pdf = pypdfium2.PdfDocument(raw)
            try:
                if not 0 <= index < len(pdf):
                    return None
                page = pdf[index]
                w, h = page.get_size()
                img = page.render(scale=side / max(w, h, 1)).to_pil()
            finally:
                pdf.close()
        if img.mode != 'RGB':
            img = img.convert('RGB')
        out = io.BytesIO()
        img.save(out, 'JPEG', quality=quality, optimize=True)
        return out.getvalue()
    except Exception:
        return None


def _make_thumb_sync(raw: bytes):
    if _is_pdf(raw):
        return _pdf_page_jpeg_sync(raw, 0, THUMB_SIDE, 72)   # first page as the cover
    try:
        import io
        from PIL import Image, ImageOps
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
        if img.mode not in ('RGB', 'L'):
            img = img.convert('RGB')
        img.thumbnail((THUMB_SIDE, THUMB_SIDE), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, 'JPEG', quality=72, optimize=True)
        return out.getvalue()
    except Exception:
        return None


def _touch(path) -> None:
    """Mark a cached file as just used, so the 7-day clock restarts."""
    try:
        os.utime(path, None)
    except Exception:
        pass


def _make_view_sync(raw: bytes):
    """Readable-size JPEG from an original. Returns None if it isn't an image PIL can read."""
    try:
        import io
        from PIL import Image, ImageOps
        img = Image.open(io.BytesIO(raw))
        fmt = img.format
        img = ImageOps.exif_transpose(img)
        if fmt == 'JPEG' and max(img.size) <= VIEW_MAX_SIDE and len(raw) <= _VIEW_REUSE_BYTES:
            return raw
        if img.mode not in ('RGB', 'L'):
            img = img.convert('RGB')
        img.thumbnail((VIEW_MAX_SIDE, VIEW_MAX_SIDE), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, 'JPEG', quality=VIEW_QUALITY, optimize=True)
        return out.getvalue()
    except Exception:
        return None


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


# Employee ID proofs (added on the employee's profile) are documents in this
# category. They must keep working even when the shop turns the category off,
# or deletes it, in Settings › Documents — that only hides it from the
# Documents screen.
EMPLOYEE_IDS_KEY = 'ids'


async def seed_document_categories() -> None:
    if await db.document_categories.count_documents({}) == 0:
        for i, (key, label, icon, vis, rec) in enumerate(DEFAULT_CATEGORIES):
            await db.document_categories.insert_one({
                'id': str(uuid.uuid4()), 'key': key, 'label': label, 'icon': icon,
                'visible_to_roles': vis, 'can_record_roles': rec, 'sort_order': i,
                'active': True, 'created_at': now_utc().isoformat(), 'created_by': 'system',
            })
    if not await db.document_categories.find_one({'key': EMPLOYEE_IDS_KEY}):
        # Deleted from Documents: bring it back turned off (hidden there), so
        # employee profiles can still store ID proofs.
        await db.document_categories.insert_one({
            'id': str(uuid.uuid4()), 'key': EMPLOYEE_IDS_KEY, 'label': 'IDs', 'icon': 'card-outline',
            'visible_to_roles': ['owner', 'admin'], 'can_record_roles': ['owner', 'admin'],
            'sort_order': await db.document_categories.count_documents({}),
            'active': False, 'created_at': now_utc().isoformat(), 'created_by': 'system',
        })


async def migrate_employee_id_proofs() -> None:
    """One-time: ID proofs used to live as a base64 array on the employee doc
    (routers/employees.py's own dedicated upload endpoints, now removed).
    They're ordinary 'ids'-category Documents now, linked to the employee
    (linked_ref) exactly like any other captured-and-filed document — one
    upload path instead of two. Guarded so this only ever runs once; the
    original id_proofs array is left in place afterward, untouched, never
    read or written by the app again (nothing is deleted)."""
    if await db.settings.find_one({'id': 'id_proofs_migrated'}, {'_id': 0, 'id': 1}):
        return
    migrated = 0
    async for emp in db.employees.find({'id_proofs': {'$exists': True, '$ne': []}}, {'_id': 0, 'id': 1, 'name': 1, 'id_proofs': 1}):
        for proof in emp.get('id_proofs') or []:
            data_uri = proof.get('data_uri') or ''
            if ',' not in data_uri:
                continue
            header, b64 = data_uri.split(',', 1)
            mime = 'image/jpeg'
            if header.startswith('data:') and ';base64' in header:
                mime = header[5:header.index(';')] or mime
            try:
                raw = base64.b64decode(b64)
            except Exception:
                continue
            doc_id = str(uuid.uuid4())
            now_iso = proof.get('uploaded_at') or now_utc().isoformat()
            await _cache_write(doc_id, 'full', raw)
            if mime.startswith('image/'):
                view = await asyncio.to_thread(_make_view_sync, raw)
                if view:
                    await _cache_write(doc_id, 'view', view)
                thumb = await asyncio.to_thread(_make_thumb_sync, raw)
                if thumb:
                    await _cache_write(doc_id, 'thumb', thumb)
            await db.documents.insert_one({
                'id': doc_id, 'category_key': 'ids', 'status': 'done', 'client_id': None,
                'linked_ref': {'type': 'employee', 'id': emp['id'], 'label': emp.get('name', '')},
                'note': proof.get('name', ''), 'uploaded_by': 'system', 'uploaded_by_name': 'Migration',
                'created_at': now_iso, 'recorded_at': now_iso, 'recorded_by': 'system', 'recorded_by_name': 'Migration',
                'last_pending_reminder_at': None, 'ocr': {'text': None, 'fields': {}, 'status': 'none'},
                'deleted': False, 'pages': None, 'local_kind': 'disk',
                'file': {'drive_file_id': None, 'drive_view_link': None, 'drive_thumbnail_link': None,
                         'mime': mime, 'size': len(raw), 'orig_name': proof.get('name') or 'ID proof'},
                'upload_state': 'local',
            })
            migrated += 1
    await db.settings.update_one(
        {'id': 'id_proofs_migrated'},
        {'$set': {'id': 'id_proofs_migrated', 'migrated_count': migrated, 'migrated_at': now_utc().isoformat()}},
        upsert=True,
    )
    logger.warning(f'Migrated {migrated} employee ID proof(s) into Documents (category "ids").')


def _role(user: dict) -> str:
    return user.get('role', '')


def _has_documents_module(role: str, rights: dict = None) -> bool:
    """An employee's per-category rights only matter if they can currently
    open the Documents module at all — the Access & Alerts module switch is
    now the single on/off for this whole area (folder rights included), not
    just the Work-tab row. Owner/admin/accountant were never gated by
    module_access here and stay that way (resolve_modules would fold in only
    if this ever grows a per-staff-login toggle for them too)."""
    if role != 'employee':
        return True
    return 'documents' in resolve_modules({'role': role, 'module_access': (rights or {}).get('module_access')})


def _can_see(cat: dict, role: str, rights: dict = None) -> bool:
    if role == 'owner':
        return True
    if not _has_documents_module(role, rights):
        return False
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
    if not _has_documents_module(role, rights):
        return False
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
    async def load():
        return (await db.users.find_one({'id': uid}, {'_id': 0, 'doc_category_rights': 1, 'doc_see_done': 1, 'module_access': 1})
                or await db.employees.find_one({'id': uid}, {'_id': 0, 'doc_category_rights': 1, 'doc_see_done': 1, 'module_access': 1})
                or {})
    return await _memo(('rights_all', uid), 15, load)   # a permission change shows up within seconds


async def _categories_map() -> dict:
    async def load():
        out = {}
        # Active categories, plus employee IDs even when turned off (see
        # EMPLOYEE_IDS_KEY) — turned-off ones stay out of _visible_keys.
        async for c in db.document_categories.find({'$or': [{'active': {'$ne': False}}, {'key': EMPLOYEE_IDS_KEY}]}, {'_id': 0}):
            out[c['key']] = c
        return out
    return await _memo('cats_all', 15, load)


async def _visible_keys(role: str, rights: dict = None) -> set:
    return {k for k, c in (await _categories_map()).items() if c.get('active', True) is not False and _can_see(c, role, rights)}


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
    _LOOKUPS.pop('cats_all', None)
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
    _LOOKUPS.pop('cats_all', None)
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
    _LOOKUPS.pop('cats_all', None)
    await log_audit(user, 'documents.category.delete', 'document_category', cat_id, cat.get('label', ''))
    return {'ok': True}


# ---------------- Documents ----------------
# Image bytes live in their own collection, `document_blobs` ({id, local_data,
# thumb_data}), NOT on the document. MongoDB reads whole documents, so with ~125 KB
# of base64 thumbnail inline every metadata query (list, summary, permission
# checks) dragged megabytes off the Atlas free tier — listing 50 documents took
# 1.2 s and the first grid load far longer. Metadata documents are now tiny.
# Reads fall back to the document itself for anything not yet moved.
# The Atlas free tier moves data at roughly 80 KB/s, so even a slim page of 50
# document records (~40 KB) cost ~0.5 s every time it was listed. Results are kept
# in memory and dropped the moment anything here writes (`_bump`), with a TTL as the
# backstop for writers that don't go through this file.
_LIST_CACHE: dict = {}
_LIST_VER = [0]


def _bump() -> None:
    _LIST_VER[0] += 1
    _LIST_CACHE.clear()


async def _blob_get(doc_id: str, fields: dict) -> dict:
    row = await db.document_blobs.find_one({'id': doc_id}, {'_id': 0, **fields})
    if row:
        return row
    return await db.documents.find_one({'id': doc_id}, {'_id': 0, **fields}) or {}


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
    # A PDF still locked with a password we know (e.g. uploaded from a flow that
    # didn't ask): save the unlocked copy instead.
    if _is_pdf(raw) and _can_draw_pdfs() and (await asyncio.to_thread(_pdf_info_sync, raw))[1]:
        raw = await _try_saved_passwords(raw) or raw

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

    # Every original is written to this server's disk (see DOC_CACHE_DIR) and stays
    # there; the background worker copies it to Google Drive as the off-site
    # backup. Written BEFORE the record exists so a queued document can never be
    # missing its file. No size limit beyond the 60 MB ceiling above — nothing
    # depends on Drive being connected to hold or open a file.
    doc = {
        **base_doc,
        'local_kind': 'disk',
        'file': {'drive_file_id': None, 'drive_view_link': None, 'drive_thumbnail_link': None,
                 'mime': mime, 'size': len(raw), 'orig_name': orig_name},
        # 'queued' → the worker uploads it; 'local' → no Drive yet, lives locally
        # until the owner connects Google (then re-queued).
        'upload_state': 'queued' if connected else 'local',
    }
    await _cache_write(doc['id'], 'full', raw)
    if thumb_clean:
        try:
            await _cache_write(doc['id'], 'thumb', base64.b64decode(thumb_clean))
        except Exception:
            pass
    if mime.startswith('image/'):
        view = await asyncio.to_thread(_make_view_sync, raw)
        if view:
            await _cache_write(doc['id'], 'view', view)
    await db.documents.insert_one(dict(doc))
    _bump()
    await log_audit(user, 'documents.create', 'document', doc['id'], f'{cat["label"]} · {doc["file"]["orig_name"]}')
    await _notify_record_holders(cat, doc, user)
    return {k: v for k, v in doc.items() if k not in ('_id', 'local_data', 'ocr')}


async def _notify_record_holders(cat: dict, doc: dict, actor: dict) -> None:
    """Tell whoever can RECORD this category that a new document is waiting —
    resolved per person from their record rights (falling back to role). Skips
    the person who captured it. Gated per recipient and per channel by their
    'document_new_pending' preference (Settings › People › Alerts)."""
    from server import notify_user, _wants_script, _wants_script_whatsapp
    title = f'New {cat.get("label", "document")} to record'
    body = (doc.get('note') or (doc.get('file') or {}).get('orig_name') or 'A document was captured.')[:120]
    actor_id = actor.get('id')
    proj = {'_id': 0, 'id': 1, 'role': 1, 'doc_category_rights': 1, 'status': 1, 'module_access': 1,
            'notifications_enabled': 1, 'notif_prefs': 1, 'notif_prefs_whatsapp': 1}

    async def _send(acc: dict, role: str) -> None:
        wants_push = _wants_script(acc, role, 'documents', 'document_new_pending')
        wants_wa = _wants_script_whatsapp(acc, role, 'documents', 'document_new_pending')
        if wants_push or wants_wa:
            await notify_user(acc['id'], title, body, '/documents?tab=pending', push=wants_push, whatsapp=wants_wa)

    sent = set()
    try:
        async for u in db.users.find({}, proj):
            if u['id'] == actor_id:
                continue
            if _can_record(cat, u.get('role', ''), u):
                await _send(u, u.get('role', ''))
                sent.add(u['id'])
        async for e in db.employees.find({'status': {'$ne': 'inactive'}}, proj):
            if e['id'] == actor_id or e['id'] in sent:
                continue
            if _can_record(cat, 'employee', e):
                await _send(e, 'employee')
    except Exception:
        pass


async def _notify_document_done(cat: dict, doc: dict, actor: dict) -> None:
    """Tell owner/admin a document was filed into Done — gated by each
    recipient's own 'document_recorded' preference (Settings › People ›
    Alerts), independent of the pending-reminder toggle below and of the
    WhatsApp channel toggle for the same event. Skips the actor themselves,
    same as the pending-doc notify above."""
    from server import notify_user, _wants_script, _wants_script_whatsapp
    title = f'{cat.get("label", "Document")} recorded'
    body = ((doc.get('linked_ref') or {}).get('label') or doc.get('note') or 'Moved to Done.')[:120]
    proj = {'_id': 0, 'id': 1, 'role': 1, 'notifications_enabled': 1, 'notif_prefs': 1, 'notif_prefs_whatsapp': 1}
    try:
        async for u in db.users.find({'role': {'$in': ['owner', 'admin']}}, proj):
            if u['id'] == actor.get('id'):
                continue
            wants_push = _wants_script(u, u.get('role', ''), 'documents', 'document_recorded')
            wants_wa = _wants_script_whatsapp(u, u.get('role', ''), 'documents', 'document_recorded')
            if wants_push or wants_wa:
                await notify_user(u['id'], title, body, '/documents?tab=done', push=wants_push, whatsapp=wants_wa)
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
    from server import notify_user, now_utc, _wants_script, _wants_script_whatsapp
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
        proj = {'_id': 0, 'id': 1, 'role': 1, 'notifications_enabled': 1, 'notif_prefs': 1, 'notif_prefs_whatsapp': 1, 'module_access': 1}
        sent = set()
        try:
            async for u in db.users.find({}, proj):
                if not _can_record(cat, u.get('role', ''), u):
                    continue
                wants_push = _wants_script(u, u.get('role', ''), 'documents', 'document_pending_reminder')
                wants_wa = _wants_script_whatsapp(u, u.get('role', ''), 'documents', 'document_pending_reminder')
                if wants_push or wants_wa:
                    await notify_user(u['id'], title, body, '/documents?tab=pending', push=wants_push, whatsapp=wants_wa)
                    sent.add(u['id'])
            async for e in db.employees.find({'status': {'$ne': 'inactive'}}, proj):
                if e['id'] in sent or not _can_record(cat, 'employee', e):
                    continue
                wants_push = _wants_script(e, 'employee', 'documents', 'document_pending_reminder')
                wants_wa = _wants_script_whatsapp(e, 'employee', 'documents', 'document_pending_reminder')
                if wants_push or wants_wa:
                    await notify_user(e['id'], title, body, '/documents?tab=pending', push=wants_push, whatsapp=wants_wa)
        except Exception:
            pass


def _ist_day_start_utc(day: str, plus_days: int = 0) -> str:
    from datetime import datetime, timezone
    d = datetime.strptime(day, '%Y-%m-%d') + timedelta(days=plus_days) - timedelta(hours=5, minutes=30)
    return d.replace(tzinfo=timezone.utc).isoformat()


@router.get('/documents')
async def list_documents(
    status: Optional[str] = None, category: Optional[str] = None, q: Optional[str] = None,
    cursor: Optional[str] = None, limit: int = 50,
    linked_ref_type: Optional[str] = None, linked_ref_id: Optional[str] = None,
    from_date: Optional[str] = Query(None, pattern=r'^\d{4}-\d{2}-\d{2}$'),
    to_date: Optional[str] = Query(None, pattern=r'^\d{4}-\d{2}-\d{2}$'),
    user=Depends(get_current),
):
    role = _role(user)
    rights = await _account_rights(user)
    visible = await _visible_keys(role, rights)
    limit = max(1, min(limit, 200))
    query: dict = {'deleted': {'$ne': True}, 'category_key': {'$in': list(visible)}}
    if category and category != 'all':
        # An employee's ID proofs still list on their profile when IDs is
        # turned off in Documents.
        ids_cat = (await _categories_map()).get(category) if category == EMPLOYEE_IDS_KEY and linked_ref_type == 'employee' else None
        if category not in visible and not (ids_cat and _can_see(ids_cat, role, rights)):
            raise HTTPException(status_code=403, detail='No access to this category')
        query['category_key'] = category
    # Documents linked to one specific record (e.g. an employee's ID proofs) —
    # both given together, since an id alone isn't unique across ref types.
    if linked_ref_type and linked_ref_id:
        query['linked_ref.type'] = linked_ref_type
        query['linked_ref.id'] = linked_ref_id
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
    # From / To are shop (IST) days, inclusive; created_at is stored in UTC.
    created: dict = {}
    if from_date:
        created['$gte'] = _ist_day_start_utc(from_date)
    if to_date:
        created['$lt'] = _ist_day_start_utc(to_date, 1)
    if cursor:
        created['$lt'] = min(cursor, created['$lt']) if '$lt' in created else cursor
    if created:
        query['created_at'] = created
    ckey = (repr(sorted(query.items(), key=lambda kv: kv[0])), limit)
    hit = _LIST_CACHE.get(ckey)
    if hit and time.monotonic() - hit[0] < 120:
        return hit[1]
    ver = _LIST_VER[0]
    items = await db.documents.find(query, _LIST_PROJECTION).sort('created_at', -1).to_list(limit + 1)
    next_cursor = items[limit]['created_at'] if len(items) > limit else None
    result = {'items': items[:limit], 'next_cursor': next_cursor}
    if ver == _LIST_VER[0]:   # nothing was written while we were reading
        _LIST_CACHE[ckey] = (time.monotonic(), result)
    return result


# ---- "Send to RMJ One" from the iPhone Share menu ----
# iPhone doesn't let a home-screen web app appear in the Share menu, but Apple's
# Shortcuts app can: a shortcut there POSTs the shared PDF/photo to
# /inbox/{key}. Each person gets their own key (one at a time; a new one
# replaces the old), which can ONLY upload documents - as that person, into a
# category they can see, landing in Pending exactly like a capture in the app.
# Only a SHA-256 of the key is stored; the app shows the full link once.
def _key_hash(key: str) -> str:
    import hashlib
    return hashlib.sha256(key.encode('utf-8')).hexdigest()


def _account_kind(user: dict) -> str:
    return 'employee' if _role(user) == 'employee' else 'user'


@router.get('/upload-link/me')
async def my_upload_link(user=Depends(get_current)):
    r = await db.upload_keys.find_one({'account_id': user['id']}, {'_id': 0, 'key_hash': 0})
    return {'exists': bool(r), **({k: r.get(k) for k in ('created_at', 'last_used_at', 'uses')} if r else {})}


@router.post('/upload-link/me')
async def create_upload_link(user=Depends(get_current)):
    """A new personal link (replaces any earlier one). The key is only returned here."""
    import secrets
    key = 'rmj' + secrets.token_urlsafe(24)
    await db.upload_keys.delete_many({'account_id': user['id']})
    await db.upload_keys.insert_one({
        'id': str(uuid.uuid4()), 'key_hash': _key_hash(key), 'account_id': user['id'], 'kind': _account_kind(user),
        'name': user.get('name'), 'created_at': now_utc().isoformat(), 'last_used_at': None, 'uses': 0,
    })
    await log_audit(user, 'documents.upload_link.create', 'upload_key', user['id'], '')
    return {'key': key}


@router.delete('/upload-link/me')
async def delete_my_upload_link(user=Depends(get_current)):
    await db.upload_keys.delete_many({'account_id': user['id']})
    await log_audit(user, 'documents.upload_link.delete', 'upload_key', user['id'], '')
    return {'ok': True}


@router.get('/upload-links')
async def list_upload_links(user=Depends(require_owner)):
    return await db.upload_keys.find({}, {'_id': 0, 'key_hash': 0}).sort('created_at', -1).to_list(500)


@router.delete('/upload-links/{lid}')
async def delete_upload_link(lid: str, user=Depends(require_owner)):
    res = await db.upload_keys.delete_one({'id': lid})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail='Not found')
    await log_audit(user, 'documents.upload_link.revoke', 'upload_key', lid, '')
    return {'ok': True}


def _say(text: str, status: int = 200) -> Response:
    """Plain text: the shortcut shows it as its notification."""
    return Response(content=text, media_type='text/plain; charset=utf-8', status_code=status)


async def _inbox_account(key: str):
    """(account, categories map, the category keys it can send to) - or a plain-text refusal."""
    rec = await db.upload_keys.find_one({'key_hash': _key_hash(key)}, {'_id': 0})
    if not rec:
        return None, _say('This Send to RMJ One link no longer works. Make a new one in RMJ One > Documents > Send from iPhone.', 401)
    coll = db.employees if rec['kind'] == 'employee' else db.users
    acc = await coll.find_one({'id': rec['account_id']}, {'_id': 0, 'password_hash': 0, 'photo': 0})
    if not acc or acc.get('status') == 'inactive' or acc.get('is_active') is False:
        return None, _say('This account is turned off in RMJ One.', 403)
    acc['role'] = acc.get('role') or 'employee'
    cats = await _categories_map()
    rights = await _account_rights(acc)
    # Customer Outstanding is only filled by the OS button, never sent into directly.
    visible = [k for k, cat in cats.items() if cat.get('active', True) is not False and _can_see(cat, _role(acc), rights)
               and not (k == OUTSTANDING_KEY or 'outstanding' in (cat.get('label') or '').lower())]
    if not visible:
        return None, _say("You don't have access to Documents in RMJ One.", 403)
    return (rec, acc, cats, visible), None


@router.get('/inbox/{key}/categories')
async def inbox_categories(key: str):
    """The shortcut's "Save in which category?" list: one name per line."""
    got, refusal = await _inbox_account(key)
    if refusal:
        return refusal
    _, _, cats, visible = got
    return _say('\n'.join(cats[k].get('label') or k for k in visible))


@router.post('/inbox/{key}')
async def inbox_upload(key: str, file: List[UploadFile] = File(...), c: str = Query(default=''), category: str = Form(default='')):
    """What the "Send to RMJ One" shortcut calls: one or more files, as the
    person whose link it is, into the category picked on the iPhone (form
    field `category`, by name) or the one fixed in the link (`?c=`)."""
    got, refusal = await _inbox_account(key)
    if refusal:
        return refusal
    rec, acc, cats, visible = got
    want = (category or c).strip().lower()
    cat_key = next((k for k in visible if want and (k.lower() == want or (cats[k].get('label') or '').strip().lower() == want)), visible[0])
    saved = 0
    for f in file[:20]:
        try:
            await create_document(file=f, category_key=cat_key, note='', thumb='', client_id='', pages=0, user=acc)
            saved += 1
        except HTTPException as e:
            return _say(f'Not saved: {e.detail}', e.status_code)
    await db.upload_keys.update_one({'id': rec['id']}, {'$set': {'last_used_at': now_utc().isoformat()}, '$inc': {'uses': saved}})
    label = cats[cat_key].get('label', 'Documents')
    return _say(f"Saved to RMJ One > {label}{f' ({saved} files)' if saved > 1 else ''}. Record it in Documents > Pending.")


@router.get('/documents/summary')
async def documents_summary(user=Depends(get_current)):
    """Role-filtered counts — feeds the Work row and Home needs-attention item."""
    import drive_service
    async def _conn():
        return bool(await drive_service.is_connected())
    connected = await _memo('drive_connected', 15, _conn)
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
    skey = ('summary', tuple(sorted(visible)))
    hit = _LIST_CACHE.get(skey)
    if hit and time.monotonic() - hit[0] < 120:
        groups = hit[1]
    else:
        ver = _LIST_VER[0]
        groups = await db.documents.aggregate([
            {'$match': {'deleted': {'$ne': True}, 'category_key': {'$in': list(visible)}}},
            {'$group': {'_id': {'c': '$category_key', 's': '$status', 'u': '$upload_state'}, 'n': {'$sum': 1}}},
        ]).to_list(None)
        if ver == _LIST_VER[0]:
            _LIST_CACHE[skey] = (time.monotonic(), groups)
    for g in groups:
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
    if not (body.note or '').strip():
        raise HTTPException(status_code=400, detail='A remark is required to mark this document as done')
    upd = {
        'status': 'done', 'recorded_at': now_utc().isoformat(), 'recorded_by': user['id'], 'recorded_by_name': user['name'],
        'linked_ref': ({'type': body.linked_ref_type, 'id': body.linked_ref_id, 'label': body.linked_ref_label}
                       if body.linked_ref_type else None),
    }
    if body.note is not None:
        upd['note'] = body.note.strip()
    await db.documents.update_one({'id': doc_id}, {'$set': upd})
    _bump()
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
    _bump()
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
    _bump()
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
    await _delete_doc(d)
    await log_audit(user, 'documents.delete', 'document', '', '1 document')   # no name, no id - nothing left to trace
    _refresh_online_copy()
    return {'ok': True}


async def _delete_doc(d: dict):
    """Delete one document with no trace: the Drive file (permanently), the
    record, its bytes and image cache, every activity-log line that named it,
    and the bell notifications that quoted its remark."""
    doc_id = d['id']
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
    await db.document_blobs.delete_one({'id': doc_id})
    await db.audit_logs.delete_many({'entity_type': 'document', 'entity_id': doc_id})
    remark = ((d.get('linked_ref') or {}).get('label') or d.get('note') or '').strip()
    if remark:
        await db.notifications.delete_many({'url': {'$regex': '^/documents'}, 'body': remark[:120]})
    _bump()
    _cache_drop(doc_id)
    _forget(doc_id)


def _refresh_online_copy():
    """Refresh the online copy (Atlas) now, so it drops deleted documents
    instead of keeping them until the next scheduled sync."""
    try:
        import atlas_mirror
        from routers import backup as backup_router
        if atlas_mirror.MIRROR_URL and not backup_router._atlas_running[0]:
            async def _go():
                backup_router._atlas_running[0] = True
                try:
                    await atlas_mirror.mirror_and_record()
                finally:
                    backup_router._atlas_running[0] = False
            asyncio.create_task(_go())
    except Exception:
        pass


async def _load_variant(meta: dict, doc_id: str, variant: str):
    """Fetch one variant's bytes when it isn't on disk yet: from the legacy Mongo
    blob, Google Drive, or (for `view`) by resizing the original. Returns
    (bytes, cacheable) - bytes is None when this document has no such image.
    `cacheable` is False for a stand-in (e.g. the thumbnail served because the
    original couldn't be fetched): caching that under "full" would pin a
    low-resolution copy there for good."""
    if variant == 'view':
        raw, ok = await _load_variant(meta, doc_id, 'full')
        if not raw or not ok:
            return raw, False
        view = await asyncio.to_thread(_make_view_sync, raw)
        return (view or raw), bool(view)
    if variant.startswith('page'):
        if not _can_draw_pdfs():
            return None, False
        raw, ok = await _load_variant(meta, doc_id, 'full')
        if not raw or not ok:
            return None, False
        return await asyncio.to_thread(_pdf_page_jpeg_sync, raw, int(variant[4:]), VIEW_MAX_SIDE, VIEW_QUALITY), True
    if variant == 'thumb':
        row = await _blob_get(doc_id, {'thumb_data': 1, 'local_data': 1})
        data = row.get('thumb_data') or (row.get('local_data') if meta.get('local_kind') == 'thumb' else None)
        if data:
            return base64.b64decode(data), True
        mime = (meta.get('file') or {}).get('mime', '')
        if mime.startswith('image/') or (mime == 'application/pdf' and _can_draw_pdfs()):
            raw, ok = await _load_variant(meta, doc_id, 'full')
            if raw and ok:
                t = await asyncio.to_thread(_make_thumb_sync, raw)
                if t:
                    return t, True
        return None, True
    async with _BLOB_SLOTS:
        local_kind = meta.get('local_kind', 'full')
        drive_id = (meta.get('file') or {}).get('drive_file_id')
        fp = _cache_file(doc_id, 'full')
        if fp.is_file():
            return await asyncio.to_thread(fp.read_bytes), True
        if local_kind == 'full':
            row = await _blob_get(doc_id, {'local_data': 1})
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
        # saved on disk rather than reading it out of Mongo a second time.
        tp = _cache_file(doc_id, 'thumb')
        if tp.is_file():
            return await asyncio.to_thread(tp.read_bytes), False
        row = await _blob_get(doc_id, {'local_data': 1, 'thumb_data': 1})
        data = row.get('local_data') or row.get('thumb_data')
        return (base64.b64decode(data) if data else None), False


async def _doc_for_viewer(doc_id: str, user) -> dict:
    """The document's metadata, if this person may see it (403/404 otherwise)."""
    d = await _memo(('meta', doc_id), 60, lambda: db.documents.find_one(
        {'id': doc_id, 'deleted': {'$ne': True}}, {'_id': 0, 'local_data': 0, 'thumb_data': 0, 'ocr': 0}))
    if not d:
        raise HTTPException(status_code=404, detail='Document not found')
    cats = await _memo(('cats',), 30, _categories_map)
    cat = cats.get(d['category_key'])
    rights = await _memo(('rights', user.get('id')), 30, lambda: _account_rights(user))
    if not cat or not _can_see(cat, _role(user), rights):
        raise HTTPException(status_code=403, detail='No access to this document')
    return d


@router.get('/documents/{doc_id}/pages')
async def document_pages(doc_id: str, user=Depends(get_current)):
    """How many pages a PDF has, so the app can show each one (?page=N).
    `pages` is null when it can't be read here — the app falls back to Open;
    `locked` is true for a password-protected PDF (see /unlock)."""
    d = await _doc_for_viewer(doc_id, user)
    if (d.get('file') or {}).get('mime') != 'application/pdf' or not _can_draw_pdfs():
        return {'pages': None, 'locked': False}

    async def info():
        raw, ok = await _load_variant(d, doc_id, 'full')
        if not raw:
            return None
        if ok and not _cache_file(doc_id, 'full').is_file():
            await _cache_write(doc_id, 'full', raw)   # each page is drawn from it next
        n, locked = await asyncio.to_thread(_pdf_info_sync, raw)
        if locked:   # a statement saved before its password was known: unlock it now if we can
            out = await _try_saved_passwords(raw)
            if out:
                await _replace_with_unlocked(d, doc_id, out, user)
                return await asyncio.to_thread(_pdf_info_sync, out)
        return n, locked
    res = await _memo(('pages', doc_id), 3600, info)
    n, locked = res if res else (None, False)
    return {'pages': min(n, MAX_PDF_PAGES) if n else None, 'total': n, 'locked': bool(locked)}


@router.post('/documents/unlock-pdf')
async def unlock_pdf(file: UploadFile = File(...), password: str = Form(default=''), remember: bool = Form(default=True),
                     user=Depends(get_current)):
    """Before uploading: the picked PDF with its password removed, so what gets
    saved opens (and previews) without one. With no password the saved ones are
    tried (423 = ask for it). The file itself is not kept."""
    raw = await file.read()
    if len(raw) > 60 * 1024 * 1024:
        raise HTTPException(status_code=400, detail='File too large (max 60 MB).')
    out, how = await _unlock_or_400(raw, password, user, remember)
    return Response(content=out, media_type='application/pdf', headers={'X-Unlocked-With': how})


class UnlockIn(BaseModel):
    password: str = ''
    remember: bool = True


async def _replace_with_unlocked(d: dict, doc_id: str, out: bytes, user: dict) -> None:
    """Swap a saved locked PDF for its unlocked copy, here and in Google Drive
    (the locked Drive file is removed and the unlocked one uploaded instead)."""
    _cache_drop(doc_id)
    await _cache_write(doc_id, 'full', out)
    old_drive = (d.get('file') or {}).get('drive_file_id')
    upd = {'file.size': len(out), 'unlocked_at': now_utc().isoformat()}
    if old_drive:
        upd.update({'upload_state': 'queued', 'file.drive_file_id': None, 'file.drive_view_link': None, 'file.drive_thumbnail_link': None})
    await db.documents.update_one({'id': doc_id}, {'$set': upd})
    if old_drive:
        try:
            import drive_service
            await drive_service.delete_file(await drive_service.get_config(), old_drive)
        except Exception:
            pass   # the unlocked copy still goes up; the old one just stays in Drive
    _LOOKUPS.pop(('pages', doc_id), None)
    _forget(doc_id)
    _bump()
    await log_audit(user, 'documents.unlock', 'document', doc_id, (d.get('file') or {}).get('orig_name', ''))


@router.post('/documents/{doc_id}/unlock')
async def unlock_document(doc_id: str, body: UnlockIn, user=Depends(get_current)):
    """A password-protected PDF already saved: replace it with the unlocked copy.
    An empty password tries the saved ones (423 = ask for it)."""
    d = await _doc_for_viewer(doc_id, user)
    if (d.get('file') or {}).get('mime') != 'application/pdf':
        raise HTTPException(status_code=400, detail="That document isn't a PDF")
    raw, ok = await _load_variant(d, doc_id, 'full')
    if not raw or not ok:
        raise HTTPException(status_code=404, detail="The file couldn't be fetched - try again in a moment")
    out, how = await _unlock_or_400(raw, body.password, user, body.remember)
    await _replace_with_unlocked(d, doc_id, out, user)
    return {'ok': True, 'size': len(out), 'with': how}


# ---- the owner's list of saved PDF passwords (see _pw_box) ----
class PdfPasswordIn(BaseModel):
    password: Optional[str] = None
    label: Optional[str] = None


@router.get('/pdf-passwords')
async def list_pdf_passwords(user=Depends(require_owner)):
    box, out = _pw_box(), []
    async for r in db.pdf_passwords.find({}, {'_id': 0}).sort('created_at', -1):
        try:
            pw = box.decrypt(r['secret'].encode()).decode()
        except Exception:
            pw = None   # saved under another JWT_SECRET - can't be used any more
        out.append({'id': r['id'], 'password': pw, 'label': r.get('label') or '', 'created_at': r.get('created_at'),
                    'created_by': r.get('created_by'), 'last_used_at': r.get('last_used_at'), 'uses': r.get('uses', 0)})
    return out


@router.post('/pdf-passwords')
async def add_pdf_password(body: PdfPasswordIn, user=Depends(require_owner)):
    pw = (body.password or '').strip()
    if not pw:
        raise HTTPException(status_code=400, detail='Enter the password')
    if any(p == pw for _, p in await _saved_passwords()):
        raise HTTPException(status_code=400, detail='That password is already saved')
    await _remember_password(pw, user, body.label or '', used=False)
    await log_audit(user, 'documents.pdf_password.add', 'pdf_password', '', body.label or '')
    return {'ok': True}


@router.patch('/pdf-passwords/{pid}')
async def rename_pdf_password(pid: str, body: PdfPasswordIn, user=Depends(require_owner)):
    res = await db.pdf_passwords.update_one({'id': pid}, {'$set': {'label': (body.label or '').strip()[:60]}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail='Not found')
    return {'ok': True}


@router.delete('/pdf-passwords/{pid}')
async def delete_pdf_password(pid: str, user=Depends(require_owner)):
    res = await db.pdf_passwords.delete_one({'id': pid})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail='Not found')
    await log_audit(user, 'documents.pdf_password.delete', 'pdf_password', pid, '')
    return {'ok': True}


@router.get('/documents/{doc_id}/file')
async def document_file(
    doc_id: str, full: bool = Query(default=False), thumb: bool = Query(default=False),
    original: bool = Query(default=False), page: Optional[int] = Query(default=None, ge=0, lt=MAX_PDF_PAGES),
    user=Depends(get_current),
):
    """Serve a document's image. `?thumb=1` is the small grid thumbnail (a PDF's
    first page); `?full=1` is the on-screen copy - a readable-size JPEG for
    images (fast on a phone), the file itself for PDFs; `?page=N` is page N of a
    PDF as a readable-size JPEG; `?original=1` is always the untouched original
    (for Open / download).
    Permission-checked against the caller's category visibility exactly as
    before — but the permission check reads only the document's metadata, and
    the image itself is served from the on-disk cache once it has been fetched
    a single time (see DOC_CACHE_DIR above)."""
    d = await _doc_for_viewer(doc_id, user)
    mime = (d.get('file') or {}).get('mime', 'image/jpeg')
    is_image = mime.startswith('image/')
    if page is not None and mime == 'application/pdf':
        variant = f'page{page}'
    elif thumb:
        variant = 'thumb'
    elif original or not is_image:
        variant = 'full'
    else:
        variant = 'view'
    media_type = 'image/jpeg' if variant in ('thumb', 'view') or variant.startswith('page') else mime
    cache_headers = {'Cache-Control': f'private, max-age={_CACHE_TTL_SECONDS}'}

    path = _cache_file(doc_id, variant)
    if path.is_file():
        _touch(path)
        return FileResponse(path, media_type=media_type, headers=cache_headers)

    raw, cacheable = await _load_variant(d, doc_id, variant)
    if not raw:
        raise HTTPException(status_code=404, detail='No local copy (see Drive link)')
    if not cacheable:
        return Response(content=raw, media_type=media_type)
    await _cache_write(doc_id, variant, raw)
    return Response(content=raw, media_type=media_type, headers=cache_headers)


def _evict_sync(synced_ids: set, all_ids: set, done_ids: set = frozenset()) -> dict:
    """Delete cached originals/on-screen copies that are safely in Drive and unused
    for CACHE_RETAIN_DAYS (or oldest-first over the size budget), and any file whose
    document no longer exists. Thumbnails are kept."""
    import time as _t
    now = _t.time()
    removed = freed = 0
    heavy = []   # (mtime, size, path) of evictable .full/.view files
    for f in DOC_CACHE_DIR.iterdir():
        if not f.is_file():
            continue
        name = f.name
        if name.endswith('.tmp'):
            continue
        doc_id, _, variant = name.partition('.')
        try:
            st = f.stat()
        except OSError:
            continue
        if doc_id not in all_ids:            # orphan of a deleted document
            try:
                f.unlink(); removed += 1; freed += st.st_size
            except OSError:
                pass
            continue
        if (variant in ('full', 'view') or variant.startswith('page')) and doc_id in synced_ids:
            heavy.append((st.st_mtime, st.st_size, f, variant, doc_id))
    total = sum(h[1] for h in heavy)
    for mtime, size, f, variant, doc_id in sorted(heavy):     # oldest first
        # A document marked done is finished with: its cached copies go after a day too.
        days = FULL_RETAIN_DAYS if (variant == 'full' or doc_id in done_ids) else CACHE_RETAIN_DAYS
        too_old = (now - mtime) > days * 86400
        over_budget = total > CACHE_RETAIN_BYTES
        if not (too_old or over_budget):
            continue
        try:
            f.unlink(); removed += 1; freed += size; total -= size
        except OSError:
            pass
    return {'removed': removed, 'freed': freed}


async def doc_store_maintenance_loop() -> None:
    """Hourly: (1) make sure every image document has its small grid thumbnail,
    rebuilding it from Drive if needed; (2) clear out cached originals that are in
    Drive and no longer in use (see the policy note at DOC_CACHE_DIR)."""
    await asyncio.sleep(45)
    while True:
        try:
            rows = await db.documents.find(
                {'deleted': {'$ne': True}}, {'_id': 0, 'id': 1, 'local_kind': 1, 'file': 1, 'upload_state': 1, 'status': 1},
            ).to_list(None)
            names = os.listdir(DOC_CACHE_DIR) if DOC_CACHE_DIR.is_dir() else []
            have_thumb = {n[:-len('.thumb')] for n in names if n.endswith('.thumb')}
            for r in rows:
                if (r.get('file') or {}).get('mime', '').startswith('image/') and r['id'] not in have_thumb:
                    raw, ok = await _load_variant(r, r['id'], 'thumb')
                    if raw and ok:
                        await _cache_write(r['id'], 'thumb', raw)
                    await asyncio.sleep(0.3)
            synced = {r['id'] for r in rows if r.get('upload_state') == 'synced' and (r.get('file') or {}).get('drive_file_id')}
            done = {r['id'] for r in rows if r.get('status') == 'done'}
            res = await asyncio.to_thread(_evict_sync, synced, {r['id'] for r in rows}, done)
            if res['removed']:
                logger.info(f"doc cache: cleared {res['removed']} file(s), {res['freed'] // 1024} KB")
        except Exception as e:
            logger.warning(f'doc store maintenance error: {e}')
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
    _bump()
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
                doc = await db.documents.find_one({'upload_state': {'$in': ['queued', 'uploading']}, 'deleted': {'$ne': True}}, {'_id': 0, 'local_data': 0, 'thumb_data': 0})
                if doc:
                    await db.documents.update_one({'id': doc['id']}, {'$set': {'upload_state': 'uploading'}})
                    _bump()
                    try:
                        # The original comes off this server's disk (or, for a
                        # document from before the local store, its stored blob).
                        raw, ok = await _load_variant(doc, doc['id'], 'full')
                        if not raw or not ok:
                            raise RuntimeError('No local copy left to upload')
                        await _cache_write(doc['id'], 'full', raw)   # from now on it lives on disk
                        cat = (await _categories_map()).get(doc['category_key'], {})
                        res = await drive_service.upload_raw(cfg, cat.get('label', doc['category_key']), _drive_filename(doc, cat), raw, (doc.get('file') or {}).get('mime', 'image/jpeg'))
                        # Drive now holds the off-site backup. The original STAYS
                        # here, so opening a photo never depends on Drive again;
                        # any legacy inline copy in the database can go.
                        await db.document_blobs.delete_one({'id': doc['id']})
                        await db.documents.update_one({'id': doc['id']}, {'$set': {
                            'upload_state': 'synced',
                            'file.drive_file_id': res['drive_file_id'],
                            'file.drive_view_link': res['drive_view_link'],
                            'file.drive_thumbnail_link': res['drive_thumbnail_link'],
                            'local_kind': 'disk',
                        }, '$unset': {'local_data': '', 'thumb_data': ''}})
                        _bump()
                    except Exception as e:
                        err = str(e)[:200]
                        await db.documents.update_one({'id': doc['id']}, {'$set': {'upload_state': 'failed', 'upload_error': err}})
                        _bump()
                        if 'invalid_grant' in err or 'invalid_client' in err:
                            await _notify_system_health('drive_disconnected', 'Google Drive disconnected',
                                                         'Google Drive needs to be reconnected — document and photo uploads are paused (Settings > Google Drive).', '/settings/google-drive')
                        else:
                            await _notify_system_health('drive_upload_failed', 'Document upload failed',
                                                         f'A document failed to upload to Google Drive: {err}', '/settings/google-drive')
                    continue  # grab the next queued doc without waiting
        except Exception:
            pass
        await asyncio.sleep(6)


# ---------------- Customer Outstanding (the "OS" button) ----------------
# Moving a customer slip to Done has an OS button beside Done: it's recorded and
# filed in the Customer Outstanding folder instead. This finds that folder (one whose
# key or name says "outstanding") or, the first time, creates it with the same
# who-can-see / who-can-record as the slips folder it was started from.
OUTSTANDING_KEY = 'customer_outstanding'


class OutstandingIn(BaseModel):
    from_key: str


@router.post('/document-categories/outstanding')
async def outstanding_category(body: OutstandingIn, user=Depends(get_current)):
    cats = await _categories_map()
    src = cats.get(body.from_key)
    rights = await _account_rights(user)
    if not src or not _can_record(src, _role(user), rights):
        raise HTTPException(status_code=403, detail='No access to that folder')
    found = next((c for c in cats.values() if c['key'] == OUTSTANDING_KEY or 'outstanding' in (c.get('label') or '').lower()), None)
    if not found:
        found = {
            'id': str(uuid.uuid4()), 'key': OUTSTANDING_KEY, 'label': 'Customer Outstanding', 'icon': 'time-outline',
            'visible_to_roles': list(src.get('visible_to_roles') or ['owner', 'admin']),
            'can_record_roles': list(src.get('can_record_roles') or ['owner', 'admin']),
            'sort_order': (src.get('sort_order') or 0) + 1, 'active': True,
            'created_at': now_utc().isoformat(), 'created_by': user.get('name') or 'system',
        }
        await db.document_categories.insert_one(dict(found))
        found.pop('_id', None)
        _bump()
        _LOOKUPS.pop('cats_all', None)    # seen at once (the folder list is memoised for a few seconds)
        _LOOKUPS.pop(('cats',), None)
        await log_audit(user, 'documents.category.create', 'document_category', found['id'], 'Customer Outstanding (OS button)')
    elif found.get('active') is False:
        await db.document_categories.update_one({'id': found['id']}, {'$set': {'active': True}})
        _bump()
        _LOOKUPS.pop('cats_all', None)
        _LOOKUPS.pop(('cats',), None)
    return {'key': found['key'], 'label': found.get('label') or 'Customer Outstanding'}


class DeleteManyIn(BaseModel):
    ids: List[str] = Field(min_length=1, max_length=500)


@router.post('/documents/delete-many')
async def delete_many_documents(body: DeleteManyIn, user=Depends(get_current)):
    """Select and delete: the same delete-everywhere as one document, for a
    picked set (owner/admin)."""
    if _role(user) not in ('owner', 'admin'):
        raise HTTPException(status_code=403, detail='Only owner/admin can delete documents')
    deleted = 0
    for doc_id in dict.fromkeys(body.ids):
        d = await db.documents.find_one({'id': doc_id}, {'_id': 0, 'local_data': 0})
        if d:
            await _delete_doc(d)
            deleted += 1
    if deleted:
        await log_audit(user, 'documents.delete', 'document', '', f'{deleted} documents')
        _refresh_online_copy()
    return {'ok': True, 'deleted': deleted}


# ---------------- Delete old documents from a folder, everywhere ----------------
# Owner only. Every document in the folder captured before the day picked is
# removed for good: from Google Drive (a permanent delete, not Drive's trash),
# this server's database and image cache, and the activity-log lines that named
# them - then the online copy (Atlas) is refreshed so it drops them too. Only
# the shop's rolling backups still hold them, until those age out.
# Employee ID proofs attached to a profile are never touched here.
DATE_RE = r'^\d{4}-\d{2}-\d{2}$'


class PurgeIn(BaseModel):
    category_key: str
    before: str = Field(pattern=DATE_RE)    # shop day; everything captured before it goes


def _purge_query(key: str, before: str) -> dict:
    # everything in the folder from before that day, except ID proofs kept on an employee's profile
    return {'category_key': key, 'created_at': {'$lt': _ist_day_start_utc(before)}, 'linked_ref.type': {'$ne': 'employee'}}


@router.get('/documents/purge-preview')
async def purge_preview(category_key: str = Query(...), before: str = Query(..., pattern=DATE_RE), user=Depends(require_owner)):
    return {'count': await db.documents.count_documents(_purge_query(category_key, before)), 'before': before}


@router.post('/documents/purge')
async def purge_documents(body: PurgeIn, user=Depends(require_owner)):
    cats = await _categories_map()
    if body.category_key not in cats:
        raise HTTPException(status_code=404, detail='Unknown folder')
    docs = await db.documents.find(_purge_query(body.category_key, body.before), {'_id': 0, 'local_data': 0}).to_list(20000)
    for d in docs:
        await _delete_doc(d)
    # Only the folder and how many - nothing about what they were.
    await log_audit(user, 'documents.purge', 'document_category', body.category_key, f'{len(docs)} from before {body.before}')
    if docs:
        _refresh_online_copy()
    return {'ok': True, 'deleted': len(docs), 'before': body.before}
