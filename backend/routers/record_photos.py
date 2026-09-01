"""Record photos — high-res reference photos attached to a repair item, sample,
employee, etc. Same storage strategy as Documents: keep only a small thumbnail
in the database, push the full-resolution image to Google Drive in the
background, and serve the original from Drive on demand. This keeps the DB light
while preserving full quality.

A photo is linked to its record by (ref_type, ref_id), e.g.
('repair_item', <id>). Fully self-contained and additive.
"""
import base64
import re
import uuid
import asyncio

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, Response
from server import db, get_current, now_utc, log_audit, resolve_modules

router = APIRouter()

_LIST_PROJ = {'_id': 0, 'local_data': 0, 'thumb_data': 0}

_FOLDER_LABEL = {
    'repair_item': 'Repair Photos',
    'sample': 'Sample Photos',
    'employee': 'Employee Photos',
}

# Every ref_type this feature supports maps to the module that gates its
# parent record — a photo shouldn't be reachable by someone who couldn't see
# the repair/sample/employee it's attached to. 'employee' maps to 'team',
# which is never employee-assignable, so employee photos stay owner/admin-only
# just like the employees.py endpoints they sit alongside.
_REF_MODULE = {'repair_item': 'repairs', 'sample': 'samples', 'employee': 'team'}


def _module_for_ref(ref_type: str) -> str:
    mod = _REF_MODULE.get(ref_type)
    if not mod:
        raise HTTPException(status_code=400, detail=f'Unknown ref_type "{ref_type}"')
    return mod


def _require_read(user: dict, ref_type: str) -> None:
    mod = _module_for_ref(ref_type)
    role = user.get('role')
    if role in ('owner', 'admin', 'accountant'):
        return
    if role == 'employee' and mod in resolve_modules(user):
        return
    raise HTTPException(status_code=403, detail=f'No access to "{mod}"')


def _require_write(user: dict, ref_type: str) -> None:
    mod = _module_for_ref(ref_type)
    role = user.get('role')
    if role in ('owner', 'admin'):
        return
    if role == 'employee' and mod in resolve_modules(user):
        return
    raise HTTPException(status_code=403, detail=f'No access to "{mod}"')


def _folder_for(ref_type: str) -> str:
    return _FOLDER_LABEL.get(ref_type, 'Record Photos')


@router.post('/record-photos')
async def create_record_photo(
    file: UploadFile = File(...),
    ref_type: str = Form(...),
    ref_id: str = Form(...),
    thumb: str = Form(default=''),
    client_id: str = Form(default=''),
    user=Depends(get_current),
):
    _require_write(user, ref_type)
    # Idempotent on client_id (the upload queue may retry after a timeout).
    if client_id:
        existing = await db.record_photos.find_one({'client_id': client_id, 'deleted': {'$ne': True}}, _LIST_PROJ)
        if existing:
            return existing
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail='Empty file')
    if len(raw) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail='File too large (max 15 MB)')
    import drive_service
    connected = await drive_service.is_connected()
    thumb_clean = thumb.split(',', 1)[-1].strip() if thumb else ''
    doc = {
        'id': str(uuid.uuid4()), 'ref_type': ref_type, 'ref_id': ref_id,
        'client_id': client_id or None,
        'local_data': base64.b64encode(raw).decode('ascii'),
        'local_kind': 'full',
        'thumb_data': thumb_clean or None,
        'file': {'drive_file_id': None, 'drive_view_link': None, 'drive_thumbnail_link': None,
                 'mime': file.content_type or 'image/jpeg', 'size': len(raw), 'orig_name': file.filename or 'photo.jpg'},
        'upload_state': 'queued' if connected else 'local',
        'uploaded_by': user['id'], 'uploaded_by_name': user['name'],
        'created_at': now_utc().isoformat(), 'deleted': False,
    }
    await db.record_photos.insert_one(dict(doc))
    await log_audit(user, 'record_photo.create', ref_type, ref_id, doc['id'])
    return {k: v for k, v in doc.items() if k not in ('_id', 'local_data', 'thumb_data')}


