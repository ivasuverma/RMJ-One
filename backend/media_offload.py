"""Moves photos that used to live permanently in the database off this server and
into Google Drive — the shop keeps Drive as the one place for photos and backups,
and this computer holds only small thumbnails and a short-lived cache.

Covers the photos that aren't already Drive-backed (documents and record photos
have their own workers in routers/documents.py and routers/record_photos.py):

  repair items   intake_photo / final_photo (base64 data URIs on the item) — the
                 original goes to Drive ("Repair Photos"), the field keeps a
                 480px thumbnail and <field>_drive_id points at the original,
                 served by GET /repair-items/{id}/photo/{intake|final}.
  attendance     check_in.selfie / check_out.selfie — to Drive ("Attendance
                 Selfies"); the app never shows them, so nothing is kept.
  broadcasts     broadcast_media.image (WhatsApp broadcast photos) — to Drive
                 ("Broadcast Photos"); served from a disk cache (see broadcasts.py).
  employees      the legacy id_proofs array, already copied into Documents by
                 migrate_employee_id_proofs — dropped once those copies are in Drive.

Nothing is removed from here until Drive has confirmed the upload. Website photos
are deliberately left alone: rmj.co.in is served from this server.
"""
import asyncio
import base64
import logging
import re

from server import db, now_utc, _notify_system_health

logger = logging.getLogger('media_offload')

REPAIR_THUMB_SIDE = 480
REPAIR_FOLDER = 'Repair Photos'
SELFIE_FOLDER = 'Attendance Selfies'
BROADCAST_FOLDER = 'Broadcast Photos'


def _split_data_uri(v: str):
    """('image/jpeg', raw bytes) from 'data:image/jpeg;base64,...' or bare base64."""
    mime = 'image/jpeg'
    if v.startswith('data:') and ',' in v:
        head, v = v.split(',', 1)
        mime = head[5:].split(';', 1)[0] or mime
    return mime, base64.b64decode(v)


def _thumb_sync(raw: bytes, side: int):
    try:
        import io
        from PIL import Image, ImageOps
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
        if img.mode not in ('RGB', 'L'):
            img = img.convert('RGB')
        img.thumbnail((side, side), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, 'JPEG', quality=75, optimize=True)
        return out.getvalue()
    except Exception:
        return None


def _safe(s: str) -> str:
    return re.sub(r'[^\w\-]+', '', str(s or ''))[:50] or 'photo'


async def _repair_one(cfg) -> bool:
    import drive_service
    for field, label in (('intake_photo', 'intake'), ('final_photo', 'delivery')):
        item = await db.repair_items.find_one(
            {field: {'$regex': '^data:'}, f'{field}_drive_id': {'$exists': False}},
            {'_id': 0, 'id': 1, 'item_code': 1, 'created_at': 1, field: 1})
        if not item:
            continue
        value = item[field]
        try:
            mime, raw = _split_data_uri(value)
        except Exception:
            await db.repair_items.update_one({'id': item['id']}, {'$set': {f'{field}_drive_id': None}})
            return True
        if len(raw) < 8 * 1024:        # already just a thumbnail (e.g. a copy of one) — nothing to move
            await db.repair_items.update_one({'id': item['id'], field: value}, {'$set': {f'{field}_drive_id': None}})
            return True
        name = f"{_safe(item.get('item_code'))}_{label}_{(item.get('created_at') or '')[:10]}.jpg"
        res = await drive_service.upload_raw(cfg, REPAIR_FOLDER, name, raw, mime)
        thumb = await asyncio.to_thread(_thumb_sync, raw, REPAIR_THUMB_SIDE)
        new = f"data:image/jpeg;base64,{base64.b64encode(thumb).decode('ascii')}" if thumb else ''
        # Only if the photo wasn't replaced meanwhile (a bill can set a new final photo).
        await db.repair_items.update_one({'id': item['id'], field: value},
                                         {'$set': {field: new, f'{field}_drive_id': res['drive_file_id']}})
        return True
    return False


