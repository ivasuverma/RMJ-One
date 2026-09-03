"""Repairs: customers, karigars, orders/items, billing, thermal printing

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import datetime, date, timezone
import uuid
import re
import asyncio
from server import (
    db,
    now_utc,
    today_str,
    IST,
    require_owner,
    require_module,
    require_staff_or_module,
    require_admin_or_module,
    require_admin_or_module_right,
    CustomerIn,
    KarigarIn,
    RepairTypeIn,
    ItemMasterIn,
    RepairOrderIn,
    RepairItemUpdateIn,
    IssueToKarigarIn,
    ReceiveFromKarigarIn,
    KarigarTransactionEditIn,
    DeliverIn,
    CloseDeliveryIn,
    KarigarLedgerEntryIn,
    _karigar_ledger_balances,
    log_audit,
    notify_user,
    _notify_module,
    _pdf_response,
    send_whatsapp,
)

router = APIRouter()


async def _mirror_party_account(kind: str, ref: str, name: str, phone: str) -> None:
    """Create a unified-ledger account mirroring a newly-created customer or
    karigar, so every party shows up in the Ledger (type-filtered) the moment
    it's created — not only after the one-time migration. Idempotent on
    (source.kind, source.ref): a party already mirrored is skipped, so this is
    safe to call on every create. Best-effort — a mirror failure must never
    block the actual customer/karigar creation, so callers wrap in try/except.
    Balances still live in the party's own ledger for now; this brings the
    account's identity into the unified list."""
    if await db.accounts.find_one({'source.kind': kind, 'source.ref': ref}, {'_id': 0, 'id': 1}):
        return
    # Resolve the account type by its key ('customer'/'karigar'); fall back to a
    # case-insensitive name match so a shop whose seeded types lost their 'key'
    # still mirrors correctly instead of silently doing nothing.
    t = await db.account_types.find_one({'key': kind}, {'_id': 0, 'id': 1})
    if not t:
        t = await db.account_types.find_one({'name': {'$regex': f'^{re.escape(kind)}$', '$options': 'i'}}, {'_id': 0, 'id': 1})
    if not t:
        return
    await db.accounts.insert_one({
        'id': str(uuid.uuid4()), 'type_id': t['id'], 'name': (name or '').strip(),
        'phone': (phone or '').strip(), 'opening_fine': 0, 'opening_amount': 0,
        'note': '', 'active': True, 'created_at': now_utc().isoformat(), 'created_by': 'auto',
        'source': {'kind': kind, 'ref': ref},
    })

# ---------------- Repairs: Customers ----------------
@router.get('/customers')
async def list_customers(
    q: Optional[str] = None, cursor: Optional[str] = None, limit: Optional[int] = None,
    _: dict = Depends(require_staff_or_module(['repairs', 'customer_ledger'])),
):
    """Pagination is opt-in: callers that never pass `limit` (the intake/
    search pickers in work.tsx, repairs/new.tsx, dashboard search — they
    want the full set for instant client-side matching or, for work.tsx,
    to sum open_items/open_weight across every customer) get back exactly
    what they always did — a bare array, unpaginated. Only a caller that
    passes `limit` (customers/index.tsx, the real browsing list) gets the
    new {items, next_cursor} shape.

    The cursor is an offset (not a keyset on `name`) because customer names
    aren't unique — a $gt cursor on a duplicate name would silently skip
    the tied customer. Safe here since the whole matching set is already
    materialized in memory below regardless (to compute balances), so
    slicing it in Python costs nothing extra."""
    query: dict = {'active': {'$ne': False}}  # hide customers deactivated via the ledger
    if q:
        q_esc = re.escape(q)
        query['$or'] = [
            {'name': {'$regex': q_esc, '$options': 'i'}},
            {'mobile': {'$regex': q_esc, '$options': 'i'}},
        ]
    customers = await db.customers.find(query, {'_id': 0}).sort('name', 1).to_list(1000)
    # Attach a quick "balance" glance: how many items and how much gold weight
    # of this customer's are still sitting with the shop (not yet delivered).
    orders = await db.repair_orders.find({}, {'_id': 0, 'id': 1, 'customer_id': 1}).to_list(10000)
    order_to_customer = {o['id']: o['customer_id'] for o in orders}
    open_items = await db.repair_items.find({'status': {'$ne': 'delivered'}}, {'_id': 0, 'order_id': 1, 'gross_weight': 1}).to_list(10000)
    balances: dict = {}
    for it in open_items:
        cid = order_to_customer.get(it.get('order_id'))
        if not cid: continue
        b = balances.setdefault(cid, {'open_items': 0, 'open_weight': 0.0})
        b['open_items'] += 1
        b['open_weight'] += it.get('gross_weight') or 0
    for c in customers:
        b = balances.get(c['id'], {'open_items': 0, 'open_weight': 0.0})
        c['open_items'] = b['open_items']
        c['open_weight'] = round(b['open_weight'], 3)
    if limit is None:
        return customers
    page_limit = min(max(1, limit), 200)
    offset = 0
    if cursor:
        try: offset = max(0, int(cursor))
        except ValueError: offset = 0
    page = customers[offset:offset + page_limit]
    next_cursor = str(offset + page_limit) if offset + page_limit < len(customers) else None
    return {'items': page, 'next_cursor': next_cursor}


@router.get('/customers/{cid}')
async def get_customer(cid: str, _: dict = Depends(require_staff_or_module(['repairs', 'customer_ledger']))):
    c = await db.customers.find_one({'id': cid}, {'_id': 0})
    if not c: raise HTTPException(status_code=404, detail='Customer not found')
    orders = await db.repair_orders.find({'customer_id': cid}, {'_id': 0}).sort('created_at', -1).to_list(200)
    out = []
    for o in orders:
        items = await db.repair_items.find({'order_id': o['id']}, {'_id': 0}).to_list(200)
        # Skip orders whose only item(s) were since deleted (e.g. an unissued tag
        # removed by mistake) — nothing left to show, so don't leave a dangling row.
        if not items:
            continue
        out.append({**o, 'item_count': len(items), 'status': _order_status(items)})
    return {'customer': c, 'orders': out}


@router.post('/customers')
async def create_customer(body: CustomerIn, user=Depends(require_admin_or_module(['repairs', 'customer_ledger']))):
    if len(re.sub(r'\D', '', body.mobile or '')) < 7:
        raise HTTPException(status_code=400, detail='A mobile number is required')
    doc = {'id': str(uuid.uuid4()), **body.model_dump(), 'created_at': now_utc().isoformat()}
    await db.customers.insert_one(dict(doc))
    try: await _mirror_party_account('customer', doc['id'], body.name, body.mobile)
    except Exception: pass
    await log_audit(user, 'customer.create', 'customer', doc['id'], body.name)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.put('/customers/{cid}')
async def update_customer(cid: str, body: CustomerIn, user=Depends(require_admin_or_module_right('customer_ledger', 'edit'))):
    if not await db.customers.find_one({'id': cid}):
        raise HTTPException(status_code=404, detail='Customer not found')
    await db.customers.update_one({'id': cid}, {'$set': body.model_dump()})
    await log_audit(user, 'customer.update', 'customer', cid, body.name)
    return await db.customers.find_one({'id': cid}, {'_id': 0})


@router.delete('/customers/{cid}')
async def delete_customer(cid: str, user=Depends(require_owner), _mod=Depends(require_module('repairs'))):
    c = await db.customers.find_one({'id': cid}, {'_id': 0})
    if not c: raise HTTPException(status_code=404, detail='Customer not found')
    if await db.repair_orders.count_documents({'customer_id': cid}) > 0:
        raise HTTPException(status_code=400, detail='This customer has repair history — their ledger is not empty')
    await db.customers.delete_one({'id': cid})
    await log_audit(user, 'customer.delete', 'customer', cid, (c or {}).get('name', ''))
    return {'ok': True}


# ---------------- Repairs: Karigars ----------------

@router.get('/karigars')
async def list_karigars(
    q: Optional[str] = None, cursor: Optional[str] = None, limit: Optional[int] = None,
    _: dict = Depends(require_staff_or_module(['repairs', 'karigar_ledger'])),
):
    """Pagination is opt-in — see GET /customers's docstring for why (same
    pattern: pickers that never pass `limit` keep getting a bare array,
    karigars/index.tsx's real browsing list passes `limit` and gets
    {items, next_cursor}, offset-based since names aren't unique)."""
    query: dict = {'active': {'$ne': False}}  # hide karigars deactivated via the ledger
    if q:
        # Mirror the customer search: escape regex specials, match name/mobile
        # case-insensitively (used by the dashboard global search).
        q_esc = re.escape(q)
        query['$or'] = [
            {'name': {'$regex': q_esc, '$options': 'i'}},
            {'mobile': {'$regex': q_esc, '$options': 'i'}},
        ]
    karigars = await db.karigars.find(query, {'_id': 0}).sort('name', 1).to_list(500)
    entries = await db.karigar_ledger.find({}, {'_id': 0, 'karigar_id': 1, 'type': 1, 'weight': 1, 'fine_weight': 1, 'amount': 1}).to_list(20000)
    bal = _karigar_ledger_balances(entries)
    for k in karigars:
        b = bal.get(k['id'], {})
        k['weight_balance'] = round(b.get('weight_bal', 0), 3)
        k['fine_weight_balance'] = round(b.get('fine_bal', 0), 3)
        k['amount_due'] = round(b.get('amt_due', 0), 2)
    if limit is None:
        return karigars
    page_limit = min(max(1, limit), 200)
    offset = 0
    if cursor:
        try: offset = max(0, int(cursor))
        except ValueError: offset = 0
    page = karigars[offset:offset + page_limit]
    next_cursor = str(offset + page_limit) if offset + page_limit < len(karigars) else None
    return {'items': page, 'next_cursor': next_cursor}


@router.post('/karigars')
async def create_karigar(body: KarigarIn, user=Depends(require_admin_or_module(['repairs', 'karigar_ledger']))):
    name = body.name
    if body.is_employee:
        if not body.employee_id:
            raise HTTPException(status_code=400, detail='employee_id is required for an in-house karigar')
        emp = await db.employees.find_one({'id': body.employee_id}, {'_id': 0})
        if not emp: raise HTTPException(status_code=404, detail='Employee not found')
        name = emp['name']
    elif len(re.sub(r'\D', '', body.mobile or '')) < 7:
        # Outside karigars need a mobile number (in-house ones are employees).
        raise HTTPException(status_code=400, detail='A mobile number is required')
    doc = {'id': str(uuid.uuid4()), **{**body.model_dump(), 'name': name}, 'created_at': now_utc().isoformat()}
    await db.karigars.insert_one(dict(doc))
    try: await _mirror_party_account('karigar', doc['id'], name, body.mobile)
    except Exception: pass
    await log_audit(user, 'karigar.create', 'karigar', doc['id'], name)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.put('/karigars/{kid}')
async def update_karigar(kid: str, body: KarigarIn, user=Depends(require_admin_or_module_right('karigar_ledger', 'edit'))):
    if not await db.karigars.find_one({'id': kid}):
        raise HTTPException(status_code=404, detail='Karigar not found')
    await db.karigars.update_one({'id': kid}, {'$set': body.model_dump()})
    await log_audit(user, 'karigar.update', 'karigar', kid, body.name)
    return await db.karigars.find_one({'id': kid}, {'_id': 0})