@router.get('/record-photos')
async def list_record_photos(ref_type: str = Query(...), ref_id: str = Query(...), user=Depends(get_current)):
    _require_read(user, ref_type)
    return await db.record_photos.find(
        {'ref_type': ref_type, 'ref_id': ref_id, 'deleted': {'$ne': True}}, _LIST_PROJ,
    ).sort('created_at', 1).to_list(50)


@router.get('/record-photos/{photo_id}/file')
async def record_photo_file(photo_id: str, full: bool = Query(default=False), user=Depends(get_current)):
    d = await db.record_photos.find_one({'id': photo_id, 'deleted': {'$ne': True}}, {'_id': 0})
    if not d:
        raise HTTPException(status_code=404, detail='Photo not found')
    _require_read(user, d.get('ref_type', ''))
    mime = (d.get('file') or {}).get('mime', 'image/jpeg')
    drive_id = (d.get('file') or {}).get('drive_file_id')
    local_kind = d.get('local_kind', 'full')
    need_drive = drive_id and ((full and local_kind != 'full') or not d.get('local_data'))
    if need_drive:
        try:
            import drive_service
            cfg = await drive_service.get_config()
            raw = await drive_service.download(cfg, drive_id)
            return Response(content=raw, media_type=mime)
        except Exception:
            pass
    data = d.get('local_data')
    if not data:
        raise HTTPException(status_code=404, detail='No local copy')
    return Response(content=base64.b64decode(data), media_type=mime)


@router.delete('/record-photos/{photo_id}')
async def delete_record_photo(photo_id: str, user=Depends(get_current)):
    if user.get('role') not in ('owner', 'admin'):
        raise HTTPException(status_code=403, detail='Only owner/admin can delete')
    d = await db.record_photos.find_one({'id': photo_id}, {'_id': 0, 'local_data': 0, 'thumb_data': 0})
    if not d:
        raise HTTPException(status_code=404, detail='Photo not found')
    await db.record_photos.update_one({'id': photo_id}, {'$set': {'deleted': True, 'deleted_at': now_utc().isoformat()}})
    await log_audit(user, 'record_photo.delete', d.get('ref_type', ''), d.get('ref_id', ''), photo_id)
    return {'ok': True}


def _drive_filename(doc: dict) -> str:
    orig = (doc.get('file') or {}).get('orig_name') or 'photo'
    ext = orig.rsplit('.', 1)[-1] if '.' in orig else 'jpg'
    base = re.sub(r'[^\w\-]+', '', f"{doc.get('ref_type', 'photo')}_{doc.get('ref_id', '')[:8]}")[:50] or 'photo'
    return f'{base}_{(doc.get("created_at") or "")[:10]}.{ext}'


async def record_photo_worker():
    """Background Drive sync — mirror of the Documents worker. Uploads one queued
    record photo per tick, then drops the heavy local copy (keeps the thumb)."""
    import drive_service
    while True:
        try:
            if await drive_service.is_connected():
                cfg = await drive_service.get_config()
                doc = await db.record_photos.find_one({'upload_state': 'queued', 'deleted': {'$ne': True}, 'local_data': {'$ne': None}}, {'_id': 0})
                if doc:
                    await db.record_photos.update_one({'id': doc['id']}, {'$set': {'upload_state': 'uploading'}})
                    try:
                        res = await drive_service.upload(cfg, _folder_for(doc.get('ref_type', '')), _drive_filename(doc), doc['local_data'], (doc.get('file') or {}).get('mime', 'image/jpeg'))
                        thumb = doc.get('thumb_data')
                        await db.record_photos.update_one({'id': doc['id']}, {'$set': {
                            'upload_state': 'synced',
                            'file.drive_file_id': res['drive_file_id'],
                            'file.drive_view_link': res['drive_view_link'],
                            'file.drive_thumbnail_link': res['drive_thumbnail_link'],
                            'local_data': thumb or None,
                            'local_kind': 'thumb' if thumb else 'none',
                            'thumb_data': None,
                        }})
                    except Exception as e:
                        await db.record_photos.update_one({'id': doc['id']}, {'$set': {'upload_state': 'failed', 'upload_error': str(e)[:200]}})
                    continue
        except Exception:
            pass
        await asyncio.sleep(6)
