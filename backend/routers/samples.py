"""Sample Issue/Receive: gold sample pieces lent to a karigar (e.g. for
quoting or reference), expected back at the same weight — no billing, no
customer, no repair lifecycle. Much lighter than the repairs module, but
shares the same karigar_ledger so a karigar's gold balance always reflects
samples out with them, same as repair items.

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
)

router = APIRouter()


async def _next_sample_code() -> str:
    count = await db.samples.count_documents({})
    return f'SMP-{count + 1:04d}'


@router.post('/samples')
async def create_sample(body: SampleIn, user=Depends(require_admin_or_module('samples'))):
    """Creating a sample IS issuing it — there's no shop-held precursor state
    the way repair items have (received from a customer first); the shop's
    own sample piece goes straight to the karigar."""
    karigar = await db.karigars.find_one({'id': body.karigar_id}, {'_id': 0})
    if not karigar:
        raise HTTPException(status_code=404, detail='Karigar not found')
    if body.gross_weight <= 0:
        raise HTTPException(status_code=400, detail='Weight must be greater than 0')

    purity = body.purity if body.purity is not None else 100.0
    fine_weight = round(body.gross_weight * purity / 100, 3)
    iso = now_utc().isoformat()
    sample_id = str(uuid.uuid4())
    sample_code = await _next_sample_code()

    sample = {
        'id': sample_id, 'sample_code': sample_code, 'description': body.description,
        'purity': purity, 'gross_weight': body.gross_weight, 'fine_weight': fine_weight,
        'karigar_id': karigar['id'], 'karigar_name': karigar['name'],
        'status': 'with_karigar',
        'issued_at': iso, 'issued_by': user['name'],
        'received_weight': None, 'received_fine_weight': None, 'weight_diff': None,
        'received_at': None, 'received_by': None,
        'note': body.note or '', 'created_at': iso, 'created_by': user['name'],
    }
    await db.samples.insert_one(dict(sample))
    await db.karigar_ledger.insert_one({
        'id': str(uuid.uuid4()), 'karigar_id': karigar['id'], 'type': 'gold_out',
        'weight': body.gross_weight, 'fine_weight': fine_weight, 'amount': None,
        'item_id': sample_id, 'item_code': sample_code,
        'note': f"Sample issued: {body.description}", 'created_at': iso, 'created_by': user['name'],
    })
    await log_audit(user, 'sample.issue', 'sample', sample_id, sample_code,
                     {'karigar': karigar['name'], 'weight': body.gross_weight})
    return {k: v for k, v in sample.items() if k != '_id'}


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
        raise HTTPException(status_code=400, detail='This sample has already been received back — only description/note edits before receipt are allowed')

    upd: dict = {}
    if body.description is not None: upd['description'] = body.description
    if body.note is not None: upd['note'] = body.note
    if body.purity is not None:
        # Weight itself is locked once issued (it's what the karigar_ledger
        # gold_out entry was posted with) — same rule repair items use —
        # but purity alone can still be corrected, recomputing fine_weight.
        upd['purity'] = body.purity
        upd['fine_weight'] = round(sample['gross_weight'] * body.purity / 100, 3)
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

    purity = sample.get('purity') or 100.0
    received_fine_weight = round(body.received_weight * purity / 100, 3)
    weight_diff = round(body.received_weight - sample['gross_weight'], 3)
    iso = now_utc().isoformat()

    note = f"Sample received back: {sample['description']}"
    if weight_diff:
        note += f" (diff {weight_diff:+.3f}g vs issued — expected the same weight back)"

    await db.karigar_ledger.insert_one({
        'id': str(uuid.uuid4()), 'karigar_id': sample['karigar_id'], 'type': 'gold_in',
        'weight': body.received_weight, 'fine_weight': received_fine_weight, 'amount': None,
        'item_id': sample_id, 'item_code': sample['sample_code'],
        'note': note, 'created_at': iso, 'created_by': user['name'],
    })
    await db.samples.update_one({'id': sample_id}, {'$set': {
        'status': 'received', 'received_weight': body.received_weight,
        'received_fine_weight': received_fine_weight, 'weight_diff': weight_diff,
        'received_at': iso, 'received_by': user['name'],
        'note': (sample.get('note') or '') + (f"\n{body.note}" if body.note else ''),
    }})
    await log_audit(user, 'sample.receive', 'sample', sample_id, sample['sample_code'], {'weight_diff': weight_diff})
    return await db.samples.find_one({'id': sample_id}, {'_id': 0})