@router.delete('/karigars/{kid}')
async def delete_karigar(kid: str, user=Depends(require_owner), _mod=Depends(require_module('repairs'))):
    k = await db.karigars.find_one({'id': kid}, {'_id': 0})
    if not k: raise HTTPException(status_code=404, detail='Karigar not found')
    if await db.karigar_ledger.count_documents({'karigar_id': kid}) > 0:
        raise HTTPException(status_code=400, detail='This karigar has ledger entries — clear/settle their ledger before deleting')
    await db.karigars.delete_one({'id': kid})
    await log_audit(user, 'karigar.delete', 'karigar', kid, (k or {}).get('name', ''))
    return {'ok': True}


# ---------------- Repairs: Repair Types (master) ----------------
@router.get('/repair-types')
async def list_repair_types(_: dict = Depends(require_staff_or_module('repairs'))):
    return await db.repair_types.find({}, {'_id': 0}).sort('name', 1).to_list(200)


@router.post('/repair-types')
async def create_repair_type(body: RepairTypeIn, user=Depends(require_owner), _mod=Depends(require_module('repairs'))):
    doc = {'id': str(uuid.uuid4()), **body.model_dump(), 'created_at': now_utc().isoformat()}
    await db.repair_types.insert_one(dict(doc))
    await log_audit(user, 'repair_type.create', 'repair_type', doc['id'], body.name)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.put('/repair-types/{rtid}')
async def update_repair_type(rtid: str, body: RepairTypeIn, user=Depends(require_owner), _mod=Depends(require_module('repairs'))):
    if not await db.repair_types.find_one({'id': rtid}):
        raise HTTPException(status_code=404, detail='Repair type not found')
    await db.repair_types.update_one({'id': rtid}, {'$set': body.model_dump()})
    await log_audit(user, 'repair_type.update', 'repair_type', rtid, body.name)
    return await db.repair_types.find_one({'id': rtid}, {'_id': 0})


@router.delete('/repair-types/{rtid}')
async def delete_repair_type(rtid: str, user=Depends(require_owner), _mod=Depends(require_module('repairs'))):
    rt = await db.repair_types.find_one({'id': rtid}, {'_id': 0})
    r = await db.repair_types.delete_one({'id': rtid})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail='Repair type not found')
    await log_audit(user, 'repair_type.delete', 'repair_type', rtid, (rt or {}).get('name', ''))
    return {'ok': True}


# ---------------- Repairs: Items Master (name + purity) ----------------
@router.get('/item-master')
async def list_item_master(_: dict = Depends(require_staff_or_module('repairs'))):
    return await db.item_master.find({}, {'_id': 0}).sort('name', 1).to_list(500)


@router.post('/item-master')
async def create_item_master(body: ItemMasterIn, user=Depends(require_owner), _mod=Depends(require_module('repairs'))):
    doc = {'id': str(uuid.uuid4()), **body.model_dump(), 'created_at': now_utc().isoformat()}
    await db.item_master.insert_one(dict(doc))
    await log_audit(user, 'item_master.create', 'item_master', doc['id'], body.name)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.put('/item-master/{iid}')
async def update_item_master(iid: str, body: ItemMasterIn, user=Depends(require_owner), _mod=Depends(require_module('repairs'))):
    if not await db.item_master.find_one({'id': iid}):
        raise HTTPException(status_code=404, detail='Item not found')
    await db.item_master.update_one({'id': iid}, {'$set': body.model_dump()})
    await log_audit(user, 'item_master.update', 'item_master', iid, body.name)
    return await db.item_master.find_one({'id': iid}, {'_id': 0})


@router.delete('/item-master/{iid}')
async def delete_item_master(iid: str, user=Depends(require_owner), _mod=Depends(require_module('repairs'))):
    it = await db.item_master.find_one({'id': iid}, {'_id': 0})
    r = await db.item_master.delete_one({'id': iid})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail='Item not found')
    await log_audit(user, 'item_master.delete', 'item_master', iid, (it or {}).get('name', ''))
    return {'ok': True}


# ---------------- Repairs: Orders & Items ----------------
async def _next_order_no() -> str:
    count = await db.repair_orders.count_documents({})
    return f'RO-{count + 1:04d}'


async def _next_item_code() -> str:
    count = await db.repair_items.count_documents({})
    return f'R-{count + 1:06d}'


def _order_status(items: list) -> str:
    return 'completed' if items and all(i['status'] == 'delivered' for i in items) else 'open'


@router.post('/repair-orders')
async def create_repair_order(body: RepairOrderIn, user=Depends(require_admin_or_module('repairs'))):
    if not body.items:
        raise HTTPException(status_code=400, detail='At least one item is required')
    customer = None
    if body.customer_id:
        customer = await db.customers.find_one({'id': body.customer_id}, {'_id': 0})
        if not customer: raise HTTPException(status_code=404, detail='Customer not found')
    elif body.new_customer:
        if len(re.sub(r'\D', '', body.new_customer.mobile or '')) < 7:
            raise HTTPException(status_code=400, detail='A mobile number is required for a new customer')
        customer = {'id': str(uuid.uuid4()), **body.new_customer.model_dump(), 'created_at': now_utc().isoformat()}
        await db.customers.insert_one(dict(customer))
        try: await _mirror_party_account('customer', customer['id'], customer.get('name', ''), customer.get('mobile', ''))
        except Exception: pass
        await log_audit(user, 'customer.create', 'customer', customer['id'], customer['name'])
    else:
        raise HTTPException(status_code=400, detail='customer_id or new_customer is required')

    iso = now_utc().isoformat()
    order_id = str(uuid.uuid4())
    order_no = await _next_order_no()
    order = {
        'id': order_id, 'order_no': order_no, 'customer_id': customer['id'], 'customer_name': customer['name'],
        'customer_mobile': customer.get('mobile', ''), 'created_at': iso,
        'created_by': user['name'], 'created_by_id': user['id'],
    }
    await db.repair_orders.insert_one(dict(order))

    items_out = []
    for spec in body.items:
        item_code = await _next_item_code()
        item_master = None
        if spec.item_master_id:
            item_master = await db.item_master.find_one({'id': spec.item_master_id}, {'_id': 0})
        purity = item_master['purity'] if item_master else 100.0
        item = {
            'id': str(uuid.uuid4()), 'item_code': item_code, 'order_id': order_id,
            'order_no': order_no, 'customer_name': customer['name'],
            'item_master_id': spec.item_master_id, 'item_type_name': (item_master or {}).get('name', ''),
            'purity': purity,
            'description': spec.description, 'repair_type': spec.repair_type or '',
            'gross_weight': spec.gross_weight, 'fine_weight': round(spec.gross_weight * purity / 100, 3),
            'pc_count': spec.pc_count,
            'labour_charge': spec.labour_charge, 'needs_karigar': spec.needs_karigar,
            'due_date': spec.due_date, 'stone_notes': spec.stone_notes or '', 'notes': spec.notes or '',
            'intake_photo': spec.intake_photo or '', 'final_photo': '',
            'status': 'received', 'karigar_id': None, 'karigar_name': None,
            'current_issue_weight': None, 'billed_amount': None, 'payment_mode': None,
            'created_at': iso, 'created_by': user['name'], 'created_by_id': user['id'],
            'updated_by': user['name'], 'delivered_at': None,
            'delivered_by': None, 'delivered_by_id': None,
            'issued_by': None, 'issued_by_id': None,
        }
        await db.repair_items.insert_one(dict(item))
        items_out.append({k: v for k, v in item.items() if k != '_id'})

    await log_audit(user, 'repair_order.create', 'repair_order', order_id, order_no,
                     {'customer': customer['name'], 'items': len(items_out)})
    await _notify_module('repairs', f'New repair order #{order_no}',
                          f"{customer['name']} · {len(items_out)} item(s) · by {user['name']}", '/repairs', script='repair_new_order')
    return {'order': {k: v for k, v in order.items() if k != '_id'}, 'items': items_out}


@router.get('/repair-orders')
async def list_repair_orders(status_: Optional[str] = Query(default=None, alias='status'), _: dict = Depends(require_staff_or_module('repairs'))):
    orders = await db.repair_orders.find({}, {'_id': 0}).sort('created_at', -1).to_list(1000)
    out = []
    for o in orders:
        items = await db.repair_items.find({'order_id': o['id']}, {'_id': 0}).to_list(200)
        if not items:
            continue
        st = _order_status(items)
        if status_ and st != status_:
            continue
        out.append({**o, 'item_count': len(items), 'status': st})
    return out


@router.get('/repair-orders/{order_id}')
async def get_repair_order(order_id: str, _: dict = Depends(require_staff_or_module('repairs'))):
    order = await db.repair_orders.find_one({'id': order_id}, {'_id': 0})
    if not order: raise HTTPException(status_code=404, detail='Order not found')
    items = await db.repair_items.find({'order_id': order_id}, {'_id': 0}).sort('created_at', 1).to_list(200)
    return {'order': {**order, 'status': _order_status(items)}, 'items': items}


@router.get('/repair-orders/{order_id}/slip/pdf')
async def repair_order_slip_pdf(order_id: str, _: dict = Depends(require_staff_or_module('repairs'))):
    order = await db.repair_orders.find_one({'id': order_id}, {'_id': 0})
    if not order: raise HTTPException(status_code=404, detail='Order not found')
    items = await db.repair_items.find({'order_id': order_id}, {'_id': 0}).sort('created_at', 1).to_list(200)
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    # Same narrow label-style layout as the issue-slip PDF and every thermal
    # print, instead of the old wide A4 report table — one look across every
    # Repair/Stock In-Out printout, matching what actually comes out of the
    # receipt printer.
    pdf = _thermal_slip_pdf(
        store.get('name') or 'Ram Murti Jewellers', f"Repair Intake — {order['order_no']}",
        _intake_receipt_lines(order, items),
    )
    return _pdf_response(pdf, f'repair-slip-{order["order_no"]}.pdf')


def _intake_receipt_lines(order: dict, items: list) -> list:
    """Customer-facing repair intake receipt — one or more items per order,
    each rendered as its own labeled block on the narrow thermal format."""
    lines = [
        ('Order No', order['order_no']),
        ('Customer', order['customer_name']),
        ('Mobile', order.get('customer_mobile') or '—'),
        ('Received', _dmy(order['created_at'][:10])),
    ]
    for idx, item in enumerate(items, 1):
        lines.append(f'Item {idx}' if len(items) > 1 else 'Item')
        lines.append(('Tag', item['item_code']))
        lines.append(('Description', item['description']))
        lines.append(('Repair Type', item['repair_type'] or '—'))
        lines.append(('Weight', f"{item['gross_weight']:.3f}g"))
        lines.append(('Pcs', str(item['pc_count'])))
        lines.append(('Due Date', _dmy(item['due_date'])))
    lines.append('')
    lines.append('Customer Signature: _____________________')
    return lines


@router.post('/repair-orders/{order_id}/slip/print')
async def repair_order_slip_print(order_id: str, user: dict = Depends(require_staff_or_module('repairs'))):
    """Sends the customer repair intake receipt straight to the configured
    WiFi thermal printer instead of generating a PDF."""
    order = await db.repair_orders.find_one({'id': order_id}, {'_id': 0})
    if not order: raise HTTPException(status_code=404, detail='Order not found')
    items = await db.repair_items.find({'order_id': order_id}, {'_id': 0}).sort('created_at', 1).to_list(200)
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    data = _escpos_receipt(store.get('name') or 'Ram Murti Jewellers',
                            f"Repair Intake — {order['order_no']}", _intake_receipt_lines(order, items))
    await _print_escpos(data)
    await log_audit(user, 'repair_order.slip_print', 'repair_order', order_id, order['order_no'], {})
    return {'ok': True}


