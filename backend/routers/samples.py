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
from pydantic import BaseModel
from typing import Optional
import re
import uuid
from server import (
    db,
    now_utc,
    today_str,
    require_staff_or_module,
    require_admin_or_module,
    require_admin_or_module_right,
    SampleIn,
    SampleUpdateIn,
    SampleReceiveIn,
    log_audit,
    _notify_module,
    _pdf_response,
)
# Thermal-printer helpers live in routers/repairs.py (where they were first
# built) rather than the shared core — reused here as-is instead of
# duplicating the ESC/POS builder for a second module.
from routers.repairs import _escpos_receipt, _print_escpos, _thermal_slip_pdf, _dmy

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
            'tag_number': spec.tag_number or '', 'weight': spec.weight, 'pc_count': spec.pc_count or 1,
            'photo': spec.photo or '', 'issue_type': body.issue_type or '', 'due_date': body.due_date,
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
                          f"Issued to {karigar['name']} by {user['name']}", '/samples', script='sample_issued')
    return created


DEFAULT_ISSUE_TYPES = ['Quoting', 'Reference', 'Exhibition', 'Approval', 'Repair Sample']


@router.get('/samples/issue-types')
async def get_issue_types(_: dict = Depends(require_staff_or_module('samples'))):
    doc = await db.settings.find_one({'id': 'samples'}, {'_id': 0})
    return {'issue_types': (doc or {}).get('issue_types', DEFAULT_ISSUE_TYPES)}


class IssueTypesIn(BaseModel):
    issue_types: list[str]


@router.put('/samples/issue-types')
async def set_issue_types(body: IssueTypesIn, user=Depends(require_admin_or_module('samples'))):
    cleaned = [t.strip() for t in body.issue_types if t.strip()]
    await db.settings.update_one(
        {'id': 'samples'}, {'$set': {'id': 'samples', 'issue_types': cleaned, 'updated_at': now_utc().isoformat()}}, upsert=True,
    )
    await log_audit(user, 'samples.issue_types', 'settings', 'samples', ', '.join(cleaned))
    return {'issue_types': cleaned}


@router.get('/samples')
async def list_samples(
    status_: Optional[str] = Query(default=None, alias='status'),
    q: Optional[str] = None,
    _: dict = Depends(require_staff_or_module('samples')),
):
    query: dict = {}
    if status_ == 'overdue':
        query['due_date'] = {'$ne': None, '$lt': today_str()}
        # Only a piece still out with the karigar can be "overdue" — once it's
        # back, the due date no longer describes anything actionable.
        query['status'] = 'with_karigar'
    elif status_ and status_ != 'all':
        query['status'] = status_
    if q:
        q_esc = re.escape(q)
        query['$or'] = [
            {'sample_code': {'$regex': q_esc, '$options': 'i'}},
            {'tag_number': {'$regex': q_esc, '$options': 'i'}},
            {'description': {'$regex': q_esc, '$options': 'i'}},
            {'karigar_name': {'$regex': q_esc, '$options': 'i'}},
        ]
    # The list screen never renders the photo thumbnail (only the detail
    # screen does, via GET /samples/{id}) — excluding it here avoids shipping
    # a base64 image blob per row on every list load.
    return await db.samples.find(query, {'_id': 0, 'photo': 0}).sort('created_at', -1).to_list(1000)


