"""Dashboard, Audit log, PDF reports

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.responses import StreamingResponse
from typing import Optional
from datetime import date
import asyncio
import json
import time
from server import (
    db,
    today_str,
    now_utc,
    get_current,
    require_owner,
    require_staff,
    require_module,
    _karigar_ledger_balances,
    _report_pdf,
    _pdf_response,
    _ledger_sign,
    _minutes,
    _resolve_attendance_state,
    IST,
)
# Shares the same "opening balance carries forward from prior entries" math
# as the Cash Book screen itself — reused here rather than duplicated so the
# dashboard tile and the module's own day view always agree.
from routers.cashbook import _opening_balance_for

router = APIRouter()

# Same thresholds as routers/attendance.py's own NOT_CHECKED_IN_GRACE_MIN —
# keep in sync so the dashboard tiles and the Attendance screen's filters
# agree on who counts as "not checked in yet" / "missing a punch".
NOT_CHECKED_IN_GRACE_MIN = 30

# ---------------- Dashboard ----------------
# The dashboard is the same shop-wide snapshot for every staff viewer and is
# recomputed on a 5s SSE tick per connected client — so with several people
# logged in it was re-running ~20 Mongo queries many times a second. A tiny
# shared TTL cache collapses that to one computation per window for everyone,
# which is well within the dashboard's own staleness tolerance (30-min grace
# rules etc.). A lock prevents a thundering-herd recompute when it expires.
_DASH_TTL_SEC = 4.0
_dash_cache: dict = {'at': 0.0, 'data': None}
_dash_lock = asyncio.Lock()


async def _compute_dashboard_cached() -> dict:
    now = time.monotonic()
    data = _dash_cache['data']
    if data is not None and (now - _dash_cache['at']) < _DASH_TTL_SEC:
        return data
    async with _dash_lock:
        now = time.monotonic()
        if _dash_cache['data'] is not None and (now - _dash_cache['at']) < _DASH_TTL_SEC:
            return _dash_cache['data']
        fresh = await _compute_dashboard()
        _dash_cache['data'] = fresh
        _dash_cache['at'] = time.monotonic()
        return fresh


@router.get('/dashboard')
async def dashboard(_: dict = Depends(get_current)):
    return await _compute_dashboard_cached()


# Server-Sent Events live stream. Additive — GET /dashboard above stays the
# canonical fallback. This standalone Mongo has no change streams, so we simply
# recompute on a fixed interval using the SAME shared function as the REST
# endpoint (never a second, drifting code path). Auth is the normal
# Authorization: Bearer header (the client uses a fetch-based reader, not the
# native EventSource, precisely so it can send that header instead of leaking
# the JWT in a query param). Keep-alive comment lines are sent between payloads
# so Cloudflare's proxy doesn't idle-close the connection.
_STREAM_INTERVAL_SEC = 5


@router.get('/dashboard/stream')
async def dashboard_stream(request: Request, _: dict = Depends(get_current)):
    async def gen():
        try:
            # Send the current snapshot immediately on connect, then re-send on
            # each interval until the client goes away.
            payload = await _compute_dashboard_cached()
            yield f"data: {json.dumps(payload)}\n\n"
            while True:
                for _ in range(_STREAM_INTERVAL_SEC):
                    if await request.is_disconnected():
                        return
                    await asyncio.sleep(1)
                    yield ": keepalive\n\n"
                if await request.is_disconnected():
                    return
                payload = await _compute_dashboard_cached()
                yield f"data: {json.dumps(payload)}\n\n"
        except asyncio.CancelledError:  # client disconnected mid-send
            return

    return StreamingResponse(gen(), media_type='text/event-stream', headers={
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',  # ask any reverse proxy not to buffer the stream
        'Connection': 'keep-alive',
    })


async def _recent_activity(d: str, limit: int = 12) -> list:
    """Newest-first feed across the record types staff actually create — repair
    intake/delivery, cash book entries, stock returns, ledger entries. Used by
    the dashboard's "Recently recorded" strip and re-sent on the SSE stream.
    Cheap by design: small capped per-source queries merged and trimmed."""
    items: list = []
    async for i in db.repair_items.find({'created_at': {'$regex': f'^{d}'}}, {'_id': 0, 'id': 1, 'created_at': 1, 'item_name': 1}).sort('created_at', -1).limit(limit):
        items.append({'kind': 'repair', 'at': i.get('created_at'), 'label': f"Repair in: {i.get('item_name') or 'item'}", 'route': f"/repairs/{i['id']}"})
    async for c in db.cashbook_entries.find({'date': d}, {'_id': 0, 'type': 1, 'amount': 1, 'name': 1, 'created_at': 1}).sort('created_at', -1).limit(limit):
        sign = '+' if c.get('type') == 'received' else '−'
        items.append({'kind': 'cash', 'at': c.get('created_at'), 'label': f"Cash {sign}₹{round(c.get('amount') or 0)}: {c.get('name') or ''}".strip(), 'route': '/cashbook'})
    async for s in db.samples.find({'received_at': {'$regex': f'^{d}'}}, {'_id': 0, 'id': 1, 'received_at': 1, 'tag': 1}).sort('received_at', -1).limit(limit):
        items.append({'kind': 'stock', 'at': s.get('received_at'), 'label': f"Stock returned: {s.get('tag') or 'item'}", 'route': f"/samples/{s['id']}"})
    async for e in db.ledger_entries.find({'created_at': {'$regex': f'^{d}'}}, {'_id': 0, 'account_id': 1, 'particulars': 1, 'created_at': 1}).sort('created_at', -1).limit(limit):
        items.append({'kind': 'ledger', 'at': e.get('created_at'), 'label': f"Ledger: {e.get('particulars') or ''}".strip(), 'route': f"/accounts/{e['account_id']}"})
    items.sort(key=lambda x: x.get('at') or '', reverse=True)
    return items[:limit]


async def _compute_dashboard() -> dict:
    d = today_str()
    # Exclude inactive (ex-)employees — they shouldn't inflate the absent count
    # or the "N of M in" total on the dashboard.
    employees = await db.employees.find({'status': {'$ne': 'inactive'}}, {'_id': 0, 'id': 1, 'status': 1, 'shift': 1}).to_list(2000)
    total = len(employees)
    on_leave_status = sum(1 for e in employees if e.get('status') == 'on_leave')

    att = await db.attendance.find({'date': d}, {'_id': 0, 'check_in.selfie': 0, 'check_out.selfie': 0}).to_list(1000)
    att_by_emp = {a['employee_id']: a for a in att}

    now_ist = now_utc().astimezone(IST)
    minutes_now = now_ist.hour * 60 + now_ist.minute
    check_today = now_ist.weekday() != 6 and not await db.holidays.find_one({'date': d}, {'_id': 0, 'id': 1})
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    shifts_by_name = {}
    async for s in db.shifts.find({}, {'_id': 0}):
        shifts_by_name[s['name']] = s

    # Every tile below is derived from the same per-employee resolver the
    # Attendance screen and Payroll use, so the dashboard counts always
    # agree with what tapping through to Attendance's filters shows —
    # including the 'full day requires both a check-in and a check-out'
    # rule (a checked-in-with-no-checkout day past shift end no longer
    # silently counts as Present here either).
    present = half_day = late = working = missing_punch = 0
    for e in employees:
        if e.get('status') == 'on_leave':
            continue
        a = att_by_emp.get(e['id'])
        if not a:
            continue
        shift = shifts_by_name.get(e.get('shift'))
        state = _resolve_attendance_state(a, e, shift, store, True, minutes_now)
        if state['status'] == 'present':
            present += 1
            if state['is_late']: late += 1
        elif state['status'] == 'half_day':
            half_day += 1
        elif state['status'] == 'missing_punch':
            missing_punch += 1
        if a.get('check_in') and not a.get('check_out'):
            working += 1
    marked_ids = {a['employee_id'] for a in att}
    absent = max(total - len(marked_ids) - on_leave_status, 0)

    # 'Not checked in' = shift started 30+ min ago, still no check-in,
    # nothing explicitly recorded for the day.
    not_checked_in = 0
    if check_today:
        for e in employees:
            if e.get('status') == 'on_leave':
                continue
            a = att_by_emp.get(e['id'])
            shift = shifts_by_name.get(e.get('shift'))
            already_settled = bool(a and (a.get('check_in') or a.get('status') in ('leave', 'holiday', 'weekly_off', 'absent')))
            if not already_settled:
                start = (shift.get('start') if shift else None) or store.get('work_start', '10:00')
                if minutes_now >= _minutes(start) + NOT_CHECKED_IN_GRACE_MIN:
                    not_checked_in += 1

    pending_corrections = await db.corrections.count_documents({'status': 'pending'})
    pending_leaves = await db.leaves.count_documents({'status': 'pending'})

    # Repairs at-a-glance — counts by status plus how many are past their due date.
    repair_items = await db.repair_items.find({'status': {'$ne': 'delivered'}}, {'_id': 0, 'status': 1, 'due_date': 1}).to_list(5000)
    repairs_received = sum(1 for i in repair_items if i['status'] == 'received')
    repairs_with_karigar = sum(1 for i in repair_items if i['status'] == 'with_karigar')
    repairs_ready = sum(1 for i in repair_items if i['status'] == 'ready')
    repairs_overdue = sum(1 for i in repair_items if i.get('due_date') and i['due_date'] < d)
    delivered_today = await db.repair_items.count_documents({'status': 'delivered', 'delivered_at': {'$regex': f'^{d}'}})

    # Tasks at-a-glance — across the whole team (owner/admin view).
    open_tasks = await db.tasks.find({'status': 'open'}, {'_id': 0, 'due_date': 1}).to_list(5000)
    tasks_due_today = sum(1 for t in open_tasks if t.get('due_date') == d)
    tasks_overdue = sum(1 for t in open_tasks if t.get('due_date') and t['due_date'] < d)
    tasks_done_today = await db.tasks.count_documents({'status': 'done', 'completed_at': {'$regex': f'^{d}'}})

    # Business snapshot — revenue, intake, and who's carrying an open balance.
    month_prefix = d[:7]
    delivered_billed = await db.repair_items.find(
        {'status': 'delivered', 'delivered_at': {'$regex': f'^{month_prefix}'}},
        {'_id': 0, 'delivered_at': 1, 'billed_amount': 1},
    ).to_list(5000)
    revenue_today = sum(i.get('billed_amount') or 0 for i in delivered_billed if (i.get('delivered_at') or '').startswith(d))
    revenue_month = sum(i.get('billed_amount') or 0 for i in delivered_billed)
    intake_today = await db.repair_items.count_documents({'created_at': {'$regex': f'^{d}'}})
    active_employees = await db.employees.count_documents({'status': {'$ne': 'inactive'}})

    orders = await db.repair_orders.find({}, {'_id': 0, 'id': 1, 'customer_id': 1}).to_list(10000)
    order_to_customer = {o['id']: o['customer_id'] for o in orders}
    open_items_all = await db.repair_items.find({'status': {'$ne': 'delivered'}}, {'_id': 0, 'order_id': 1}).to_list(10000)
    customers_open = len({order_to_customer[i['order_id']] for i in open_items_all if order_to_customer.get(i.get('order_id'))})

    karigar_entries = await db.karigar_ledger.find({}, {'_id': 0, 'karigar_id': 1, 'type': 1, 'weight': 1, 'fine_weight': 1, 'amount': 1}).to_list(20000)
    karigar_bal = _karigar_ledger_balances(karigar_entries)
    karigars_open = sum(1 for b in karigar_bal.values() if round(b.get('fine_bal', 0), 3) or round(b.get('amt_due', 0), 2))
    # Net fine gold (grams) still sitting with karigars, and net cash the shop
    # owes them — the two halves of the dual balance, surfaced so the dashboard
    # can show a real Fine (g) + Amount (₹) glance tile instead of a cash-only
    # figure. Kept independent (never netted into one number), per the
    # jewellery dual-balance rule.
    fine_with_karigars = round(sum(b.get('fine_bal', 0) for b in karigar_bal.values()), 3)
    karigar_amt_payable = round(sum(b.get('amt_due', 0) for b in karigar_bal.values()), 2)

    # Stock In/Out (samples) at-a-glance — same two buckets as the employee
    # Transactions screen's own samples dashboard tile (GET /samples/dashboard),
    # so the two never disagree.
    samples_out = await db.samples.find({'status': 'with_karigar'}, {'_id': 0, 'due_date': 1}).to_list(5000)
    samples_overdue = sum(1 for s in samples_out if s.get('due_date') and s['due_date'] < d)
    samples_received_today = await db.samples.count_documents({'status': 'received', 'received_at': {'$regex': f'^{d}'}})

    # Cash Book at-a-glance — today's manual cash in/out, summed across every
    # active counter (kept separate from cash_ledger / repair-bill cash
    # payments throughout, including here). Counter Bal here is the shop's
    # total cash position across all counters combined.
    cb_counters = await db.cashbook_counters.find({'active': True}, {'_id': 0, 'id': 1}).to_list(200)
    cb_entries_today = await db.cashbook_entries.find({'date': d}, {'_id': 0, 'type': 1, 'amount': 1}).to_list(5000)
    cb_received_today = sum(e['amount'] for e in cb_entries_today if e['type'] == 'received')
    cb_paid_today = sum(e['amount'] for e in cb_entries_today if e['type'] == 'paid')
    cb_opening_total = 0.0
    for c in cb_counters:
        cb_opening_total += await _opening_balance_for(c['id'], d)
    cb_closing = round(cb_opening_total + cb_received_today - cb_paid_today, 2)

    return {
        'todays_attendance': {
            'present': present, 'absent': absent, 'late': late, 'half_day': half_day,
            'missing_punch': missing_punch, 'not_checked_in': not_checked_in,
            'leave': on_leave_status, 'working': working, 'total': total,
        },
        'pending_approvals': {
            'attendance_corrections': pending_corrections,
            'leave_requests': pending_leaves,
        },
        'repairs_summary': {
            'received': repairs_received, 'with_karigar': repairs_with_karigar, 'ready': repairs_ready,
            'overdue': repairs_overdue, 'delivered_today': delivered_today,
            'total_open': len(repair_items),
        },
        'tasks_summary': {
            'due_today': tasks_due_today, 'overdue': tasks_overdue,
            'done_today': tasks_done_today, 'open_total': len(open_tasks),
        },
        'samples_summary': {
            'with_karigar': len(samples_out), 'overdue': samples_overdue, 'received_today': samples_received_today,
        },
        'cashbook_summary': {
            'received_today': round(cb_received_today, 2), 'paid_today': round(cb_paid_today, 2),
            'closing_balance': cb_closing,
        },
        'business_summary': {
            'revenue_today': round(revenue_today, 2), 'revenue_month': round(revenue_month, 2),
            'intake_today': intake_today, 'active_employees': active_employees,
            'customers_open': customers_open, 'karigars_open': karigars_open,
            'fine_with_karigars': fine_with_karigars, 'karigar_amt_payable': karigar_amt_payable,
        },
        'recent_activity': await _recent_activity(d),
        # Documents captured but not yet recorded in the books — feeds the Home
        # needs-attention item + the Work row. Staff-dashboard consumers (owner/
        # admin/accountant) see the shop-wide pending total; fine-grained
        # per-category role filtering lives on GET /documents/summary.
        'documents_pending': await db.documents.count_documents({'status': 'pending', 'deleted': {'$ne': True}}),
    }

# ---------------- Audit ----------------
# log_audit() itself lives in server.py (shared — called from nearly every
# domain); this file only has the read endpoint.
@router.get('/audit/logs')
async def audit_list(
    actor: Optional[str] = None, entity_type: Optional[str] = None,
    from_date: Optional[str] = None, to_date: Optional[str] = None,
    limit: int = 200, _: dict = Depends(require_owner),
    _mod: dict = Depends(require_module('audit')),
):
    q: dict = {}
    if actor: q['actor_id'] = actor
    if entity_type: q['entity_type'] = entity_type
    if from_date or to_date:
        rng: dict = {}
        if from_date: rng['$gte'] = from_date
        if to_date: rng['$lte'] = to_date + 'T23:59:59'
        q['created_at'] = rng
    return await db.audit_logs.find(q, {'_id': 0}).sort('created_at', -1).limit(limit).to_list(limit)

@router.get('/reports/{kind}/pdf')
async def report_pdf(
    kind: str,
    from_date: Optional[str] = None, to_date: Optional[str] = None,
    year: Optional[int] = None, month: Optional[int] = None,
    employee_id: Optional[str] = None,
    user=Depends(require_staff),
    _mod: dict = Depends(require_module('reports')),
):
    kind = kind.lower()
    today = today_str()
    frm = from_date or today[:7] + '-01'
    to = to_date or today

    if kind == 'attendance':
        q: dict = {'date': {'$gte': frm, '$lte': to}}
        if employee_id: q['employee_id'] = employee_id
        rows = []
        emp_map = {e['id']: e async for e in db.employees.find({}, {'_id': 0, 'password_hash': 0, 'photo': 0})}
        async for a in db.attendance.find(q, {'_id': 0, 'check_in.selfie': 0, 'check_out.selfie': 0}).sort('date', 1):
            e = emp_map.get(a['employee_id'], {})
            rows.append([a['date'], e.get('employee_code', '—'), e.get('name', '—'),
                         a.get('status', '—'),
                         (a.get('check_in') or {}).get('timestamp', '') or '—',
                         (a.get('check_out') or {}).get('timestamp', '') or '—',
                         a.get('working_hours', 0),
                         'Yes' if a.get('is_late') else ''])
        return _pdf_response(
            _report_pdf('Attendance Report', f"{frm} to {to}",
                         ['Date', 'Code', 'Employee', 'Status', 'In', 'Out', 'Hours', 'Late'], rows),
            f'attendance-{frm}-to-{to}.pdf')

    if kind == 'late':
        q = {'date': {'$gte': frm, '$lte': to}, 'is_late': True}
        if employee_id: q['employee_id'] = employee_id
        rows = []
        emp_map = {e['id']: e async for e in db.employees.find({}, {'_id': 0, 'password_hash': 0, 'photo': 0})}
        async for a in db.attendance.find(q, {'_id': 0, 'check_in.selfie': 0, 'check_out.selfie': 0}).sort('date', 1):
            e = emp_map.get(a['employee_id'], {})
            rows.append([a['date'], e.get('employee_code', '—'), e.get('name', '—'),
                         (a.get('check_in') or {}).get('timestamp', '') or '—',
                         e.get('shift', '—')])
        return _pdf_response(
            _report_pdf('Late Punches Report', f"{frm} to {to}",
                         ['Date', 'Code', 'Employee', 'Check In', 'Shift'], rows),
            f'late-{frm}-to-{to}.pdf')

    if kind == 'missing_punch':
        # Both directions of an incomplete punch pair: checked in with no
        # check-out (the usual "forgot to punch out"), and checked out with
        # no check-in (a data anomaly, e.g. a manual edit that only set the
        # check-out time). Every date in this report is already in the
        # past, so shift-end/grace timing doesn't need to be re-evaluated
        # the way the live Attendance screen does.
        q = {
            'date': {'$gte': frm, '$lte': to},
            '$or': [
                {'check_in': {'$ne': None}, 'check_out': None},
                {'check_in': None, 'check_out': {'$ne': None}},
            ],
        }
        if employee_id: q['employee_id'] = employee_id
        rows = []
        emp_map = {e['id']: e async for e in db.employees.find({}, {'_id': 0, 'password_hash': 0, 'photo': 0})}
        async for a in db.attendance.find(q, {'_id': 0, 'check_in.selfie': 0, 'check_out.selfie': 0}).sort('date', 1):
            e = emp_map.get(a['employee_id'], {})
            rows.append([a['date'], e.get('employee_code', '—'), e.get('name', '—'),
                         (a.get('check_in') or {}).get('timestamp', '') or '—',
                         (a.get('check_out') or {}).get('timestamp', '') or '—'])
        return _pdf_response(
            _report_pdf('Missing Punch Report', f"{frm} to {to}",
                         ['Date', 'Code', 'Employee', 'Check In', 'Check Out'], rows),
            f'missing-punch-{frm}-to-{to}.pdf')

    if kind == 'leave':
        q = {'from_date': {'$lte': to}, 'to_date': {'$gte': frm}}
        if employee_id: q['employee_id'] = employee_id
        rows = []
        async for l in db.leaves.find(q, {'_id': 0}).sort('from_date', -1):
            rows.append([l['from_date'], l['to_date'], l.get('employee_code', '—'),
                         l.get('employee_name', '—'), (l.get('leave_type') or '').upper(),
                         l.get('status', '').upper(), (l.get('reason') or '')[:60]])
        return _pdf_response(
            _report_pdf('Leave Report', f"{frm} to {to}",
                         ['From', 'To', 'Code', 'Employee', 'Type', 'Status', 'Reason'], rows),
            f'leave-{frm}-to-{to}.pdf')

    if kind == 'payroll':
        if not year or not month:
            raise HTTPException(status_code=400, detail='year and month are required for payroll report')
        rows = []
        async for r in db.payroll_entries.find({'year': year, 'month': month}, {'_id': 0}).sort('name', 1):
            rows.append([r.get('employee_code', '—'), r['name'], f"₹{r['base_salary']:.0f}",
                         r['present_days'], r['half_days'], r['sunday_work'], r['leave_days'],
                         f"₹{r.get('opening_balance', 0):.0f}",
                         f"₹{r['bonus']:.0f}", f"₹{r['advance']:.0f}",
                         f"₹{r['fine']:.0f}", f"₹{r['manual_deduction']:.0f}",
                         f"₹{r['net_salary']:.0f}",
                         (r.get('payment_mode') or '—').upper(),
                         'PAID' if r.get('paid') else 'PENDING'])
        total = sum(float(r.get('net_salary') or 0) for r in
                     await db.payroll_entries.find({'year': year, 'month': month}, {'_id': 0}).to_list(1000))
        title = f"Payroll Report — {year}-{month:02d}"
        return _pdf_response(
            _report_pdf(title, f"Total Net: ₹{total:.0f}",
                         ['Code', 'Name', 'Base', 'P', 'HD', 'Su', 'Lv', 'Opening', 'Bonus', 'Adv', 'Fine', 'Ded', 'Net', 'Mode', 'Status'], rows),
            f'payroll-{year}-{month:02d}.pdf')

    if kind == 'ledger':
        if not employee_id:
            raise HTTPException(status_code=400, detail='employee_id required for ledger report')
        emp = await db.employees.find_one({'id': employee_id}, {'_id': 0, 'password_hash': 0})
        if not emp: raise HTTPException(status_code=404, detail='Employee not found')
        entries = await db.timeline.find({'employee_id': employee_id}, {'_id': 0}).sort('created_at', 1).to_list(2000)
        running = 0.0; out = []
        for e in entries:
            amount = float(e.get('amount') or 0)
            sign = e.get('sign', _ledger_sign(e.get('type', 'other')))
            delta = 0.0
            if e.get('type') in ('advance', 'bonus', 'fine', 'deduction'):
                delta = sign * abs(amount)
            elif e.get('type') == 'salary':
                delta = amount
            running += delta
            out.append([e.get('created_at', '')[:10], (e.get('type') or '').upper(),
                         e.get('title', ''),
                         (f"{'+' if delta > 0 else ''}₹{delta:.0f}" if delta else '—'),
                         f"₹{running:.0f}"])
        # Reverse to newest first
        out.reverse()
        return _pdf_response(
            _report_pdf(f'Ledger — {emp["name"]}', f"Closing balance: ₹{running:.0f}",
                         ['Date', 'Type', 'Description', 'Delta', 'Balance'], out),
            f'ledger-{emp.get("employee_code", "emp")}.pdf')

    if kind == 'repairs_outstanding':
        items = await db.repair_items.find({'status': {'$ne': 'delivered'}}, {'_id': 0}).sort('created_at', 1).to_list(2000)
        today_d = today_str()
        today_date = date.fromisoformat(today_d)
        rows = []
        for i in items:
            try:
                days = (today_date - date.fromisoformat(i.get('created_at', today_d)[:10])).days
            except ValueError:
                days = '—'
            rows.append([i['item_code'], i.get('customer_name', '—'), i['description'],
                         (i.get('status') or '').replace('_', ' ').title(),
                         i.get('karigar_name') or '—', f"{i['gross_weight']:.3f}g",
                         i.get('due_date') or '—', days])
        return _pdf_response(
            _report_pdf('Outstanding Repairs', f"{len(rows)} item(s) not yet delivered · as of {today_d}",
                         ['Tag', 'Customer', 'Item', 'Status', 'Karigar', 'Weight', 'Due Date', 'Days Pending'], rows),
            f'repairs-outstanding-{today_d}.pdf')

    raise HTTPException(status_code=400, detail=f'Unknown report kind: {kind}')