def _item_tag_lines(order: dict, item: dict) -> list:
    """A small tag meant to be torn off and physically attached to the item
    itself — just enough to identify it (no customer signature line, unlike
    the full intake receipt)."""
    return [
        ('Tag', item['item_code']),
        ('Customer', order['customer_name']),
        ('Item', item['description']),
        ('Repair Type', item['repair_type'] or '—'),
        ('Weight', f"{item['gross_weight']:.3f}g"),
        ('Pcs', str(item['pc_count'])),
        ('Due Date', _dmy(item['due_date'])),
    ]


@router.get('/repair-orders/{order_id}/tags/pdf')
async def repair_order_tags_pdf(order_id: str, _: dict = Depends(require_staff_or_module('repairs'))):
    """One small tag per item in the order, meant to be attached to the
    physical piece — separate from the customer-facing intake receipt above."""
    order = await db.repair_orders.find_one({'id': order_id}, {'_id': 0})
    if not order: raise HTTPException(status_code=404, detail='Order not found')
    items = await db.repair_items.find({'order_id': order_id}, {'_id': 0}).sort('created_at', 1).to_list(200)
    if not items: raise HTTPException(status_code=404, detail='This order has no items')
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    pdf = _thermal_tags_pdf(store.get('name') or 'Ram Murti Jewellers', order, items)
    return _pdf_response(pdf, f'item-tags-{order["order_no"]}.pdf')


@router.post('/repair-orders/{order_id}/tags/print')
async def repair_order_tags_print(order_id: str, user: dict = Depends(require_staff_or_module('repairs'))):
    """Sends one tag per item straight to the WiFi thermal printer, one after
    another (the printer's auto-cutter separates them)."""
    order = await db.repair_orders.find_one({'id': order_id}, {'_id': 0})
    if not order: raise HTTPException(status_code=404, detail='Order not found')
    items = await db.repair_items.find({'order_id': order_id}, {'_id': 0}).sort('created_at', 1).to_list(200)
    if not items: raise HTTPException(status_code=404, detail='This order has no items')
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    shop_name = store.get('name') or 'Ram Murti Jewellers'
    for item in items:
        data = _escpos_receipt(shop_name, f"Item Tag — {item['item_code']}", _item_tag_lines(order, item))
        await _print_escpos(data)
    await log_audit(user, 'repair_order.tags_print', 'repair_order', order_id, order['order_no'], {'items': len(items)})
    return {'ok': True}


@router.get('/repair-items')
async def list_repair_items(
    status_: Optional[str] = Query(default=None, alias='status'),
    q: Optional[str] = None,
    from_date: Optional[str] = None,
    _: dict = Depends(require_staff_or_module(['repairs'])),
):
    query: dict = {}
    if from_date and not q:
        # Only the Repair Bill screen's "All" filter (spanning delivered
        # history) uses this, and only when it isn't also searching — a
        # search should still be able to find an old item by code/customer,
        # date-bounding would defeat the point. Bounds what used to be a
        # fully unbounded fetch of every delivered item ever billed.
        query['created_at'] = {'$gte': from_date}
    if status_ == 'overdue':
        today = today_str()
        query['due_date'] = {'$ne': None, '$lt': today}
        # Overdue only makes sense while a tag is still actively being
        # worked (received or with a karigar) — once it's billed, being
        # "overdue" no longer describes anything actionable.
        query['status'] = {'$nin': ['delivered', 'pending_delivery']}
    elif status_ and status_ != 'all':
        # A comma-separated list (e.g. the Repair Bill tab's "All" filter,
        # which spans ready/pending_delivery/delivered) matches any of them.
        if ',' in status_:
            query['status'] = {'$in': [s.strip() for s in status_.split(',') if s.strip()]}
        else:
            query['status'] = status_
    elif not q and status_ != 'all':
        # Default view (no filters at all) is the outstanding worklist.
        query['status'] = {'$ne': 'delivered'}
    if q:
        q_esc = re.escape(q)
        query['$or'] = [
            {'item_code': {'$regex': q_esc, '$options': 'i'}},
            {'description': {'$regex': q_esc, '$options': 'i'}},
            {'customer_name': {'$regex': q_esc, '$options': 'i'}},
        ]
    # intake_photo/final_photo are base64 JPEGs (~50-150KB each) — no list
    # row ever renders them (only the item detail page and the "reopen a
    # delivered bill" edit form do, both of which fetch the single item
    # fresh via GET /repair-items/{id}). Stripping them here is the biggest
    # single cut to this endpoint's payload size, since it's re-fetched on
    # nearly every Repair screen focus.
    return await db.repair_items.find(query, {'_id': 0, 'intake_photo': 0, 'final_photo': 0}).sort('created_at', -1).to_list(1000)


@router.get('/repairs/dashboard')
async def repairs_dashboard(_: dict = Depends(require_staff_or_module(['repairs']))):
    """Compact repair-pipeline stats for the employee Transactions screen —
    same status buckets the list/bill screens filter by, so each tile can
    deep-link straight into a matching pre-filtered list. Anyone holding
    the repairs right can see this — creating, tracking and billing a
    repair are one module now."""
    today = today_str()
    items = await db.repair_items.find(
        {'status': {'$ne': 'delivered'}}, {'_id': 0, 'status': 1, 'due_date': 1},
    ).to_list(5000)
    received = sum(1 for i in items if i['status'] == 'received')
    with_karigar = sum(1 for i in items if i['status'] == 'with_karigar')
    ready = sum(1 for i in items if i['status'] == 'ready')
    pending_delivery = sum(1 for i in items if i['status'] == 'pending_delivery')
    # Same "overdue" definition as the list endpoint's own overdue filter —
    # a tag can only be overdue while still actively being worked.
    overdue = sum(1 for i in items if i.get('due_date') and i['due_date'] < today and i['status'] not in ('pending_delivery',))
    delivered_today = await db.repair_items.count_documents({'status': 'delivered', 'delivered_at': {'$regex': f'^{today}'}})
    return {
        'received': received, 'with_karigar': with_karigar, 'ready': ready,
        'pending_delivery': pending_delivery, 'overdue': overdue, 'delivered_today': delivered_today,
    }


@router.get('/repair-items/{item_id}')
async def get_repair_item(item_id: str, _: dict = Depends(require_staff_or_module(['repairs']))):
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    history = await db.karigar_transactions.find({'item_id': item_id}, {'_id': 0}).sort('created_at', 1).to_list(100)
    return {'item': item, 'history': history}


@router.put('/repair-items/{item_id}')
async def update_repair_item(item_id: str, body: RepairItemUpdateIn, user=Depends(require_admin_or_module_right('repairs', 'edit'))):
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    # Once a tag has been issued to a karigar, its weight is what the karigar
    # ledger's gold_out entry was locked to at issue time — changing it here
    # afterward would silently desync the tag from its own ledger history.
    if 'gross_weight' in upd and item['status'] != 'received':
        raise HTTPException(status_code=400, detail='Weight is locked once a tag has been issued — it must match what was recorded when issued to keep the karigar ledger accurate')
    if 'gross_weight' in upd:
        purity = item.get('purity') or 100.0
        upd['fine_weight'] = round(upd['gross_weight'] * purity / 100, 3)
    # Labour charge is frozen into bill_labour_charge at billing time, so
    # editing the live field afterward would just be confusing, not harmful —
    # block it anyway so the displayed value can't drift from what was billed.
    if 'labour_charge' in upd and item['status'] in ('pending_delivery', 'delivered'):
        raise HTTPException(status_code=400, detail='This tag has already been billed — labour charge is locked. Delete the bill first if it needs correcting.')
    if upd:
        await db.repair_items.update_one({'id': item_id}, {'$set': upd})
        await log_audit(user, 'repair_item.update', 'repair_item', item_id, item['item_code'])
    return await db.repair_items.find_one({'id': item_id}, {'_id': 0})


@router.delete('/repair-items/{item_id}')
async def delete_repair_item(item_id: str, user=Depends(require_admin_or_module_right('repairs', 'delete'))):
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    if item['status'] != 'received':
        raise HTTPException(status_code=400, detail='Only an item that has not been issued yet can be deleted — receive it back first if it is with a karigar')
    await db.repair_items.delete_one({'id': item_id})
    await log_audit(user, 'repair_item.delete', 'repair_item', item_id, item['item_code'])
    return {'ok': True}


@router.post('/repair-items/{item_id}/issue')
async def issue_to_karigar(item_id: str, body: IssueToKarigarIn, user=Depends(require_admin_or_module('repairs'))):
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    # Once an item has completed a karigar cycle (received back), it cannot be
    # reissued — only a freshly received item (never yet sent out) can be issued.
    if item['status'] != 'received':
        raise HTTPException(status_code=400, detail=f"Cannot issue an item that is {item['status']}")

    if not body.karigar_id:
        # No karigar picked — this tag doesn't need one (in-house work, or
        # nothing further to do). Skip straight to Pending to Bill, same
        # effect the old standalone "Mark Ready" action had.
        await db.repair_items.update_one({'id': item_id}, {'$set': {'status': 'ready', 'updated_by': user['name']}})
        await log_audit(user, 'repair_item.ready', 'repair_item', item_id, item['item_code'], {'skipped_karigar': True})
        await _notify_module('repairs', 'Repair item ready',
                              f"{item['item_code']} ({item.get('customer_name', '')}) is ready for delivery", '/repairs', script='repair_item_ready')
        return await db.repair_items.find_one({'id': item_id}, {'_id': 0})

    karigar = await db.karigars.find_one({'id': body.karigar_id}, {'_id': 0})
    if not karigar: raise HTTPException(status_code=404, detail='Karigar not found')

    # Weight issued always equals the tag's own gross weight — the whole piece
    # goes out, so this is never a manual entry.
    weight = item.get('gross_weight') or 0
    purity = item.get('purity') or 100.0
    fine_weight = round(weight * purity / 100, 3)
    iso = now_utc().isoformat()
    txn_id = str(uuid.uuid4())
    challan_no = f"IC-{item['item_code']}-{await db.karigar_transactions.count_documents({'item_id': item_id, 'direction': 'issue'}) + 1}"
    txn = {
        'id': txn_id, 'item_id': item_id, 'item_code': item['item_code'], 'karigar_id': karigar['id'],
        'karigar_name': karigar['name'], 'direction': 'issue', 'weight': weight, 'fine_weight': fine_weight,
        'note': body.note or '', 'challan_no': challan_no, 'created_at': iso, 'created_by': user['name'],
    }
    await db.karigar_transactions.insert_one(dict(txn))
    await db.karigar_ledger.insert_one({
        'id': str(uuid.uuid4()), 'karigar_id': karigar['id'], 'type': 'gold_out', 'weight': weight,
        'fine_weight': fine_weight, 'amount': None, 'item_id': item_id, 'item_code': item['item_code'],
        'txn_id': txn_id, 'note': f"Issued: {item['description']}",
        'created_at': iso, 'created_by': user['name'],
    })
    await db.repair_items.update_one({'id': item_id}, {'$set': {
        'status': 'with_karigar', 'karigar_id': karigar['id'], 'karigar_name': karigar['name'],
        'current_issue_weight': weight, 'current_issue_fine_weight': fine_weight, 'updated_by': user['name'],
        'issued_by': user['name'], 'issued_by_id': user['id'],
    }})
    await log_audit(user, 'repair_item.issue', 'repair_item', item_id, item['item_code'], {'karigar': karigar['name'], 'weight': weight})
    if karigar.get('is_employee') and karigar.get('employee_id'):
        await notify_user(karigar['employee_id'], 'Repair item issued to you', f"{item['item_code']} — {item['description']}", '/(emp)/tasks')
    return await db.repair_items.find_one({'id': item_id}, {'_id': 0})


