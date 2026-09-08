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
from datetime import date, timedelta
import re
import uuid
from server import (
    db,
    now_utc,
    today_str,
    require_staff_or_module,
    require_admin_or_module,
    require_admin_or_module_right,
    require_owner,
    SampleIn,
    SampleUpdateIn,
    SampleReceiveIn,
    post_gold_ledger_entry,
    delete_gold_ledger_entries,
    log_audit,
    _notify_module,
    _pdf_response,
    get_print_config,
    _make_photo_thumb,
)
from print_templates import apply_field_config
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
            'photo': spec.photo or '', 'photo_thumb': _make_photo_thumb(spec.photo or ''),
            'issue_type': body.issue_type or '', 'due_date': body.due_date,
            'karigar_id': karigar['id'], 'karigar_name': karigar['name'],
            'status': 'with_karigar',
            'issued_at': iso, 'issued_by': user['name'], 'issued_by_id': user['id'],
            'received_weight': None, 'weight_diff': None,
            'received_at': None, 'received_by': None,
            'note': body.note or '', 'created_at': iso, 'created_by': user['name'],
        }
        await db.samples.insert_one(dict(sample))
        tag_note = f" (tag {spec.tag_number})" if spec.tag_number else ''
        await post_gold_ledger_entry({
            'id': str(uuid.uuid4()), 'karigar_id': karigar['id'], 'karigar_name': karigar['name'], 'type': 'gold_out',
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
async def set_issue_types(body: IssueTypesIn, user=Depends(require_admin_or_module_right('samples', 'edit'))):
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
    user: dict = Depends(require_staff_or_module('samples')),
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
    if user.get('role') == 'employee':
        # A received sample drops out of an employee's view the day after it
        # was received back — visible on receive day, gone from every
        # filter/search the next day. Owner/admin/accountant always see full
        # history regardless.
        query.setdefault('$and', []).append(
            {'$or': [{'status': {'$ne': 'received'}}, {'received_at': {'$regex': f'^{today_str()}'}}]}
        )
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
    if body.photo is not None:
        upd['photo'] = body.photo
        upd['photo_thumb'] = _make_photo_thumb(body.photo)
    if body.note is not None: upd['note'] = body.note
    if body.weight is not None and body.weight > 0 and round(body.weight, 3) != round(sample['weight'], 3):
        upd['weight'] = body.weight
        # The weight was already booked to the karigar's gold-out ledger entry
        # at issue time — keep that entry in sync so the balance stays right,
        # instead of silently drifting from what the edited voucher now says.
        await db.karigar_ledger.update_many(
            {'item_id': sample_id, 'type': 'gold_out'}, {'$set': {'weight': body.weight}},
        )
        await db.metal_ledger.update_many(
            {'item_id': sample_id, 'type': 'out'}, {'$set': {'weight': body.weight}},
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
    await delete_gold_ledger_entries({'item_id': sample_id})
    await db.samples.delete_one({'id': sample_id})
    await log_audit(user, 'sample.delete', 'sample', sample_id, sample['sample_code'])
    return {'ok': True}


def _sample_issue_slip_lines(sample: dict) -> list:
    """Shared shape with repairs.py's _issue_slip_lines, minus the
    purity/fine-weight fields samples don't track."""
    lines = [
        ('sample_no', 'Sample No', sample['sample_code']),
        ('date', 'Date', _dmy((sample.get('issued_at') or '')[:10])),
        ('karigar', 'Karigar', sample['karigar_name']),
    ]
    if sample.get('tag_number'):
        lines.append(('tag', 'Tag', sample['tag_number']))
    lines += [
        ('item', 'Item', sample['description']),
        ('pieces', 'Pieces', str(sample.get('pc_count') or 1)),
        ('weight_issued', 'Weight Issued', f"{sample['weight']:.3f}g"),
    ]
    if sample.get('issue_type'):
        lines.append(('issue_type', 'Issue Type', sample['issue_type']))
    if sample.get('due_date'):
        lines.append(('due_back', 'Due Back', _dmy(sample['due_date'])))
    lines.append(('issued_by', 'Issued By', sample.get('issued_by') or ''))
    if sample.get('note'):
        lines.append(('note', 'Note', sample['note']))
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
    cfg = await get_print_config('sample_issue')
    pdf = _thermal_slip_pdf(
        store.get('name') or 'Ram Murti Jewellers', 'Sample Issue Challan',
        apply_field_config(_sample_issue_slip_lines(sample), cfg),
        show_shop_name=cfg['show_shop_name'], font_size=cfg['font_size'], field_sizes=cfg['field_sizes'],
        title_size=cfg['title_size'], field_dividers=cfg['field_dividers'],
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
    cfg = await get_print_config('sample_issue')
    data = _escpos_receipt(store.get('name') or 'Ram Murti Jewellers', 'Sample Issue Challan',
                            apply_field_config(_sample_issue_slip_lines(sample), cfg),
                            show_shop_name=cfg['show_shop_name'], font_size=cfg['font_size'], field_sizes=cfg['field_sizes'],
                            title_size=cfg['title_size'], field_dividers=cfg['field_dividers'])
    await _print_escpos(data)
    await log_audit(user, 'sample.issue_slip_print', 'sample', sample_id, sample['sample_code'], {})
    return {'ok': True}


async def _post_sample_receive_ledger(sample: dict, body: SampleReceiveIn, txn_id: str, iso: str, user: dict) -> float:
    """Every karigar_ledger entry for one receive event. The main 'received
    back' credit is normally whatever weight physically came back, as-is —
    samples don't charge wastage like repairs does — except when a shortfall
    is written off as loss (write_off_loss), in which case the credit is
    bumped up to the full issued weight (forgiving the gap, same idea as
    repairs.py's process_loss) and a separate 'loss' entry records it for
    the Loss Ledger. write_off_loss and pay/recv_weight are mutually
    exclusive in the UI (carry the gap on the balance, settle it now, or
    forgive it) — the backend gives write-off priority if both arrive.
    Tagged with txn_id so an edit/delete can find and replace exactly these
    entries without touching the original issue's gold_out. Shared by
    create and edit, same delete-then-repost pattern as repairs.py."""
    weight_diff = round(body.received_weight - sample['weight'], 3)
    write_off = bool(body.write_off_loss) and weight_diff < 0
    note = f"Sample received back: {sample['description']}"
    if weight_diff:
        note += f" (diff {weight_diff:+.3f}g vs issued — expected the same weight back)"
    if write_off:
        note += ' · shortfall written off as loss'
    await post_gold_ledger_entry({
        'id': str(uuid.uuid4()), 'karigar_id': sample['karigar_id'], 'karigar_name': sample.get('karigar_name'), 'type': 'gold_in',
        'weight': sample['weight'] if write_off else body.received_weight, 'fine_weight': None, 'amount': None,
        'item_id': sample['id'], 'item_code': sample['sample_code'], 'txn_id': txn_id,
        'note': note, 'created_at': iso, 'created_by': user['name'],
    })
    if write_off:
        await post_gold_ledger_entry({
            'id': str(uuid.uuid4()), 'karigar_id': sample['karigar_id'], 'karigar_name': sample.get('karigar_name'), 'type': 'loss',
            'weight': abs(weight_diff), 'fine_weight': None, 'amount': None,
            'item_id': sample['id'], 'item_code': sample['sample_code'], 'txn_id': txn_id,
            'note': f"Process loss declared: {sample['description']}",
            'created_at': iso, 'created_by': user['name'],
        })
        return weight_diff
    pay_weight = body.pay_weight or 0
    if pay_weight:
        await post_gold_ledger_entry({
            'id': str(uuid.uuid4()), 'karigar_id': sample['karigar_id'], 'karigar_name': sample.get('karigar_name'), 'type': 'gold_out',
            'weight': pay_weight, 'fine_weight': None, 'amount': None,
            'item_id': sample['id'], 'item_code': sample['sample_code'], 'txn_id': txn_id,
            'note': f"Extra gold paid on the spot to settle {sample['sample_code']}",
            'created_at': iso, 'created_by': user['name'],
        })
    recv_weight = body.recv_weight or 0
    if recv_weight:
        await post_gold_ledger_entry({
            'id': str(uuid.uuid4()), 'karigar_id': sample['karigar_id'], 'karigar_name': sample.get('karigar_name'), 'type': 'gold_in',
            'weight': recv_weight, 'fine_weight': None, 'amount': None,
            'item_id': sample['id'], 'item_code': sample['sample_code'], 'txn_id': txn_id,
            'note': f"Extra gold received on the spot to settle {sample['sample_code']}",
            'created_at': iso, 'created_by': user['name'],
        })
    return weight_diff


@router.post('/samples/{sample_id}/receive')
async def receive_sample(sample_id: str, body: SampleReceiveIn, user=Depends(require_admin_or_module('samples'))):
    sample = await db.samples.find_one({'id': sample_id}, {'_id': 0})
    if not sample:
        raise HTTPException(status_code=404, detail='Sample not found')
    if sample['status'] != 'with_karigar':
        raise HTTPException(status_code=400, detail='This sample is not currently with a karigar')
    if body.received_weight <= 0:
        raise HTTPException(status_code=400, detail='Received weight must be greater than 0')

    txn_id = str(uuid.uuid4())
    iso = now_utc().isoformat()
    weight_diff = await _post_sample_receive_ledger(sample, body, txn_id, iso, user)
    await db.samples.update_one({'id': sample_id}, {'$set': {
        'status': 'received', 'received_weight': body.received_weight, 'weight_diff': weight_diff,
        'received_at': iso, 'received_by': user['name'], 'receive_txn_id': txn_id,
        'pay_weight': body.pay_weight or 0, 'recv_weight': body.recv_weight or 0,
        'write_off_loss': bool(body.write_off_loss) and weight_diff < 0,
        'note': (sample.get('note') or '') + (f"\n{body.note}" if body.note else ''),
    }})
    await log_audit(user, 'sample.receive', 'sample', sample_id, sample['sample_code'], {'weight_diff': weight_diff})
    diff_note = f" (diff {weight_diff:+.3f}g)" if weight_diff else ''
    await _notify_module('samples', 'Sample received back',
                          f"{sample['sample_code']} · {sample['description']} from {sample['karigar_name']}{diff_note}", '/samples', script='sample_received')
    return await db.samples.find_one({'id': sample_id}, {'_id': 0})


@router.put('/samples/{sample_id}/receive')
async def edit_sample_receive(sample_id: str, body: SampleReceiveIn, user=Depends(require_admin_or_module_right('samples', 'edit'))):
    """Corrects the most recent (and only) receive on this sample — same
    form as creating one, reused. Redoes this receive's whole ledger
    footprint from scratch against the corrected numbers, same as repairs.py's
    transaction edit, so it can't drift out of sync with a fresh receive."""
    sample = await db.samples.find_one({'id': sample_id}, {'_id': 0})
    if not sample:
        raise HTTPException(status_code=404, detail='Sample not found')
    if sample['status'] != 'received':
        raise HTTPException(status_code=400, detail='This sample has not been received back yet')
    if body.received_weight <= 0:
        raise HTTPException(status_code=400, detail='Received weight must be greater than 0')

    txn_id = sample.get('receive_txn_id') or str(uuid.uuid4())
    await delete_gold_ledger_entries({'txn_id': txn_id})
    iso = now_utc().isoformat()
    weight_diff = await _post_sample_receive_ledger(sample, body, txn_id, iso, user)
    await db.samples.update_one({'id': sample_id}, {'$set': {
        'received_weight': body.received_weight, 'weight_diff': weight_diff,
        'received_at': iso, 'received_by': user['name'], 'receive_txn_id': txn_id,
        'pay_weight': body.pay_weight or 0, 'recv_weight': body.recv_weight or 0,
        'write_off_loss': bool(body.write_off_loss) and weight_diff < 0,
        'note': body.note if body.note is not None else sample.get('note', ''),
    }})
    await log_audit(user, 'sample.receive_edit', 'sample', sample_id, sample['sample_code'], {'weight_diff': weight_diff})
    return await db.samples.find_one({'id': sample_id}, {'_id': 0})


@router.delete('/samples/{sample_id}/receive')
async def delete_sample_receive(sample_id: str, user=Depends(require_admin_or_module_right('samples', 'delete'))):
    """Undoes a receive — back to 'with karigar', with every ledger entry
    this receive posted (main credit + any on-the-spot settlement) removed."""
    sample = await db.samples.find_one({'id': sample_id}, {'_id': 0})
    if not sample:
        raise HTTPException(status_code=404, detail='Sample not found')
    if sample['status'] != 'received':
        raise HTTPException(status_code=400, detail='This sample has not been received back yet')

    txn_id = sample.get('receive_txn_id')
    if txn_id:
        await delete_gold_ledger_entries({'txn_id': txn_id})
    await db.samples.update_one({'id': sample_id}, {'$set': {
        'status': 'with_karigar', 'received_weight': None, 'weight_diff': None,
        'received_at': None, 'received_by': None, 'receive_txn_id': None,
        'pay_weight': 0, 'recv_weight': 0, 'write_off_loss': False,
    }})
    await log_audit(user, 'sample.receive_delete', 'sample', sample_id, sample['sample_code'])
    return await db.samples.find_one({'id': sample_id}, {'_id': 0})


@router.get('/samples/analytics')
async def samples_analytics(
    period: str = Query(..., pattern='^(day|week|month)$'),
    date_: str = Query(..., alias='date'),
    _: dict = Depends(require_owner),
):
    """Shop-wide Stock In/Out throughput for the selected day/week/month —
    how much gold went out and came back, by issue type and by karigar —
    same day/week/month period shape as Cash Book and Attendance analytics.
    Aggregated in Python rather than a Mongo pipeline, matching this
    module's existing style (loss-ledger, cash-ledger) at a shop's scale."""
    d = date.fromisoformat(date_)
    if period == 'day':
        start = end = d
    elif period == 'week':
        start = d - timedelta(days=d.weekday())
        end = start + timedelta(days=6)
    else:
        start = d.replace(day=1)
        end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    start_s, end_s = start.isoformat(), end.isoformat()
    end_next_s = (end + timedelta(days=1)).isoformat()

    issued = await db.samples.find(
        {'created_at': {'$gte': start_s, '$lt': end_next_s}},
        {'_id': 0, 'created_at': 1, 'issue_type': 1, 'weight': 1, 'karigar_name': 1},
    ).to_list(20000)
    received = await db.samples.find(
        {'received_at': {'$gte': start_s, '$lt': end_next_s}},
        {'_id': 0, 'received_at': 1, 'received_weight': 1},
    ).to_list(20000)

    by_type: dict = {}
    by_karigar: dict = {}
    by_date: dict = {}
    weight_issued = 0.0
    for s in issued:
        t = (s.get('issue_type') or '').strip() or 'Other'
        by_type[t] = by_type.get(t, 0) + 1
        weight_issued += float(s.get('weight') or 0)
        kn = s.get('karigar_name')
        if kn:
            by_karigar[kn] = by_karigar.get(kn, 0) + 1
        by_date.setdefault(s['created_at'][:10], {'issued': 0, 'received': 0})['issued'] += 1

    weight_received = 0.0
    for s in received:
        weight_received += float(s.get('received_weight') or 0)
        by_date.setdefault(s['received_at'][:10], {'issued': 0, 'received': 0})['received'] += 1

    return {
        'period': period, 'start_date': start_s, 'end_date': end_s,
        'total_issued': len(issued), 'total_received': len(received),
        'weight_issued': round(weight_issued, 3), 'weight_received': round(weight_received, 3),
        'by_type': sorted(
            [{'category': k, 'count': v} for k, v in by_type.items()], key=lambda x: -x['count'],
        ),
        'trend': [{'date': ds, **v} for ds, v in sorted(by_date.items())],
        'top_karigars': sorted(
            [{'name': k, 'count': v} for k, v in by_karigar.items()], key=lambda x: -x['count'],
        )[:5],
    }
