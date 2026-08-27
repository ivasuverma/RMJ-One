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
from fastapi.responses import HTMLResponse
from typing import Optional
from pydantic import BaseModel
import asyncio
import base64
import re
import uuid

from server import db, now_utc, get_current, require_owner, log_audit

router = APIRouter()

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
    # Per-category, per-person override (Settings › People). Only the categories
    # explicitly set for this person use the override; everything else falls
    # back to the category's role rules — so granting one category never hides
    # the ones this person could already see by role.
    override = (rights or {}).get('doc_category_rights') or {}
    key = cat.get('key')
    if key in override:
        return bool((override.get(key) or {}).get('view'))
    return role in (cat.get('visible_to_roles') or [])


def _can_record(cat: dict, role: str, rights: dict = None) -> bool:
    if role == 'owner':
        return True
    override = (rights or {}).get('doc_category_rights') or {}
    key = cat.get('key')
    if key in override:
        return bool((override.get(key) or {}).get('record'))
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
    user=Depends(get_current),
):
    """Capture: create a PENDING doc immediately and return fast. The bytes are
    kept locally (base64) so it works offline; the Drive upload is queued."""
    cats = await _categories_map()
    cat = cats.get(category_key)
    if not cat:
        raise HTTPException(status_code=404, detail='Unknown category')
    rights = await _account_rights(user)
    if not _can_record(cat, _role(user), rights):
        raise HTTPException(status_code=403, detail='You do not have permission to file documents in this category')
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail='Empty file')
    if len(raw) > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail='File too large (max 12 MB)')

    import drive_service
    connected = await drive_service.is_connected()
    # A small client-made thumbnail (images only) lets us drop the heavy
    # full-size copy once it's safely in Drive, while grid views stay instant.
    thumb_clean = ''
    if thumb:
        thumb_clean = thumb.split(',', 1)[-1].strip()   # tolerate a data-URL prefix
    doc = {
        'id': str(uuid.uuid4()), 'category_key': category_key, 'status': 'pending',
        'local_data': base64.b64encode(raw).decode('ascii'),
        'local_kind': 'full',                # 'full' | 'thumb' | 'none' (Drive-only)
        'thumb_data': thumb_clean or None,
        'file': {'drive_file_id': None, 'drive_view_link': None, 'drive_thumbnail_link': None,
                 'mime': file.content_type or 'image/jpeg', 'size': len(raw), 'orig_name': file.filename or 'capture.jpg'},
        # 'queued' → the worker will upload it; 'local' → no Drive connected yet,
        # so it just lives locally until the owner connects Google (then re-queued).
        'upload_state': 'queued' if connected else 'local',
        'linked_ref': None, 'note': (note or '').strip(),
        'uploaded_by': user['id'], 'uploaded_by_name': user['name'],
        'created_at': now_utc().isoformat(), 'recorded_at': None, 'recorded_by': None,
        'ocr': {'text': None, 'fields': {}, 'status': 'none'},   # Phase 5 — reserved
        'deleted': False,
    }
    await db.documents.insert_one(dict(doc))
    await log_audit(user, 'documents.create', 'document', doc['id'], f'{cat["label"]} · {doc["file"]["orig_name"]}')
    return {k: v for k, v in doc.items() if k not in ('_id', 'local_data', 'ocr')}