def _compute_receive(item: dict, body) -> dict:
    """Pure math shared by creating a receive and editing one, so the two paths
    can't drift apart the way they did before.

    new_wt = issued - loss - received   (positive = weight decreased, i.e. shortfall)
    karigar_gap = new_wt + wastage
    balance (fine g) = karigar_gap x touch%

    Loss is forgiven back in (inherent to the work, not the karigar's fault).
    Wastage is NOT forgiven — it's the karigar's own charge for doing the
    repair, on top of the gap, so it adds to what they still owe rather than
    reducing it. The single ledger entry posted for this receive is sized so
    the ledger-derived balance lands on balance_fine_weight exactly, whatever
    purity was used at issue vs. now.
    """
    purity = item.get('purity') or 100.0
    weight_issued = item.get('current_issue_weight') or 0
    fine_issued = item.get('current_issue_fine_weight') or round(weight_issued * purity / 100, 3)
    process_loss = body.process_loss or 0
    wastage_weight = body.wastage_weight or 0
    # Touch of the metal coming back this time — may differ from what was
    # issued at (mixed lots, karigar's own stated assay), so it's editable.
    recv_purity = body.purity_override if body.purity_override else purity
    diff = round(body.weight - weight_issued, 3)  # receive vs issue, gross — the "weight diff" shown around the app
    new_wt = round(weight_issued - process_loss - body.weight, 3)
    karigar_gap = round(new_wt + wastage_weight, 3)
    balance_fine_weight = round(karigar_gap * recv_purity / 100, 3)
    entry_fine_weight = round(fine_issued - balance_fine_weight, 3)
    # Gross-weight equivalent of that same credit, for the running gross-weight
    # ("gold with karigar") balance — loss is added back in (forgiven),
    # wastage is not (it's on top of what's still owed).
    weight_net = round(body.weight + process_loss - wastage_weight, 3)
    fine_diff = round(entry_fine_weight - fine_issued, 3)
    return {
        'purity': purity, 'weight_issued': weight_issued, 'fine_issued': fine_issued,
        'process_loss': process_loss, 'wastage_weight': wastage_weight, 'recv_purity': recv_purity,
        'diff': diff, 'karigar_gap': karigar_gap, 'balance_fine_weight': balance_fine_weight,
        'entry_fine_weight': entry_fine_weight, 'weight_net': weight_net, 'fine_diff': fine_diff,
    }


async def _post_receive_ledger(karigar_id: str, item: dict, calc: dict, body, txn_id: str, iso: str, user: dict):
    """Writes every karigar_ledger entry for one receive event: the single
    'received back' credit (loss forgiveness and wastage are already baked
    into its fine_weight via _compute_receive) plus whatever on-the-spot
    settlement staff entered. Shared by create and edit — edit deletes the
    old entries for this txn first, then calls this to repost fresh ones.
    """
    loss_note = f", loss {calc['process_loss']:.3f}g" if calc['process_loss'] else ''
    wastage_note = f", wastage {calc['wastage_weight']:.3f}g" if calc['wastage_weight'] else ''
    await db.karigar_ledger.insert_one({
        'id': str(uuid.uuid4()), 'karigar_id': karigar_id, 'type': 'gold_in', 'weight': calc['weight_net'],
        'fine_weight': calc['entry_fine_weight'], 'amount': None, 'item_id': item['id'], 'item_code': item['item_code'],
        'txn_id': txn_id, 'slip_photo': body.slip_photo or '',
        'note': f"Received back: {item['description']} (diff {calc['diff']:+.3f}g / fine {calc['fine_diff']:+.3f}g{loss_note}{wastage_note})",
        'created_at': iso, 'created_by': user['name'],
    })
    # A dedicated, non-balance-affecting record of the declared process loss on
    # this job — already folded into the credit above, so it doesn't touch
    # weight_bal/fine_bal (the aggregator only recognizes gold_out/gold_in/
    # labour_payable/payment/receipt/wastage/adjustment). This is purely so
    # loss can be audited on its own — which karigars are declaring how much,
    # on which jobs, over time — via the Loss Ledger report.
    if calc['process_loss']:
        fine_loss = round(calc['process_loss'] * calc['recv_purity'] / 100, 3)
        await db.karigar_ledger.insert_one({
            'id': str(uuid.uuid4()), 'karigar_id': karigar_id, 'type': 'loss', 'weight': calc['process_loss'],
            'fine_weight': fine_loss, 'amount': None, 'item_id': item['id'], 'item_code': item['item_code'],
            'txn_id': txn_id, 'note': f"Process loss declared: {item['description']}",
            'created_at': iso, 'created_by': user['name'],
        })
    # Optional on-the-spot settlement of what's owed to the karigar for this job.
    labour_amount = body.labour_amount or 0
    pay_cash = body.pay_cash or 0
    pay_metal_weight = body.pay_metal_weight or 0
    pay_metal_value = body.pay_metal_value or 0
    if labour_amount:
        await db.karigar_ledger.insert_one({
            'id': str(uuid.uuid4()), 'karigar_id': karigar_id, 'type': 'labour_payable', 'weight': None,
            'amount': labour_amount, 'item_id': item['id'], 'item_code': item['item_code'],
            'txn_id': txn_id, 'note': f"Labour due: {item['description']}",
            'created_at': iso, 'created_by': user['name'],
        })
    if pay_metal_weight:
        # The actual metal handed to the karigar — a real gold_out movement,
        # tracked independently of whatever ₹ value staff estimate for it below.
        # Entered directly in fine grams (not gross) — settlement metal is
        # squared off in fine weight regardless of the item's own touch, since
        # jobs vary widely in size and staff always settle balances in fine terms.
        pay_metal_fine = round(pay_metal_weight, 3)
        await db.karigar_ledger.insert_one({
            'id': str(uuid.uuid4()), 'karigar_id': karigar_id, 'type': 'gold_out', 'weight': pay_metal_weight,
            'fine_weight': pay_metal_fine, 'amount': None, 'item_id': item['id'], 'item_code': item['item_code'],
            'txn_id': txn_id, 'note': f"Metal paid on the spot for {item['item_code']}",
            'created_at': iso, 'created_by': user['name'],
        })
    paid_total = pay_cash + pay_metal_value
    if paid_total:
        metal_note = f", incl. {pay_metal_weight:.3f}g metal worth ₹{pay_metal_value:.0f}" if pay_metal_weight else ''
        await db.karigar_ledger.insert_one({
            'id': str(uuid.uuid4()), 'karigar_id': karigar_id, 'type': 'payment', 'weight': None,
            'amount': paid_total, 'item_id': item['id'], 'item_code': item['item_code'],
            'txn_id': txn_id, 'note': f"Paid on the spot for {item['item_code']}{metal_note}",
            'created_at': iso, 'created_by': user['name'],
        })
    # ...and the reverse: the karigar settling a shortfall by handing the shop
    # cash and/or extra metal, right here at receive time.
    recv_cash = body.recv_cash or 0
    recv_metal_weight = body.recv_metal_weight or 0
    if recv_cash:
        await db.karigar_ledger.insert_one({
            'id': str(uuid.uuid4()), 'karigar_id': karigar_id, 'type': 'receipt', 'weight': None,
            'amount': recv_cash, 'item_id': item['id'], 'item_code': item['item_code'],
            'txn_id': txn_id, 'note': f"Cash received from karigar for {item['item_code']}",
            'created_at': iso, 'created_by': user['name'],
        })
    if recv_metal_weight:
        # Same as pay_metal above — entered directly in fine grams.
        recv_metal_fine = round(recv_metal_weight, 3)
        await db.karigar_ledger.insert_one({
            'id': str(uuid.uuid4()), 'karigar_id': karigar_id, 'type': 'gold_in', 'weight': recv_metal_weight,
            'fine_weight': recv_metal_fine, 'amount': None, 'item_id': item['id'], 'item_code': item['item_code'],
            'txn_id': txn_id, 'note': f"Extra metal received from karigar to settle shortfall on {item['item_code']}",
            'created_at': iso, 'created_by': user['name'],
        })


@router.post('/repair-items/{item_id}/receive')
async def receive_from_karigar(item_id: str, body: ReceiveFromKarigarIn, user=Depends(require_admin_or_module('repairs'))):
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    if item['status'] != 'with_karigar':
        raise HTTPException(status_code=400, detail='This item is not currently with a karigar')
    karigar_id = item['karigar_id']
    calc = _compute_receive(item, body)

    iso = now_utc().isoformat()
    txn_id = str(uuid.uuid4())
    challan_no = f"RC-{item['item_code']}-{await db.karigar_transactions.count_documents({'item_id': item_id, 'direction': 'receive'}) + 1}"
    txn = {
        'id': txn_id, 'item_id': item_id, 'item_code': item['item_code'], 'karigar_id': karigar_id,
        'karigar_name': item.get('karigar_name'), 'direction': 'receive', 'weight': body.weight,
        'weight_net': calc['weight_net'], 'recv_purity': calc['recv_purity'],
        'fine_weight': calc['entry_fine_weight'], 'weight_diff': calc['diff'], 'fine_weight_diff': calc['fine_diff'],
        'process_loss': calc['process_loss'], 'wastage_weight': calc['wastage_weight'], 'balance_fine_weight': calc['balance_fine_weight'],
        'note': body.note or '', 'slip_photo': body.slip_photo or '', 'challan_no': challan_no, 'created_at': iso,
        'created_by': user['name'],
        # Raw settlement inputs, kept on the txn itself (not just derived into
        # ledger entries) so a later edit can re-open this exact same form
        # pre-filled, instead of guessing them back out of the ledger.
        'labour_amount': body.labour_amount or 0, 'pay_cash': body.pay_cash or 0,
        'pay_metal_weight': body.pay_metal_weight or 0, 'pay_metal_value': body.pay_metal_value or 0,
        'recv_cash': body.recv_cash or 0, 'recv_metal_weight': body.recv_metal_weight or 0,
    }
    await db.karigar_transactions.insert_one(dict(txn))
    await _post_receive_ledger(karigar_id, item, calc, body, txn_id, iso, user)

    await db.repair_items.update_one({'id': item_id}, {'$set': {
        'status': 'ready', 'weight_diff': calc['diff'], 'fine_weight_diff': calc['fine_diff'],
        'process_loss': calc['process_loss'], 'wastage_weight': calc['wastage_weight'], 'recv_purity': calc['recv_purity'],
        'balance_fine_weight': calc['balance_fine_weight'], 'updated_by': user['name'],
    }})
    await log_audit(user, 'repair_item.receive', 'repair_item', item_id, item['item_code'], {'weight_diff': calc['diff'], 'fine_weight_diff': calc['fine_diff']})
    await _notify_module('repairs', 'Repair item ready',
                          f"{item['item_code']} ({item.get('customer_name', '')}) is back from the karigar and ready for delivery", '/repairs', script='repair_item_ready')
    return await db.repair_items.find_one({'id': item_id}, {'_id': 0})


