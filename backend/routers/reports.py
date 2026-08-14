"""Dashboard, Audit log, PDF reports

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from datetime import date
from server import (
    db,
    today_str,
    get_current,
    require_owner,
    require_staff,
    require_module,
    _karigar_ledger_balances,
    _report_pdf,
    _pdf_response,
    _ledger_sign,
)

router = APIRouter()

# ---------------- Dashboard ----------------
@router.get('/dashboard')
async def dashboard(_: dict = Depends(get_current)):
    d = today_str()
    total = await db.employees.count_documents({})
    on_leave_status = await db.employees.count_documents({'status': 'on_leave'})

    att = await db.attendance.find({'date': d}, {'_id': 0, 'check_in.selfie': 0, 'check_out.selfie': 0}).to_list(1000)
    present = sum(1 for a in att if a.get('status') == 'present' and a.get('check_in'))
    half_day = sum(1 for a in att if a.get('status') == 'half_day')
    late = sum(1 for a in att if a.get('is_late'))
    missing_punch = sum(1 for a in att if a.get('check_in') and not a.get('check_out'))
    working = sum(1 for a in att if a.get('check_in') and not a.get('check_out'))
    marked_ids = {a['employee_id'] for a in att}
    absent = max(total - len(marked_ids) - on_leave_status, 0)

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

    return {
        'todays_attendance': {
            'present': present, 'absent': absent, 'late': late, 'half_day': half_day,
            'missing_punch': missing_punch, 'leave': on_leave_status, 'working': working,
            'total': total,
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
        'business_summary': {
            'revenue_today': round(revenue_today, 2), 'revenue_month': round(revenue_month, 2),
            'intake_today': intake_today, 'active_employees': active_employees,
            'customers_open': customers_open, 'karigars_open': karigars_open,
        },
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
        q = {'date': {'$gte': frm, '$lte': to}, 'check_in': {'$ne': None}, 'check_out': None}
        if employee_id: q['employee_id'] = employee_id
        rows = []
        emp_map = {e['id']: e async for e in db.employees.find({}, {'_id': 0, 'password_hash': 0, 'photo': 0})}
        async for a in db.attendance.find(q, {'_id': 0, 'check_in.selfie': 0}).sort('date', 1):
            e = emp_map.get(a['employee_id'], {})
            rows.append([a['date'], e.get('employee_code', '—'), e.get('name', '—'),
                         (a.get('check_in') or {}).get('timestamp', '') or '—'])
        return _pdf_response(
            _report_pdf('Missing Punch Report', f"{frm} to {to}",
                         ['Date', 'Code', 'Employee', 'Check In'], rows),
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
