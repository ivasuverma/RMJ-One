"""One-off: remove document/photo originals from THIS computer once they are
verified to exist in Google Drive (the shop keeps Drive as the only permanent copy).

For every synced document / record photo it asks Drive for the file's size and only
deletes the local copy when that matches the local original byte-for-byte in size.
Anything that fails the check is left alone and reported.

    python scripts/purge_local_media.py            # dry run: report only
    python scripts/purge_local_media.py --apply    # delete verified local copies

Keeps: the small grid thumbnails (documents: <id>.thumb, record photos: thumb_data).
"""
import asyncio
import base64
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import httpx  # noqa: E402
import drive_service  # noqa: E402
from server import db  # noqa: E402
from routers.documents import DOC_CACHE_DIR, _make_thumb_sync  # noqa: E402
from routers import record_photos as rp  # noqa: E402

APPLY = '--apply' in sys.argv


async def drive_size(h, token, file_id):
    r = await h.get(f'https://www.googleapis.com/drive/v3/files/{file_id}',
                    params={'fields': 'id,size,trashed'}, headers={'Authorization': f'Bearer {token}'})
    if r.status_code != 200:
        return None
    j = r.json()
    if j.get('trashed'):
        return None
    return int(j['size']) if j.get('size') is not None else None


async def main():
    cfg = await drive_service.get_config()
    token = await drive_service._access_token(cfg)
    stats = {'doc_ok': 0, 'doc_skip': 0, 'rp_ok': 0, 'rp_skip': 0, 'bytes': 0}
    async with httpx.AsyncClient(timeout=60) as h:
        # ---- documents ----
        rows = await db.documents.find(
            {'deleted': {'$ne': True}, 'upload_state': 'synced', 'file.drive_file_id': {'$ne': None}},
            {'_id': 0, 'id': 1, 'file': 1}).to_list(None)
        for r in rows:
            did = r['id']
            full = DOC_CACHE_DIR / f'{did}.full'
            view = DOC_CACHE_DIR / f'{did}.view'
            thumb = DOC_CACHE_DIR / f'{did}.thumb'
            local = full.stat().st_size if full.is_file() else None
            remote = await drive_size(h, token, r['file']['drive_file_id'])
            if remote is None or (local is not None and local != remote):
                print(f'SKIP doc {did[:8]}: drive={remote} local={local}')
                stats['doc_skip'] += 1
                continue
            if APPLY:
                if not thumb.is_file() and local:            # never lose the grid thumbnail
                    t = _make_thumb_sync(full.read_bytes())
                    if t:
                        thumb.write_bytes(t)
                for f in (full, view):
                    if f.is_file():
                        stats['bytes'] += f.stat().st_size
                        f.unlink()
                if thumb.is_file():                          # legacy database copy of the image
                    await db.document_blobs.delete_one({'id': did})
            stats['doc_ok'] += 1
        # ---- record photos ----
        photos = await db.record_photos.find(
            {'deleted': {'$ne': True}, 'upload_state': 'synced', 'file.drive_file_id': {'$ne': None}, 'local_data': {'$ne': None}},
            {'_id': 0}).to_list(None)
        for p in photos:
            raw = base64.b64decode(p['local_data']) if p.get('local_kind') == 'full' else None
            remote = await drive_size(h, token, p['file']['drive_file_id'])
            if remote is None or (raw is not None and len(raw) != remote):
                print(f'SKIP photo {p["id"][:8]}: drive={remote} local={len(raw) if raw else None}')
                stats['rp_skip'] += 1
                continue
            if APPLY:
                thumb = p.get('thumb_data')
                if not thumb and raw:
                    t = _make_thumb_sync(raw)
                    thumb = base64.b64encode(t).decode('ascii') if t else None
                await db.record_photos.update_one({'id': p['id']}, {'$set': {
                    'local_data': None, 'local_kind': 'thumb' if thumb else 'none', 'thumb_data': thumb}})
                stats['bytes'] += len(raw or b'')
                try:
                    rp._view_path(p['id']).unlink(missing_ok=True)
                except Exception:
                    pass
            stats['rp_ok'] += 1
    print(('APPLIED' if APPLY else 'DRY RUN'), stats, f"-> {stats['bytes'] // 1024 // 1024} MB freed")


asyncio.run(main())