@router.post('/repair-items/{item_id}/unready')
async def undo_ready(item_id: str, user=Depends(require_admin_or_module_right('repairs', 'edit'))):
    """Undoes whatever put this tag into 'ready' (Pending to Bill) —
    whichever path it took. If it came back from a karigar, this undoes
    that receive (same effect as deleting the most recent receive
    transaction, just one tap). If it skipped the karigar step entirely
    (Issue to Karigar left blank), it just goes back to 'received'."""
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    if item['status'] != 'ready':
        raise HTTPException(status_code=400, detail='Only a tag that is Pending to Bill can be undone')

    if item.get('karigar_id'):
        txn = await db.karigar_transactions.find_one(
            {'item_id': item_id, 'direction': 'receive'}, {'_id': 0}, sort=[('created_at', -1)],
        )
        if not txn:
            raise HTTPException(status_code=400, detail='No receive transaction found to undo')
        await db.karigar_transactions.delete_one({'id': txn['id']})
        await db.karigar_ledger.delete_many({'txn_id': txn['id']})
        await db.repair_items.update_one({'id': item_id}, {'$set': {
            'status': 'with_karigar', 'weight_diff': None, 'fine_weight_diff': None,
            'process_loss': None, 'wastage_weight': None, 'recv_purity': None, 'balance_fine_weight': None,
            'updated_by': user['name'],
        }})
    else:
        await db.repair_items.update_one({'id': item_id}, {'$set': {'status': 'received', 'updated_by': user['name']}})

    await log_audit(user, 'repair_item.unready', 'repair_item', item_id, item['item_code'], {})
    return await db.repair_items.find_one({'id': item_id}, {'_id': 0})


@router.put('/repair-items/{item_id}/transactions/{txn_id}')
async def edit_karigar_transaction(item_id: str, txn_id: str, body: KarigarTransactionEditIn, user=Depends(require_admin_or_module_right('repairs', 'edit'))):
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    txn = await db.karigar_transactions.find_one({'id': txn_id, 'item_id': item_id}, {'_id': 0})
    if not txn: raise HTTPException(status_code=404, detail='Transaction not found')
    if item['status'] == 'delivered':
        raise HTTPException(status_code=400, detail='This item has already been delivered and billed — its history is locked')
    if txn['direction'] == 'issue' and item['status'] != 'with_karigar':
        raise HTTPException(status_code=400, detail='Only the current, unresolved issue can be edited — receive it back first if you need to correct an older one')
    if txn['direction'] == 'receive' and item['status'] != 'ready':
        raise HTTPException(status_code=400, detail='Only the most recent receive can be edited')

    iso = now_utc().isoformat()

    if txn['direction'] == 'issue':
        # Weight is never editable here — it always equals the item's gross
        # weight. The only things that can actually change are who it went to
        # and the note.
        karigar = None
        if body.karigar_id and body.karigar_id != txn['karigar_id']:
            karigar = await db.karigars.find_one({'id': body.karigar_id}, {'_id': 0})
            if not karigar: raise HTTPException(status_code=404, detail='Karigar not found')
        new_karigar_id = karigar['id'] if karigar else txn['karigar_id']
        new_karigar_name = karigar['name'] if karigar else txn['karigar_name']
        await db.karigar_transactions.update_one({'id': txn_id}, {'$set': {
            'karigar_id': new_karigar_id, 'karigar_name': new_karigar_name,
            'note': body.note or '', 'edited_at': iso, 'edited_by': user['name'],
        }})
        await db.karigar_ledger.update_many({'txn_id': txn_id}, {'$set': {'karigar_id': new_karigar_id}})
        await db.repair_items.update_one({'id': item_id}, {'$set': {
            'karigar_id': new_karigar_id, 'karigar_name': new_karigar_name, 'updated_by': user['name'],
        }})
    else:
        if body.weight is None:
            raise HTTPException(status_code=400, detail='weight is required to correct a receive')
        # Redo this receive's whole ledger footprint from scratch against the
        # corrected numbers — the simplest way to guarantee an edit can't drift
        # out of sync with what a fresh receive_from_karigar call would post.
        await db.karigar_ledger.delete_many({'txn_id': txn_id})
        calc = _compute_receive(item, body)
        await db.karigar_transactions.update_one({'id': txn_id}, {'$set': {
            'weight': body.weight, 'weight_net': calc['weight_net'], 'recv_purity': calc['recv_purity'],
            'fine_weight': calc['entry_fine_weight'], 'weight_diff': calc['diff'], 'fine_weight_diff': calc['fine_diff'],
            'process_loss': calc['process_loss'], 'wastage_weight': calc['wastage_weight'],
            'balance_fine_weight': calc['balance_fine_weight'], 'slip_photo': body.slip_photo or '',
            'note': body.note or '', 'edited_at': iso, 'edited_by': user['name'],
            'labour_amount': body.labour_amount or 0, 'pay_cash': body.pay_cash or 0,
            'pay_metal_weight': body.pay_metal_weight or 0, 'pay_metal_value': body.pay_metal_value or 0,
            'recv_cash': body.recv_cash or 0, 'recv_metal_weight': body.recv_metal_weight or 0,
        }})
        await _post_receive_ledger(item['karigar_id'], item, calc, body, txn_id, iso, user)
        await db.repair_items.update_one({'id': item_id}, {'$set': {
            'weight_diff': calc['diff'], 'fine_weight_diff': calc['fine_diff'],
            'process_loss': calc['process_loss'], 'wastage_weight': calc['wastage_weight'], 'recv_purity': calc['recv_purity'],
            'balance_fine_weight': calc['balance_fine_weight'], 'updated_by': user['name'],
        }})
    await log_audit(user, 'repair_item.transaction_edit', 'repair_item', item_id, item['item_code'], {'txn_id': txn_id})
    return await db.repair_items.find_one({'id': item_id}, {'_id': 0})


@router.delete('/repair-items/{item_id}/transactions/{txn_id}')
async def delete_karigar_transaction(item_id: str, txn_id: str, user=Depends(require_admin_or_module_right('repairs', 'delete'))):
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    txn = await db.karigar_transactions.find_one({'id': txn_id, 'item_id': item_id}, {'_id': 0})
    if not txn: raise HTTPException(status_code=404, detail='Transaction not found')
    if item['status'] == 'delivered':
        raise HTTPException(status_code=400, detail='This item has already been delivered and billed — its history is locked')
    if txn['direction'] == 'issue' and item['status'] != 'with_karigar':
        raise HTTPException(status_code=400, detail='Only the current, unresolved issue can be deleted — receive it back first if you need to undo an older one')
    if txn['direction'] == 'receive' and item['status'] != 'ready':
        raise HTTPException(status_code=400, detail='Only the most recent receive can be deleted')

    await db.karigar_transactions.delete_one({'id': txn_id})
    await db.karigar_ledger.delete_many({'txn_id': txn_id})
    if txn['direction'] == 'issue':
        await db.repair_items.update_one({'id': item_id}, {'$set': {
            'status': 'received', 'karigar_id': None, 'karigar_name': None,
            'current_issue_weight': None, 'current_issue_fine_weight': None, 'updated_by': user['name'],
        }})
    else:
        await db.repair_items.update_one({'id': item_id}, {'$set': {
            'status': 'with_karigar', 'weight_diff': None, 'fine_weight_diff': None,
            'process_loss': None, 'wastage_weight': None, 'recv_purity': None, 'balance_fine_weight': None,
            'customer_adjustment': 0, 'updated_by': user['name'],
        }})
    await log_audit(user, 'repair_item.transaction_delete', 'repair_item', item_id, item['item_code'], {'txn_id': txn_id, 'direction': txn['direction']})
    return await db.repair_items.find_one({'id': item_id}, {'_id': 0})


async def _sync_cash_ledger_entry(item: dict, billed_amount: float, payment_mode: str, user: dict, iso: str):
    """Keeps the shop's cash ledger in sync with one billed item — a bill can
    be edited in place, so this deletes any prior entry for this item first,
    then reposts fresh (same delete-then-repost pattern as karigar receive
    edits). A positive billed_amount is cash the shop received; a negative
    one (weight decreased more than any added material — see New Wt on the
    bill) is a refund owed back to the customer."""
    await db.cash_ledger.delete_many({'item_id': item['id']})
    if not billed_amount:
        return
    entry_type = 'receipt' if billed_amount > 0 else 'refund'
    await db.cash_ledger.insert_one({
        'id': str(uuid.uuid4()), 'type': entry_type, 'amount': round(abs(billed_amount), 2),
        'item_id': item['id'], 'item_code': item['item_code'], 'customer_name': item.get('customer_name', ''),
        'payment_mode': payment_mode or 'cash',
        'note': f"{'Repair bill' if entry_type == 'receipt' else 'Refund'} — {item.get('description', '')}",
        'created_at': iso, 'created_by': user['name'],
    })


@router.post('/repair-items/{item_id}/deliver')
async def bill_item(item_id: str, body: DeliverIn, user=Depends(require_admin_or_module(['repairs']))):
    """Bills a Pending-to-Bill tag — this used to also mark it delivered in
    the same step, but billing and the customer actually walking out with
    the item are now two separate moments: this moves the tag to
    'pending_delivery' (billed, waiting to be picked up); close_delivery()
    below is the second, separate step that actually closes it out."""
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    if item['status'] != 'ready':
        raise HTTPException(status_code=400, detail='Item must be ready before billing')
    iso = now_utc().isoformat()
    labour = body.labour_charge if body.labour_charge is not None else item.get('labour_charge', 0)
    material_adj = body.material_adjustment if body.material_adjustment is not None else item.get('customer_adjustment', 0) or 0
    extra = body.extra_charges or 0
    prev_balance = body.previous_balance or 0
    billed_amount = round(prev_balance + labour + material_adj + extra, 2)
    await db.repair_items.update_one({'id': item_id}, {'$set': {
        'status': 'pending_delivery',
        'bill_labour_charge': labour, 'bill_material_adjustment': material_adj,
        'bill_extra_charges': extra, 'bill_extra_charges_note': body.extra_charges_note or '',
        'bill_previous_balance': prev_balance,
        'bill_weight_rate': body.weight_rate or 0, 'bill_value_add': body.value_add or 0,
        'billed_amount': billed_amount,
        'payment_mode': body.payment_mode, 'delivery_note': body.note or '', 'updated_by': user['name'],
        'final_photo': body.final_photo or item.get('final_photo', ''),
    }})
    updated = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    await _sync_cash_ledger_entry(updated, billed_amount, body.payment_mode, user, iso)
    await log_audit(user, 'repair_item.bill', 'repair_item', item_id, item['item_code'], {'billed_amount': billed_amount})

    # Customer-facing "ready for pickup" WhatsApp notice — fired here, not on
    # the earlier 'ready' transition, because that one just means back from
    # the karigar and awaiting billing (an internal, staff-facing signal —
    # see the repair_item_ready _notify_module calls elsewhere in this file).
    # This is the actual moment the customer has something to come collect.
    # Fire-and-forget: never let a WhatsApp hiccup slow down or fail billing.
    order = await db.repair_orders.find_one({'id': item.get('order_id')}, {'_id': 0, 'customer_mobile': 1})
    if order and order.get('customer_mobile'):
        store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
        shop_name = store.get('name') or 'Ram Murti Jewellers'
        amount_line = f"You have a credit of Rs.{abs(billed_amount):.0f} on this item." if billed_amount < 0 else f"Bill amount: Rs.{billed_amount:.0f}."
        msg = (
            f"Hi {item.get('customer_name', '')}, your item {item['item_code']} ({item.get('description', '')}) "
            f"is ready for pickup at {shop_name}. {amount_line} Thank you!"
        )
        asyncio.create_task(send_whatsapp(order['customer_mobile'], msg))

    return updated


