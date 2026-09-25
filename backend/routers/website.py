"""Website module — the "Fresh at the counter" pieces shown on rmj.co.in.

Staff add a photo with a name and metal from Settings > Website; the public
site reads GET /api/public/website/pieces (visible pieces, in order) and
loads each photo from its public image URL. Photos are resized to a
web-friendly JPEG on upload and kept in the database, so they're served
straight from here with no Drive/Hostinger dependency."""
import asyncio
import base64
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel

from server import db, log_audit, now_utc, require_admin

router = APIRouter()

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


def _public(p: dict) -> dict:
    return {
        'id': p['id'], 'name': p.get('name') or '', 'metal': p.get('metal') or '',
        'image_url': f"/api/public/website/pieces/{p['id']}/image?v={p.get('image_version', 1)}",
    }


@router.get('/website/pieces')
async def list_pieces(_: dict = Depends(require_admin)):
    items = await db.website_pieces.find({}, _ADMIN_PROJ).sort('sort', 1).to_list(_MAX_PIECES)
    # Thumbnail inline: hidden pieces' photos aren't served publicly.
    return [{**{k: v for k, v in p.items() if k != 'thumb'}, 'image_url': _public(p)['image_url'],
             'thumb': f"data:image/jpeg;base64,{p['thumb']}" if p.get('thumb') else None} for p in items]


@router.post('/website/pieces')
async def add_piece(
    file: UploadFile = File(...), name: str = Form(default=''), metal: str = Form(default=''),
    user: dict = Depends(require_admin),
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
async def update_piece(piece_id: str, body: PieceIn, user: dict = Depends(require_admin)):
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
async def reorder_pieces(body: OrderIn, user: dict = Depends(require_admin)):
    for i, pid in enumerate(body.ids):
        await db.website_pieces.update_one({'id': pid}, {'$set': {'sort': i}})
    await log_audit(user, 'website.piece.reorder', 'website_piece', '', str(len(body.ids)))
    return {'ok': True}


@router.delete('/website/pieces/{piece_id}')
async def delete_piece(piece_id: str, user: dict = Depends(require_admin)):
    res = await db.website_pieces.delete_one({'id': piece_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail='Piece not found')
    await log_audit(user, 'website.piece.delete', 'website_piece', piece_id, '')
    return {'ok': True}


# ---------------- Public (no auth) — read by rmj.co.in ----------------
@router.get('/public/website/pieces')
async def public_pieces():
    items = await db.website_pieces.find({'visible': True}, _PUBLIC_PROJ).sort('sort', 1).to_list(_MAX_PIECES)
    return {'pieces': [_public(p) for p in items]}


@router.get('/public/website/pieces/{piece_id}/image')
async def public_piece_image(piece_id: str):
    p = await db.website_pieces.find_one({'id': piece_id, 'visible': True}, {'_id': 0, 'image': 1})
    if not p or not p.get('image'):
        raise HTTPException(status_code=404, detail='Not found')
    # The URL carries ?v=<image_version>, so it's safe to cache hard.
    return Response(content=base64.b64decode(p['image']), media_type='image/jpeg',
                    headers={'Cache-Control': 'public, max-age=604800'})
