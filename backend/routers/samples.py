"""Sample Issue/Receive: gold sample pieces lent to a karigar (e.g. for
quoting or reference), expected back at the same weight — no billing, no
customer, no repair lifecycle, no purity/fine-weight conversion (samples
are tracked in plain weight; karigar_ledger entries omit fine_weight so the
balance aggregator falls back to using weight directly). Much lighter than
the repairs module, but shares the same karigar_ledger so a karigar's gold
balance always reflects samples out with them.

New module, added alongside the §2.1 router split — see server.py for the
'samples' entry in MODULE_DEFS."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
import re
import uuid
from server import (
    db,
    now_utc,
    require_staff_or_module,
    require_admin_or_module,
    require_admin_or_module_right,
    SampleIn,
    SampleUpdateIn,
    SampleReceiveIn,
    log_audit,
    _notify_module,
)

router = APIRouter()


async def _next_sample_code() -> str:
    count = await db.samples.count_documents({})
    return f'SMP-{count + 1:04d}'


@router.post('/samples')
async def create_samples(body: SampleIn, user=Depends(require_admin_or_module('samples'))):
    """Creating a sample IS issuing it — there's no shop-held precursor state
    the way repair items have (received from a customer first); the shop's
    own sample piece(s) go straight to the karigar. Takes a list so several
    pieces can be issued to the same karigar in one go, each still getting
    its own record, tag, and ledger entry."""
    if not body.items:
        raise HTTPException(status_code=400, detail='At least one sample is required')
    karigar = await db.karigars.find_one({'id': body.karigar_id}, {'_id': 0})
    if not karigar:
        raise HTTPException(status_code=404, detail='Karigar not found')
    for spec in body.items:
        if spec.weight <= 0:
            raise HTTPException(status_code=400, detail=f'Weight must be greater than 0 for "{spec.description}"')

    iso = now_utc().isoformat()
    created = []
    for spec in body.items:
        sample_id = str(uuid.uuid4())
        sample_code = await _next_sample_code()
        sample = {
            'id': sample_id, 'sample_code': sample_code, 'description': spec.description,
            'tag_number': spec.tag_number or '', 'weight': spec.weight, 'photo': spec.photo or '',
            'karigar_id': karigar['id'], 'karigar_name': karigar['name'],
            'status': 'with_karigar',
            'issued_at': iso, 'issued_by': user['name'], 'issued_by_id': user['id'],
            'received_weight': None, 'weight_diff': None,
            'received_at': None, 'received_by': None,
            'note': body.note or '', 'created_at': iso, 'created_by': user['name'],
        }
        await db.samples.insert_one(dict(sample))
        tag_note = f" (tag {spec.tag_number})" if spec.tag_number else ''
        await db.karigar_ledger.insert_one({
            'id': str(uuid.uuid4()), 'karigar_id': karigar['id'], 'type': 'gold_out',
            'weight': spec.weight, 'fine_weight': None, 'amount': None,
            'item_id': sample_id, 'item_code': sample_code,
            'note': f"Sample issued: {spec.description}{tag_note}", 'created_at': iso, 'created_by': user['name'],
        })
        created.append({k: v for k, v in sample.items() if k != '_id'})

    await log_audit(user, 'sample.issue', 'sample', created[0]['id'], f"{len(created)} sample(s)",
                     {'karigar': karigar['name'], 'count': len(created)})
    await _notify_module('samples', f"{len(created)} sample(s) issued",
                          f"Issued to {karigar['name']} by {user['name']}", '/samples')
    return created


@router.get('/samples')
async def list_samples(
    status_: Optional[str] = Query(default=None, alias='status'),
    q: Optional[str] = None,
    _: dict = Depends(require_staff_or_module('samples')),
):
    query: dict = {}
    if status_ and status_ != 'all':
        query['status'] = status_
    if q:
        q_esc = re.escape(q)
        query['$or'] = [
            {'sample_code': {'$regex': q_esc, '$options': 'i'}},
            {'tag_number': {'$regex': q_esc, '$options': 'i'}},
            {'description': {'$regex': q_esc, '$options': 'i'}},
            {'karigar_name': {'$regex': q_esc, '$options': 'i'}},
        ]
    return await db.samples.find(query, {'_id': 0}).sort('created_at', -1).to_list(1000)


@router.get('/samples/{sample_id}')
async def get_sample(sample_id: str, _: dict = Depends(require_staff_or_module('samples'))):
    sample = await db.samples.find_one({'id': sample_id}, {'_id': 0})
    if not sample:
        raise HTTPException(status_code=404, detail='Sample not found')
    return sample


@router.put('/samples/{sample_id}')
async def update_sample(sample_id: str, body: SampleUpdateIn, user=Depends(require_admin_or_module_right('samples', 'edit'))):
    sample = await db.samples.find_one({'id': sample_id}, {'_id': 0})
    if not sample:
        raise HTTPException(status_code=404, detail='Sample not found')
    if sample['status'] != 'with_karigar':
        raise HTTPException(status_code=400, detail='This sample has already been received back — only description/tag/note edits before receipt are allowed')

    upd: dict = {}
    if body.description is not None: upd['description'] = body.description
    if body.tag_number is not None: upd['tag_number'] = body.tag_number
    if body.note is not None: upd['note'] = body.note
    if upd:
        await db.samples.update_one({'id': sample_id}, {'$set': upd})
        await log_audit(user, 'sample.update', 'sample', sample_id, sample['sample_code'])
    return await db.samples.find_one({'id': sample_id}, {'_id': 0})


@router.delete('/samples/{sample_id}')
async def delete_sample(sample_id: str, user=Depends(require_admin_or_module_right('samples', 'delete'))):
    sample = await db.samples.find_one({'id': sample_id}, {'_id': 0})
    if not sample:
        raise HTTPException(status_code=404, detail='Sample not found')
    # Full reversal — deleting a sample undoes its effect on the karigar's
    # gold balance too, not just the record, so nothing is left dangling
    # whether it's still with the karigar or already received back.
    await db.karigar_ledger.delete_many({'item_id': sample_id})
    await db.samples.delete_one({'id': sample_id})
    await log_audit(user, 'sample.delete', 'sample', sample_id, sample['sample_code'])
    return {'ok': True}


@router.post('/samples/{sample_id}/receive')
async def receive_sample(sample_id: str, body: SampleReceiveIn, user=Depends(require_admin_or_module('samples'))):
    sample = await db.samples.find_one({'id': sample_id}, {'_id': 0})
    if not sample:
        raise HTTPException(status_code=404, detail='Sample not found')
    if sample['status'] != 'with_karigar':
        raise HTTPException(status_code=400, detail='This sample is not currently with a karigar')
    if body.received_weight <= 0:
        raise HTTPException(status_code=400, detail='Received weight must be greater than 0')

    weight_diff = round(body.received_weight - sample['weight'], 3)
    iso = now_utc().isoformat()
    note = f"Sample received back: {sample['description']}"
    if weight_diff:
        note += f" (diff {weight_diff:+.3f}g vs issued — expected the same weight back)"

    await db.karigar_ledger.insert_one({
        'id': str(uuid.uuid4()), 'karigar_id': sample['karigar_id'], 'type': 'gold_in',
        'weight': body.received_weight, 'fine_weight': None, 'amount': None,
        'item_id': sample_id, 'item_code': sample['sample_code'],
        'note': note, 'created_at': iso, 'created_by': user['name'],
    })
    await db.samples.update_one({'id': sample_id}, {'$set': {
        'status': 'received', 'received_weight': body.received_weight, 'weight_diff': weight_diff,
        'received_at': iso, 'received_by': user['name'],
        'note': (sample.get('note') or '') + (f"\n{body.note}" if body.note else ''),
    }})
    await log_audit(user, 'sample.receive', 'sample', sample_id, sample['sample_code'], {'weight_diff': weight_diff})
    diff_note = f" (diff {weight_diff:+.3f}g)" if weight_diff else ''
    await _notify_module('samples', 'Sample received back',
                          f"{sample['sample_code']} · {sample['description']} from {sample['karigar_name']}{diff_note}", '/samples')
    return await db.samples.find_one({'id': sample_id}, {'_id': 0})