@router.post('/repair-items/{item_id}/close-delivery')
async def close_delivery(item_id: str, body: CloseDeliveryIn, user=Depends(require_admin_or_module(['repairs']))):
    """Second, separate step from billing: the customer has actually picked
    the item up. Records who handed it over and on what date, then marks it
    delivered."""
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    if item['status'] != 'pending_delivery':
        raise HTTPException(status_code=400, detail='This tag is not pending delivery')
    delivered_by = (body.delivered_by or '').strip() or user['name']
    if body.delivered_at:
        try:
            delivered_iso = datetime.combine(date.fromisoformat(body.delivered_at), datetime.min.time()).replace(tzinfo=timezone.utc).isoformat()
        except Exception:
            delivered_iso = now_utc().isoformat()
    else:
        delivered_iso = now_utc().isoformat()
    await db.repair_items.update_one({'id': item_id}, {'$set': {
        'status': 'delivered', 'delivered_at': delivered_iso,
        'delivered_by': delivered_by, 'delivered_by_id': user['id'], 'updated_by': user['name'],
    }})
    await log_audit(user, 'repair_item.close_delivery', 'repair_item', item_id, item['item_code'], {'delivered_by': delivered_by})
    return await db.repair_items.find_one({'id': item_id}, {'_id': 0})


@router.put('/repair-items/{item_id}/bill')
async def edit_bill(item_id: str, body: DeliverIn, user=Depends(require_admin_or_module_right('repairs', 'edit'))):
    """Corrects a bill in place (whether it's still pending delivery or
    already fully delivered) — same full form as creating one, rather than
    the old delete-then-recreate dance. Doesn't touch status, delivered_at,
    or the karigar side of the job; only the bill numbers."""
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    if item['status'] not in ('pending_delivery', 'delivered'):
        raise HTTPException(status_code=400, detail='This tag has not been billed yet')
    labour = body.labour_charge if body.labour_charge is not None else item.get('bill_labour_charge', 0) or 0
    material_adj = body.material_adjustment if body.material_adjustment is not None else item.get('bill_material_adjustment', 0) or 0
    extra = body.extra_charges if body.extra_charges is not None else item.get('bill_extra_charges', 0) or 0
    prev_balance = body.previous_balance if body.previous_balance is not None else item.get('bill_previous_balance', 0) or 0
    billed_amount = round(prev_balance + labour + material_adj + extra, 2)
    iso = now_utc().isoformat()
    weight_rate = body.weight_rate if body.weight_rate is not None else item.get('bill_weight_rate', 0) or 0
    value_add = body.value_add if body.value_add is not None else item.get('bill_value_add', 0) or 0
    await db.repair_items.update_one({'id': item_id}, {'$set': {
        'bill_labour_charge': labour, 'bill_material_adjustment': material_adj,
        'bill_extra_charges': extra, 'bill_extra_charges_note': body.extra_charges_note or '',
        'bill_previous_balance': prev_balance,
        'bill_weight_rate': weight_rate, 'bill_value_add': value_add,
        'billed_amount': billed_amount,
        'payment_mode': body.payment_mode, 'delivery_note': body.note or item.get('delivery_note', ''),
        'final_photo': body.final_photo or item.get('final_photo', ''), 'updated_by': user['name'],
    }})
    updated = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    await _sync_cash_ledger_entry(updated, billed_amount, body.payment_mode, user, iso)
    await log_audit(user, 'repair_item.bill_edit', 'repair_item', item_id, item['item_code'], {'billed_amount': billed_amount})
    return updated


@router.delete('/repair-items/{item_id}/bill')
async def delete_bill(item_id: str, user=Depends(require_admin_or_module_right('repairs', 'delete'))):
    # Undoes a bill — puts the tag back to "ready" (Pending to Bill) so it
    # can be re-billed correctly. Does not touch the tag/intake record itself.
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    if item['status'] not in ('pending_delivery', 'delivered'):
        raise HTTPException(status_code=400, detail='This item has not been billed')
    await db.repair_items.update_one({'id': item_id}, {'$set': {
        'status': 'ready', 'delivered_at': None, 'delivered_by': None, 'delivered_by_id': None,
        'bill_labour_charge': None, 'bill_material_adjustment': None,
        'bill_extra_charges': None, 'bill_extra_charges_note': '', 'bill_previous_balance': None,
        'bill_weight_rate': None, 'bill_value_add': None,
        'billed_amount': None, 'payment_mode': None, 'delivery_note': '',
        'updated_by': user['name'],
    }})
    await db.cash_ledger.delete_many({'item_id': item_id})
    await log_audit(user, 'repair_item.bill_delete', 'repair_item', item_id, item['item_code'], {'billed_amount': item.get('billed_amount')})
    return {'ok': True}


@router.get('/cash-ledger')
async def cash_ledger(cursor: Optional[str] = None, limit: int = 50, _: dict = Depends(require_staff_or_module('repairs'))):
    """Every cash movement tied to a repair bill — receipts from customers
    and refunds paid back to them (e.g. when an item's weight decreased) —
    newest first, with running totals.

    Keyset-paginated on created_at (newest page has no cursor; pass the
    previous page's next_cursor to keep going). Totals are computed via a
    separate full-collection aggregation, not from the paginated page, so
    they stay accurate regardless of how many pages have been fetched."""
    limit = max(1, min(limit, 200))
    query: dict = {'created_at': {'$lt': cursor}} if cursor else {}
    entries = await db.cash_ledger.find(query, {'_id': 0}).sort('created_at', -1).to_list(limit + 1)
    next_cursor = entries[limit]['created_at'] if len(entries) > limit else None
    entries = entries[:limit]
    totals = {t['_id']: t['total'] async for t in db.cash_ledger.aggregate([
        {'$group': {'_id': '$type', 'total': {'$sum': '$amount'}}},
    ])}
    total_received = round(totals.get('receipt', 0), 2)
    total_paid_out = round(totals.get('refund', 0), 2)
    # By-payment-mode rollup, same full-dataset treatment as the totals above
    # — the frontend used to compute this client-side from `entries`, which
    # broke once entries became paginated (it would've only reflected
    # whatever page was currently loaded).
    by_mode_agg = [m async for m in db.cash_ledger.aggregate([
        {'$group': {
            '_id': '$payment_mode',
            'received': {'$sum': {'$cond': [{'$eq': ['$type', 'receipt']}, '$amount', 0]}},
            'refunded': {'$sum': {'$cond': [{'$eq': ['$type', 'refund']}, '$amount', 0]}},
            'count': {'$sum': 1},
        }},
        {'$sort': {'received': -1}},
    ])]
    by_mode = [{'mode': m['_id'] or 'cash', 'received': round(m['received'], 2), 'refunded': round(m['refunded'], 2), 'count': m['count']} for m in by_mode_agg]
    return {'entries': entries, 'next_cursor': next_cursor, 'by_mode': by_mode,
            'total_received': total_received, 'total_paid_out': total_paid_out,
            'net': round(total_received - total_paid_out, 2)}


def _bill_receipt_lines(item: dict) -> list:
    """Shared by the A4 bill PDF's row data and the thermal receipt print —
    (label, value) tuples for the narrow-format version."""
    lines = [
        ('Item', item['description']), ('Tag', item['item_code']), ('Repair Type', item['repair_type'] or '—'),
        ('Weight', f"{item['gross_weight']:.3f}g"),
        ('Labour Charge', _inr(item.get('bill_labour_charge') if item.get('bill_labour_charge') is not None else item.get('labour_charge', 0))),
    ]
    if item.get('bill_material_adjustment'):
        lines.append(('Material Adjustment', _inr(item['bill_material_adjustment'])))
    if item.get('bill_extra_charges'):
        lines.append((item.get('bill_extra_charges_note') or 'Extra Charges', _inr(item['bill_extra_charges'])))
    lines.append(('Total Billed', _inr(item.get('billed_amount') or 0)))
    lines.append(('Payment Mode', (item.get('payment_mode') or '—').title()))
    return lines


@router.get('/repair-items/{item_id}/bill/pdf')
async def repair_item_bill_pdf(item_id: str, _: dict = Depends(require_staff_or_module(['repairs']))):
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    # Same narrow label-style layout as every other Repair/Stock In-Out
    # printout (see repair_order_slip_pdf above) instead of the old wide A4
    # Field/Value report table.
    pdf = _thermal_slip_pdf(
        store.get('name') or 'Ram Murti Jewellers', f"Repair Bill — {item['item_code']}",
        _bill_receipt_lines(item),
    )
    return _pdf_response(pdf, f'repair-bill-{item["item_code"]}.pdf')


@router.post('/repair-items/{item_id}/bill/print')
async def repair_item_bill_print(item_id: str, user: dict = Depends(require_staff_or_module(['repairs']))):
    """Sends the bill/quotation straight to the configured WiFi thermal
    printer as a bordered table — item details, the weight change breakdown,
    and the charges/total, instead of generating a PDF."""
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    data = _escpos_bill_table(store.get('name') or 'Ram Murti Jewellers', item)
    await _print_escpos(data)
    await log_audit(user, 'repair_item.bill_print', 'repair_item', item_id, item['item_code'], {})
    return {'ok': True}


def _issue_slip_lines(item: dict, txn: dict) -> list:
    """Shared by the issue-slip PDF and the thermal receipt print."""
    lines = [
        ('Challan No', txn['challan_no']),
        ('Date', _dmy(txn['created_at'][:10])),
        ('Karigar', txn['karigar_name']),
        ('Tag', item['item_code']),
        ('Item', item['description']),
        ('Weight Issued', f"{txn['weight']:.3f}g"),
        ('Purity', f"{item.get('purity', 100):.1f}%"),
        ('Fine Weight', f"{(txn.get('fine_weight') or txn['weight']):.3f}g"),
        ('Issued By', txn['created_by']),
    ]
    if txn.get('note'):
        lines.append(('Note', txn['note']))
    return lines


async def _get_issue_txn(item_id: str) -> tuple:
    item = await db.repair_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(status_code=404, detail='Item not found')
    txn = await db.karigar_transactions.find_one({'item_id': item_id, 'direction': 'issue'}, {'_id': 0}, sort=[('created_at', -1)])
    if not txn: raise HTTPException(status_code=404, detail='This item has not been issued to a karigar yet')
    return item, txn


@router.get('/repair-items/{item_id}/issue-slip/pdf')
async def repair_item_issue_slip_pdf(item_id: str, _: dict = Depends(require_staff_or_module('repairs'))):
    """Narrow thermal-printer-friendly challan for the item's current (or most
    recent) karigar issue — separate from the A4 intake slip."""
    item, txn = await _get_issue_txn(item_id)
    store = await db.settings.find_one({}, {'_id': 0, 'name': 1}) or {}
    pdf = _thermal_slip_pdf(store.get('name') or 'Ram Murti Jewellers', 'Karigar Issue Challan', _issue_slip_lines(item, txn))
    return _pdf_response(pdf, f'issue-slip-{item["item_code"]}.pdf')


@router.post('/repair-items/{item_id}/issue-slip/print')
async def repair_item_issue_slip_print(item_id: str, user: dict = Depends(require_staff_or_module('repairs'))):
    """Sends the karigar issue challan straight to the configured WiFi
    thermal printer instead of generating a PDF."""
    item, txn = await _get_issue_txn(item_id)
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    data = _escpos_receipt(store.get('name') or 'Ram Murti Jewellers', 'Karigar Issue Challan', _issue_slip_lines(item, txn))
    await _print_escpos(data)
    await log_audit(user, 'repair_item.issue_slip_print', 'repair_item', item_id, item['item_code'], {})
    return {'ok': True}