async def _selfie_one(cfg) -> bool:
    import drive_service
    for punch in ('check_in', 'check_out'):
        a = await db.attendance.find_one(
            {f'{punch}.selfie': {'$regex': '^.{100}'}},
            {'_id': 0, 'id': 1, 'date': 1, 'employee_id': 1, f'{punch}.selfie': 1})
        if not a:
            continue
        value = a[punch]['selfie']
        try:
            mime, raw = _split_data_uri(value)
        except Exception:
            await db.attendance.update_one({'id': a['id']}, {'$set': {f'{punch}.selfie': '', f'{punch}.selfie_drive_id': None}})
            return True
        emp = await db.employees.find_one({'id': a.get('employee_id')}, {'_id': 0, 'name': 1}) or {}
        who = _safe(emp.get('name') or a.get('employee_id'))
        res = await drive_service.upload_raw(cfg, SELFIE_FOLDER, f"{a.get('date', '')}_{who}_{punch}.jpg", raw, mime)
        await db.attendance.update_one({'id': a['id'], f'{punch}.selfie': value},
                                       {'$set': {f'{punch}.selfie': '', f'{punch}.selfie_drive_id': res['drive_file_id']}})
        return True
    return False


async def _broadcast_one(cfg) -> bool:
    import drive_service
    m = await db.broadcast_media.find_one({'image': {'$nin': [None, '']}, 'drive_file_id': {'$exists': False}}, {'_id': 0})
    if not m:
        return False
    raw = base64.b64decode(m['image'])
    from routers.broadcasts import cache_media
    await asyncio.to_thread(cache_media, m['id'], raw)      # keep serving it from the disk cache
    res = await drive_service.upload_raw(cfg, BROADCAST_FOLDER, f"{m['id']}.jpg", raw, 'image/jpeg')
    await db.broadcast_media.update_one({'id': m['id']}, {'$set': {'image': None, 'drive_file_id': res['drive_file_id']}})
    return True


async def _id_proofs_once() -> None:
    """Employees' old id_proofs array: its photos were copied into Documents
    ('ids' category, linked to the employee). Drop the array once every copy is in Drive."""
    async for emp in db.employees.find({'id_proofs.0': {'$exists': True}}, {'_id': 0, 'id': 1, 'id_proofs': 1}):
        copies = await db.documents.count_documents({
            'linked_ref.type': 'employee', 'linked_ref.id': emp['id'], 'category_key': 'ids',
            'uploaded_by': 'system', 'upload_state': 'synced', 'deleted': {'$ne': True}})
        if copies >= len(emp.get('id_proofs') or []):
            await db.employees.update_one({'id': emp['id']}, {'$unset': {'id_proofs': ''}})
            logger.info(f"dropped {len(emp['id_proofs'])} legacy id proof(s) from employee {emp['id'][:8]} (in Drive)")


async def media_offload_loop() -> None:
    import drive_service
    await asyncio.sleep(90)
    last_proofs = 0.0
    while True:
        moved = False
        try:
            if await drive_service.is_connected():
                cfg = await drive_service.get_config()
                moved = await _repair_one(cfg) or await _selfie_one(cfg) or await _broadcast_one(cfg)
                loop_t = asyncio.get_running_loop().time()
                if loop_t - last_proofs > 3600:
                    last_proofs = loop_t
                    await _id_proofs_once()
        except Exception as e:
            err = str(e)[:200]
            logger.warning(f'media offload: {err}')
            if 'invalid_grant' in err or 'invalid_client' in err:
                await _notify_system_health('drive_disconnected', 'Google Drive disconnected',
                                             'Google Drive needs to be reconnected — photos are waiting to move to Drive (Settings > Google Drive).', '/settings/google-drive')
            await db.settings.update_one({'id': 'media_offload'}, {'$set': {'id': 'media_offload', 'last_error': err, 'last_error_at': now_utc().isoformat()}}, upsert=True)
            await asyncio.sleep(60)
        # Work through the backlog briskly, then check every few minutes for new photos.
        await asyncio.sleep(2 if moved else 300)