@router.get('/documents')
async def list_documents(
    status: Optional[str] = None, category: Optional[str] = None, q: Optional[str] = None,
    user=Depends(get_current),
):
    role = _role(user)
    rights = await _account_rights(user)
    visible = await _visible_keys(role, rights)
    query: dict = {'deleted': {'$ne': True}, 'category_key': {'$in': list(visible)}}
    if category and category != 'all':
        if category not in visible:
            raise HTTPException(status_code=403, detail='No access to this category')
        query['category_key'] = category
    if status in ('pending', 'done'):
        # Someone without Done-folder access can never list done documents.
        if status == 'done' and not _can_see_done(user, rights):
            return []
        query['status'] = status
    if q and q.strip():
        q_esc = re.escape(q.strip())
        query['$or'] = [
            {'note': {'$regex': q_esc, '$options': 'i'}},
            {'file.orig_name': {'$regex': q_esc, '$options': 'i'}},
            {'linked_ref.label': {'$regex': q_esc, '$options': 'i'}},
        ]
    return await db.documents.find(query, _LIST_PROJECTION).sort('created_at', -1).to_list(2000)


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
    async for d in db.documents.find(
        {'deleted': {'$ne': True}, 'category_key': {'$in': list(visible)}},
        {'_id': 0, 'category_key': 1, 'status': 1, 'upload_state': 1},
    ):
        b = by_category.setdefault(d['category_key'], {'pending': 0, 'done': 0})
        if d['status'] == 'pending':
            pending += 1; b['pending'] += 1
        else:
            done += 1; b['done'] += 1
        # Only count as "uploading" when Drive is actually connected and working.
        if connected and d.get('upload_state') in ('queued', 'uploading'):
            uploading += 1
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
        'status': 'done', 'recorded_at': now_utc().isoformat(), 'recorded_by': user['id'],
        'linked_ref': ({'type': body.linked_ref_type, 'id': body.linked_ref_id, 'label': body.linked_ref_label}
                       if body.linked_ref_type else None),
    }
    if body.note is not None:
        upd['note'] = body.note.strip()
    await db.documents.update_one({'id': doc_id}, {'$set': upd})
    await log_audit(user, 'documents.record', 'document', doc_id, body.linked_ref_label or cat['label'])
    return await db.documents.find_one({'id': doc_id}, _LIST_PROJECTION)


@router.delete('/documents/{doc_id}')
async def delete_document(doc_id: str, user=Depends(get_current)):
    if _role(user) not in ('owner', 'admin'):
        raise HTTPException(status_code=403, detail='Only owner/admin can delete documents')
    d = await db.documents.find_one({'id': doc_id}, {'_id': 0, 'local_data': 0})
    if not d:
        raise HTTPException(status_code=404, detail='Document not found')
    # Soft-delete in the app; the original stays in Drive (once synced).
    await db.documents.update_one({'id': doc_id}, {'$set': {'deleted': True, 'deleted_at': now_utc().isoformat(), 'deleted_by': user['id']}})
    await log_audit(user, 'documents.delete', 'document', doc_id, (d.get('file') or {}).get('orig_name', ''))
    return {'ok': True}


@router.get('/documents/{doc_id}/file')
async def document_file(doc_id: str, full: bool = Query(default=False), user=Depends(get_current)):
    """Serve the document bytes. By default this is the fast local copy (the
    small thumbnail once synced); `?full=1` returns the full-size original,
    fetched from Drive on demand when the heavy local copy has been dropped.
    Permission-checked against the caller's category visibility."""
    d = await db.documents.find_one({'id': doc_id, 'deleted': {'$ne': True}}, {'_id': 0})
    if not d:
        raise HTTPException(status_code=404, detail='Document not found')
    cats = await _categories_map()
    cat = cats.get(d['category_key'])
    rights = await _account_rights(user)
    if not cat or not _can_see(cat, _role(user), rights):
        raise HTTPException(status_code=403, detail='No access to this document')
    mime = (d.get('file') or {}).get('mime', 'image/jpeg')
    local_kind = d.get('local_kind', 'full')
    drive_id = (d.get('file') or {}).get('drive_file_id')
    # Go to Drive when the caller wants full size and the local copy is only a
    # thumbnail (or gone) — or when there's no local copy at all.
    need_drive = drive_id and ((full and local_kind != 'full') or not d.get('local_data'))
    if need_drive:
        try:
            import drive_service
            cfg = await drive_service.get_config()
            raw = await drive_service.download(cfg, drive_id)
            return Response(content=raw, media_type=mime)
        except Exception:
            pass   # fall back to whatever local copy we still have
    data = d.get('local_data')
    if not data:
        raise HTTPException(status_code=404, detail='No local copy (see Drive link)')
    return Response(content=base64.b64decode(data), media_type=mime)


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
    }}, upsert=True)
    # Any docs captured while offline/unconnected can now sync.
    await db.documents.update_many({'upload_state': {'$in': ['local', 'failed']}, 'deleted': {'$ne': True}}, {'$set': {'upload_state': 'queued'}})
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
                doc = await db.documents.find_one({'upload_state': 'queued', 'deleted': {'$ne': True}, 'local_data': {'$ne': None}}, {'_id': 0})
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
                        await db.documents.update_one({'id': doc['id']}, {'$set': {'upload_state': 'failed', 'upload_error': str(e)[:200]}})
                    continue  # grab the next queued doc without waiting
        except Exception:
            pass
        await asyncio.sleep(6)