# ---------------- Repairs: Loss Ledger ----------------
@router.get('/karigars/loss-ledger')
async def loss_ledger(cursor: Optional[str] = None, limit: int = 50, _: dict = Depends(require_staff_or_module(['repairs', 'karigar_ledger']))):
    """Every declared process-loss entry across all karigars, newest first —
    an audit trail of how much gold is being written off as loss, and by
    whom, that's otherwise buried inside individual receive transactions.

    Keyset-paginated on created_at, same shape as GET /cash-ledger — totals
    come from a full-collection aggregation, independent of the page size."""
    limit = max(1, min(limit, 200))
    query: dict = {'type': 'loss'}
    if cursor:
        query['created_at'] = {'$lt': cursor}
    entries = await db.karigar_ledger.find(query, {'_id': 0}).sort('created_at', -1).to_list(limit + 1)
    next_cursor = entries[limit]['created_at'] if len(entries) > limit else None
    entries = entries[:limit]
    karigars = await db.karigars.find({}, {'_id': 0, 'id': 1, 'name': 1}).to_list(500)
    names = {k['id']: k['name'] for k in karigars}
    for e in entries:
        e['karigar_name'] = names.get(e.get('karigar_id'), '')
    totals = [t async for t in db.karigar_ledger.aggregate([
        {'$match': {'type': 'loss'}},
        {'$group': {'_id': None, 'weight': {'$sum': '$weight'}, 'fine_weight': {'$sum': '$fine_weight'}}},
    ])]
    total_weight = round((totals[0]['weight'] if totals else 0) or 0, 3)
    total_fine = round((totals[0]['fine_weight'] if totals else 0) or 0, 3)
    # By-karigar rollup, same full-dataset treatment — used to be computed
    # client-side from `entries`, which broke once entries became paginated.
    by_karigar_agg = [k async for k in db.karigar_ledger.aggregate([
        {'$match': {'type': 'loss'}},
        {'$group': {'_id': '$karigar_id', 'weight': {'$sum': '$weight'}, 'fine': {'$sum': '$fine_weight'}, 'count': {'$sum': 1}}},
        {'$sort': {'fine': -1}},
    ])]
    by_karigar = [{'karigar_id': k['_id'], 'name': names.get(k['_id'], 'Unknown'), 'weight': round((k['weight'] or 0), 3), 'fine': round((k['fine'] or 0), 3), 'count': k['count']} for k in by_karigar_agg]
    return {'entries': entries, 'next_cursor': next_cursor, 'by_karigar': by_karigar, 'total_weight': total_weight, 'total_fine_weight': total_fine}


# ---------------- Repairs: Karigar Ledger ----------------
@router.get('/karigars/{kid}/ledger')
async def get_karigar_ledger(kid: str, _: dict = Depends(require_staff_or_module(['repairs', 'karigar_ledger']))):
    karigar = await db.karigars.find_one({'id': kid}, {'_id': 0})
    if not karigar: raise HTTPException(status_code=404, detail='Karigar not found')
    entries = await db.karigar_ledger.find({'karigar_id': kid}, {'_id': 0}).sort('created_at', -1).to_list(1000)
    bal = _karigar_ledger_balances(entries).get(kid, {})
    return {
        'karigar': karigar, 'entries': entries,
        'weight_balance': round(bal.get('weight_bal', 0), 3), 'fine_weight_balance': round(bal.get('fine_bal', 0), 3),
        'amount_due': round(bal.get('amt_due', 0), 2),
    }


@router.post('/karigars/{kid}/ledger')
async def add_karigar_ledger_entry(kid: str, body: KarigarLedgerEntryIn, user=Depends(require_admin_or_module(['repairs', 'karigar_ledger']))):
    karigar = await db.karigars.find_one({'id': kid}, {'_id': 0})
    if not karigar: raise HTTPException(status_code=404, detail='Karigar not found')
    if body.type in ('gold_out', 'gold_in'):
        # A manual/general gold adjustment not tied to a specific repair item —
        # e.g. settling a leftover balance. Entered directly in fine-gold grams.
        w = abs(body.weight or 0)
        if not w:
            raise HTTPException(status_code=400, detail='Enter a gold weight greater than 0')
        doc = {
            'id': str(uuid.uuid4()), 'karigar_id': kid, 'type': body.type, 'weight': w, 'fine_weight': w,
            'amount': None, 'item_id': None, 'item_code': None, 'note': body.note or '',
            'created_at': now_utc().isoformat(), 'created_by': user['name'],
        }
    else:
        # Amount is always stored positive — direction is decided by `type` at
        # aggregation time (see _karigar_ledger_balances), matching how the
        # auto-generated entries from issue/receive are stored.
        signed = abs(body.amount or 0)
        doc = {
            'id': str(uuid.uuid4()), 'karigar_id': kid, 'type': body.type, 'weight': None, 'fine_weight': None,
            'amount': signed, 'item_id': None, 'item_code': None, 'note': body.note or '',
            'created_at': now_utc().isoformat(), 'created_by': user['name'],
        }
    await db.karigar_ledger.insert_one(dict(doc))
    await log_audit(user, f'karigar_ledger.{body.type}', 'karigar', kid, karigar['name'], {'amount': body.amount, 'weight': body.weight})
    return {k: v for k, v in doc.items() if k != '_id'}


@router.delete('/karigars/{kid}/ledger/{entry_id}')
async def delete_karigar_ledger_entry(kid: str, entry_id: str, user=Depends(require_admin_or_module_right('karigar_ledger', 'delete'))):
    entry = await db.karigar_ledger.find_one({'id': entry_id, 'karigar_id': kid}, {'_id': 0})
    if not entry: raise HTTPException(status_code=404, detail='Ledger entry not found')
    if entry.get('item_id'):
        raise HTTPException(status_code=400, detail='This entry is tied to a repair tag — delete the issue/receive from that tag\'s history instead')
    await db.karigar_ledger.delete_one({'id': entry_id})
    await log_audit(user, 'karigar_ledger.delete', 'karigar', kid, '', {'entry_id': entry_id, 'type': entry.get('type')})
    return {'ok': True}

# Printed under the shop name on every thermal slip/receipt (intake, issue,
# bill). Not in Store Settings — this app targets one shop, and the number
# was given directly for the print templates rather than as a configurable
# field.
STORE_MOBILE = '97818-00888'


def _inr(amount: float) -> str:
    """Rupee amount grouped the Indian way (lakh/crore: 2-2-3 from the right
    — '12,34,567' not '1,234,567'), for every thermal/PDF print across
    Repairs, Stock In/Out and Gold Loans. Python's `:,` format spec only
    does Western 3-digit grouping, so this is hand-rolled rather than a
    one-line format spec."""
    n = round(amount or 0)
    sign = '-' if n < 0 else ''
    s = str(abs(n))
    if len(s) > 3:
        last3 = s[-3:]
        rest = s[:-3]
        groups = []
        while len(rest) > 2:
            groups.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            groups.insert(0, rest)
        s = ','.join(groups) + ',' + last3
    return f'{sign}Rs.{s}'


def _dmy(iso_date: Optional[str]) -> str:
    """A bare 'YYYY-MM-DD' calendar date (no time component) as 'DD/MM/YYYY'
    — the Indian convention, for every date printed on a slip/receipt.
    Parsed as plain text, not round-tripped through a real Date object."""
    if not iso_date or len(iso_date) < 10:
        return iso_date or '—'
    y, m, d = iso_date[:10].split('-')
    return f'{d}/{m}/{y}'


def _thermal_slip_pdf(shop_name: str, heading: str, lines: list) -> bytes:
    """Narrow (80mm) receipt-style PDF meant to be printed on a thermal
    receipt printer via the browser's print dialog. `lines` is a list of
    (label, value) tuples, or a plain string for a divider/free line."""
    from io import BytesIO
    from reportlab.lib import colors as rlcolors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
    buf = BytesIO()
    width = 80 * mm
    doc = SimpleDocTemplate(buf, pagesize=(width, 200 * mm), leftMargin=4*mm, rightMargin=4*mm, topMargin=4*mm, bottomMargin=4*mm)
    styles = getSampleStyleSheet()
    dark = rlcolors.HexColor('#0D0D0D')
    els = [
        Paragraph(f"<b>{shop_name}</b>", ParagraphStyle('shop', parent=styles['Normal'], alignment=1, fontSize=11, textColor=dark)),
        Paragraph(f"Mobile: {STORE_MOBILE}", ParagraphStyle('mob', parent=styles['Normal'], alignment=1, fontSize=9, textColor=rlcolors.HexColor('#555'))),
        Paragraph(heading, ParagraphStyle('head', parent=styles['Normal'], alignment=1, fontSize=10, textColor=rlcolors.HexColor('#555'))),
        Spacer(1, 3*mm), HRFlowable(width='100%', color=rlcolors.HexColor('#999')), Spacer(1, 2*mm),
    ]
    for item in lines:
        if isinstance(item, tuple):
            label, value = item
            els.append(Paragraph(f"<b>{label}:</b> {value}", ParagraphStyle('l', parent=styles['Normal'], fontSize=10, textColor=dark, spaceAfter=3)))
        else:
            els.append(Spacer(1, 2*mm))
            els.append(HRFlowable(width='100%', color=rlcolors.HexColor('#ccc')))
            els.append(Spacer(1, 2*mm))
            if item:
                els.append(Paragraph(item, ParagraphStyle('n', parent=styles['Normal'], fontSize=9, textColor=rlcolors.HexColor('#555'))))
    els.append(Spacer(1, 6*mm))
    els.append(Paragraph(f"Generated {now_utc().astimezone(IST).strftime('%d %b %Y %H:%M')}", ParagraphStyle('f', parent=styles['Normal'], fontSize=7, alignment=1, textColor=rlcolors.HexColor('#999'))))
    doc.build(els)
    pdf = buf.getvalue(); buf.close()
    return pdf


def _thermal_tags_pdf(shop_name: str, order: dict, items: list) -> bytes:
    """One small item tag per page — same narrow 80mm format as
    _thermal_slip_pdf, but a page break between items instead of one long
    receipt, since these get cut apart and attached to separate pieces."""
    from io import BytesIO
    from reportlab.lib import colors as rlcolors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, PageBreak
    buf = BytesIO()
    width = 80 * mm
    doc = SimpleDocTemplate(buf, pagesize=(width, 100 * mm), leftMargin=4*mm, rightMargin=4*mm, topMargin=4*mm, bottomMargin=4*mm)
    styles = getSampleStyleSheet()
    dark = rlcolors.HexColor('#0D0D0D')
    els: list = []
    for i, item in enumerate(items):
        if i > 0:
            els.append(PageBreak())
        els += [
            Paragraph(f"<b>{shop_name}</b>", ParagraphStyle('shop', parent=styles['Normal'], alignment=1, fontSize=11, textColor=dark)),
            Paragraph(f"Mobile: {STORE_MOBILE}", ParagraphStyle('mob', parent=styles['Normal'], alignment=1, fontSize=9, textColor=rlcolors.HexColor('#555'))),
            Paragraph(f"Item Tag — {item['item_code']}", ParagraphStyle('head', parent=styles['Normal'], alignment=1, fontSize=10, textColor=rlcolors.HexColor('#555'))),
            Spacer(1, 3*mm), HRFlowable(width='100%', color=rlcolors.HexColor('#999')), Spacer(1, 2*mm),
        ]
        for label, value in _item_tag_lines(order, item):
            els.append(Paragraph(f"<b>{label}:</b> {value}", ParagraphStyle('l', parent=styles['Normal'], fontSize=10, textColor=dark, spaceAfter=3)))
    doc.build(els)
    pdf = buf.getvalue(); buf.close()
    return pdf