@router.get('/samples/dashboard')
async def samples_dashboard(_: dict = Depends(require_staff_or_module('samples'))):
    """Compact stock-in/out stats for the employee Transactions screen — just
    the two buckets that need a glance: what's currently out, and what's
    overdue within that. Same overdue definition as list_samples's own
    overdue filter, so the tile and the list it links to always agree."""
    today = today_str()
    out = await db.samples.find(
        {'status': 'with_karigar'}, {'_id': 0, 'due_date': 1},
    ).to_list(5000)
    overdue = sum(1 for s in out if s.get('due_date') and s['due_date'] < today)
    received_today = await db.samples.count_documents({'status': 'received', 'received_at': {'$regex': f'^{today}'}})
    return {'with_karigar': len(out), 'overdue': overdue, 'received_today': received_today}


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
    if body.pc_count is not None: upd['pc_count'] = max(1, body.pc_count)
    if body.issue_type is not None: upd['issue_type'] = body.issue_type
    if body.due_date is not None: upd['due_date'] = body.due_date or None
    if body.photo is not None: upd['photo'] = body.photo
    if body.note is not None: upd['note'] = body.note
    if body.weight is not None and body.weight > 0 and round(body.weight, 3) != round(sample['weight'], 3):
        upd['weight'] = body.weight
        # The weight was already booked to the karigar's gold-out ledger entry
        # at issue time — keep that entry in sync so the balance stays right,
        # instead of silently drifting from what the edited voucher now says.
        await db.karigar_ledger.update_many(
            {'item_id': sample_id, 'type': 'gold_out'}, {'$set': {'weight': body.weight}},
        )
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


def _sample_issue_slip_lines(sample: dict) -> list:
    """Shared shape with repairs.py's _issue_slip_lines, minus the
    purity/fine-weight fields samples don't track."""
    lines = [
        ('Sample No', sample['sample_code']),
        ('Date', _dmy((sample.get('issued_at') or '')[:10])),
        ('Karigar', sample['karigar_name']),
    ]
    if sample.get('tag_number'):
        lines.append(('Tag', sample['tag_number']))
    lines += [
        ('Item', sample['description']),
        ('Pieces', str(sample.get('pc_count') or 1)),
        ('Weight Issued', f"{sample['weight']:.3f}g"),
    ]
    if sample.get('issue_type'):
        lines.append(('Issue Type', sample['issue_type']))
    if sample.get('due_date'):
        lines.append(('Due Back', _dmy(sample['due_date'])))
    lines.append(('Issued By', sample.get('issued_by') or ''))
    if sample.get('note'):
        lines.append(('Note', sample['note']))
    return lines


@router.get('/samples/{sample_id}/issue-slip/pdf')
async def sample_issue_slip_pdf(sample_id: str, _: dict = Depends(require_staff_or_module('samples'))):
    """Downloadable version of the same karigar issue challan — same narrow
    label-style layout as the repairs module's issue-slip/bill/intake PDFs,
    so every printout in the app (Repair and Stock In-Out alike) looks the same."""
    sample = await db.samples.find_one({'id': sample_id}, {'_id': 0})
    if not sample:
        raise HTTPException(status_code=404, detail='Sample not found')
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    pdf = _thermal_slip_pdf(
        store.get('name') or 'Ram Murti Jewellers', 'Sample Issue Challan', _sample_issue_slip_lines(sample),
    )
    return _pdf_response(pdf, f'sample-issue-{sample["sample_code"]}.pdf')


@router.post('/samples/{sample_id}/issue-slip/print')
async def sample_issue_slip_print(sample_id: str, user=Depends(require_staff_or_module('samples'))):
    """Sends a karigar issue challan for this sample straight to the
    configured WiFi thermal printer — same idea as the repairs module's
    issue-slip print, just with the lighter sample field set."""
    sample = await db.samples.find_one({'id': sample_id}, {'_id': 0})
    if not sample:
        raise HTTPException(status_code=404, detail='Sample not found')
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    data = _escpos_receipt(store.get('name') or 'Ram Murti Jewellers', 'Sample Issue Challan', _sample_issue_slip_lines(sample))
    await _print_escpos(data)
    await log_audit(user, 'sample.issue_slip_print', 'sample', sample_id, sample['sample_code'], {})
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
                          f"{sample['sample_code']} · {sample['description']} from {sample['karigar_name']}{diff_note}", '/samples', script='sample_received')
    return await db.samples.find_one({'id': sample_id}, {'_id': 0})