# ---------------- WiFi thermal receipt printer (ESC/POS over raw TCP) ----------------
# Targets a network receipt printer (e.g. Retsol RTP82) listening on the
# standard JetDirect/RAW port (9100) — no driver, no OS print queue, just a
# raw socket with ESC/POS command bytes. IP/port come from Store Settings.
_ESC = b'\x1b'
_GS = b'\x1d'
_ESCPOS_INIT = _ESC + b'@'            # reset printer state
_ESCPOS_LINE_SPACING = _ESC + b'3' + bytes([36])  # a touch roomier than the ~30-dot default, not the oversized 50 from before
_ESCPOS_ALIGN_CENTER = _ESC + b'a\x01'
_ESCPOS_ALIGN_LEFT = _ESC + b'a\x00'
_ESCPOS_BOLD_ON = _ESC + b'E\x01'
_ESCPOS_BOLD_OFF = _ESC + b'E\x00'
_ESCPOS_SIZE_NORMAL = _GS + b'!\x00'
_ESCPOS_SIZE_TALL = _GS + b'!\x01'    # double height only — stays readable-width
_ESCPOS_SIZE_BIG = _GS + b'!\x11'     # double width + double height — for the shop name only
_ESCPOS_CUT = _GS + b'V\x01'          # partial cut — leaves a small connecting
# tab rather than a full separation. Deliberately NOT full cut (\x00): on the
# clone/no-name 80mm auto-cutters this app targets (e.g. Retsol RTP82), full
# cut is the mode most likely to jam or fail to fully engage if the blade
# isn't perfectly aligned, which showed up as consecutive receipts printing
# back-to-back with no cut between them at all. Partial cut is the far more
# reliable auto-cut mode on cheap hardware — the tiny remaining tab tears
# away with a light pull, same as any till receipt.
_ESCPOS_WIDTH_CHARS = 42              # ~80mm paper at the default 12x24 font

# Blank feed before the cut, specified directly in dots via ESC J (print and
# feed n dots) rather than a pile of '\n's — ESC J feeds an exact physical
# distance regardless of the ESC 3 line-spacing setting above, so this margin
# doesn't quietly change if that setting ever does. At this printer class's
# standard 203dpi / 8 dots-per-mm resolution, 30mm needs 240 dots (the max a
# single byte allows here, which comfortably covers it).
_ESCPOS_CUT_FEED_MM = 30
_ESCPOS_FEED_BEFORE_CUT = _ESC + b'J' + bytes([min(255, round(_ESCPOS_CUT_FEED_MM * 8))])

_ESCPOS_UNICODE_FALLBACKS = {
    '₹': 'Rs.', '—': '-', '–': '-', '·': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...',
}


def _escpos_text(s: str) -> str:
    # cp437 (the standard ESC/POS default code page) is missing several
    # characters used elsewhere in the app (₹, em dash, the · separator,
    # smart quotes) — swap in plain-ASCII equivalents rather than letting
    # them fall back to '?' on the printout.
    text = s or ''
    for ch, repl in _ESCPOS_UNICODE_FALLBACKS.items():
        text = text.replace(ch, repl)
    return text


def _escpos_enc(s: str) -> bytes:
    return _escpos_text(s).encode('cp437', errors='replace')


def _escpos_wrapped(text: str, width: int):
    text = text or ''
    while True:
        chunk, text = text[:width], text[width:]
        yield chunk
        if not text:
            return


def _escpos_receipt(shop_name: str, heading: str, lines: list) -> bytes:
    """Builds raw ESC/POS bytes for an 80mm receipt. `lines` uses the same
    shape as _thermal_slip_pdf: (label, value) tuples, plain strings for a
    divider/free line, or '' for a blank line — so both the on-screen PDF and
    the direct network print render the same content.

    Compact "LABEL: value" layout at normal font size — the shop name is the
    only oversized text on the slip. Values that don't fit next to their
    label on one line drop to a wrapped block below it, still at normal size,
    so long notes/addresses don't clip."""
    enc = _escpos_enc
    out = bytearray()
    out += _ESCPOS_INIT + _ESCPOS_LINE_SPACING
    out += _ESCPOS_ALIGN_CENTER + _ESCPOS_BOLD_ON + _ESCPOS_SIZE_TALL
    out += enc(shop_name) + b'\n'
    out += _ESCPOS_SIZE_NORMAL
    out += enc(f'Mobile: {STORE_MOBILE}') + b'\n' + _ESCPOS_BOLD_OFF
    out += enc(heading) + b'\n\n'
    out += enc('=' * _ESCPOS_WIDTH_CHARS) + b'\n\n'
    out += _ESCPOS_ALIGN_LEFT

    for item in lines:
        if isinstance(item, tuple):
            label, value = item
            label_str = f"{label.upper()}: "
            value_str = str(value)
            if len(label_str) + len(value_str) <= _ESCPOS_WIDTH_CHARS:
                out += _ESCPOS_BOLD_ON + enc(label_str) + _ESCPOS_BOLD_OFF
                out += enc(value_str) + b'\n'
            else:
                out += _ESCPOS_BOLD_ON + enc(label.upper()) + b'\n' + _ESCPOS_BOLD_OFF
                for chunk in _escpos_wrapped(value_str, _ESCPOS_WIDTH_CHARS):
                    out += enc(chunk) + b'\n'
        elif item == '':
            out += b'\n'
        else:
            out += enc('-' * _ESCPOS_WIDTH_CHARS) + b'\n'
            out += _ESCPOS_BOLD_ON + enc(item) + b'\n' + _ESCPOS_BOLD_OFF
            out += b'\n'

    out += enc('=' * _ESCPOS_WIDTH_CHARS) + b'\n'
    out += _ESCPOS_ALIGN_CENTER
    out += enc(f"Generated {now_utc().astimezone(IST).strftime('%d %b %Y %H:%M')}") + b'\n'
    out += _ESCPOS_FEED_BEFORE_CUT
    out += _ESCPOS_CUT
    return bytes(out)


# Two-column bordered table, used for the repair bill/quotation print — a
# denser, more scannable layout than the label-above-value style above,
# since a bill has many short rows (weights, rate, charges) that read better
# side by side than stacked.
_ESCPOS_COL1 = 21
_ESCPOS_COL2 = 18


def _escpos_table_hline(left: str, mid: str, right: str, fill: str = '─') -> bytes:
    return _escpos_enc(left + fill * _ESCPOS_COL1 + mid + fill * _ESCPOS_COL2 + right) + b'\n'


def _escpos_table_row(col1: str, col2: str, bold: bool = False) -> bytes:
    c1 = _escpos_text(col1 or '')[:_ESCPOS_COL1].ljust(_ESCPOS_COL1)
    c2 = _escpos_text(col2 or '')[:_ESCPOS_COL2].rjust(_ESCPOS_COL2)
    row = _escpos_enc('│' + c1 + '│' + c2 + '│') + b'\n'
    return (_ESCPOS_BOLD_ON + row + _ESCPOS_BOLD_OFF) if bold else row


def _escpos_bill_table(shop_name: str, item: dict) -> bytes:
    """Repair bill / quotation, laid out as a bordered table: item details,
    the weight change breakdown (issue/loss/received/new wt/value add/rate),
    then the charges and total — everything staff currently see on-screen
    when billing, in one printable table instead of scattered flat lines."""
    issued = item.get('current_issue_weight') or 0
    loss = item.get('process_loss') or 0
    received = issued + (item.get('weight_diff') or 0)
    new_wt = round(issued - loss - received, 3)
    value_add = item.get('bill_value_add') or 0
    rate = item.get('bill_weight_rate') or 0
    weight_amount = item.get('bill_material_adjustment') or 0
    labour = item.get('bill_labour_charge') or 0
    extra = item.get('bill_extra_charges') or 0
    extra_note = item.get('bill_extra_charges_note') or ''
    prev_balance = item.get('bill_previous_balance') or 0
    total = item.get('billed_amount') or 0

    def rs(n: float, signed: bool = False) -> str:
        sign = '+' if signed and n > 0 else '-' if n < 0 else ''
        body = _inr(abs(n)) if abs(n) >= 1 or n == 0 else f"Rs.{abs(n):.2f}"
        return sign + body

    out = bytearray()
    out += _ESCPOS_INIT + _ESCPOS_LINE_SPACING
    out += _ESCPOS_ALIGN_CENTER + _ESCPOS_BOLD_ON + _ESCPOS_SIZE_TALL
    out += _escpos_enc(shop_name) + b'\n'
    out += _ESCPOS_SIZE_NORMAL
    out += _escpos_enc(f'Mobile: {STORE_MOBILE}') + b'\n' + _ESCPOS_BOLD_OFF
    out += _escpos_enc(f"Repair Quotation — {item['item_code']}") + b'\n'
    out += _escpos_enc(item.get('customer_name', '')) + b'\n\n'
    out += _ESCPOS_ALIGN_LEFT

    out += _escpos_table_hline('┌', '┬', '┐')
    out += _escpos_table_row('Item', item.get('description', ''))
    out += _escpos_table_row('Tag', item.get('item_code', ''))
    out += _escpos_table_row('Repair Type', item.get('repair_type') or '-')
    out += _escpos_table_hline('├', '┼', '┤')
    out += _escpos_table_row('Issue Wt', f"{issued:.3f}g")
    out += _escpos_table_row('Loss Wt', f"{loss:.3f}g")
    out += _escpos_table_row('Received Wt', f"{received:.3f}g")
    out += _escpos_table_row('New Wt', f"{new_wt:+.3f}g", bold=True)
    if value_add:
        out += _escpos_table_row('Value Add', f"{value_add:.3f}g")
    if rate:
        out += _escpos_table_row('Rate', f"{_inr(rate)}/g")
    out += _escpos_table_hline('├', '┼', '┤')
    out += _escpos_table_row('Weight Amount', rs(weight_amount, signed=True))
    out += _escpos_table_row('Labour Charge', rs(labour))
    if extra:
        out += _escpos_table_row(extra_note or 'Extra Charges', rs(extra))
    if prev_balance:
        out += _escpos_table_row('Previous Balance', rs(prev_balance))
    out += _escpos_table_hline('╞', '╪', '╡', fill='═')
    out += _escpos_table_row('CREDIT DUE' if total < 0 else 'TOTAL', rs(abs(total)) if total < 0 else rs(total), bold=True)
    out += _escpos_table_row('Payment Mode', (item.get('payment_mode') or 'cash').upper())
    out += _escpos_table_hline('└', '┴', '┘')

    out += b'\n'
    out += _ESCPOS_ALIGN_CENTER
    out += _escpos_enc(f"Generated {now_utc().astimezone(IST).strftime('%d %b %Y %H:%M')}") + b'\n'
    out += _ESCPOS_FEED_BEFORE_CUT
    out += _ESCPOS_CUT
    return bytes(out)


async def _print_escpos(data: bytes):
    """Opens a raw TCP socket to the configured printer and sends the ESC/POS
    bytes. Runs on a worker thread since socket I/O blocks."""
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    ip = store.get('printer_ip')
    if not ip:
        raise HTTPException(status_code=400, detail='No printer configured. Set the printer IP in Store Settings.')
    port = store.get('printer_port') or 9100

    def _send():
        import socket
        with socket.create_connection((ip, port), timeout=5) as sock:
            sock.sendall(data)

    try:
        await asyncio.to_thread(_send)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f'Could not reach the printer at {ip}:{port} — {e}')
