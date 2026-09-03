"""Attendance: punches, calendar, corrections, leaves, shifts, holidays

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import datetime, timedelta, timezone, date
import re
import uuid
from server import (
    db,
    now_utc,
    today_str,
    haversine_m,
    get_current,
    require_owner,
    require_admin,
    require_staff,
    require_employee,
    require_module,
    require_admin_or_module_right,
    PunchIn,
    CorrectionIn,
    LeaveIn,
    DecisionIn,
    ShiftIn,
    HolidayIn,
    DepartmentIn,
    LocationIn,
    AttendanceDayIn,
    CalendarCorrectionIn,
    _get_store,
    _minutes,
    _apply_punch,
    _resolve_attendance_state,
    _iter_month_dates,
    log_audit,
    notify_user,
    _notify_module,
    IST,
)

router = APIRouter()

@router.post('/attendance/check-in')
async def check_in(body: PunchIn, user=Depends(require_employee)):
    store = await _get_store()
    if not store.get('app_checkin_enabled', True):
        raise HTTPException(status_code=403, detail='App check-in is currently turned off — attendance is tracked another way.')
    dist = haversine_m(body.latitude, body.longitude, store['latitude'], store['longitude'])
    if dist > float(store.get('radius_m', 150)):
        raise HTTPException(status_code=400, detail=f'Outside store area ({int(dist)}m away, allowed {int(store["radius_m"])}m).')
    if not body.selfie or len(body.selfie) < 100:
        raise HTTPException(status_code=400, detail='Selfie is required')

    now = now_utc()
    result = await _apply_punch(user, 'check_in', now, {
        'latitude': body.latitude, 'longitude': body.longitude,
        'selfie': body.selfie, 'distance_m': round(dist, 1),
    })
    if not result['ok']:
        raise HTTPException(status_code=400, detail='Already checked in today')

    now_local = now.astimezone(IST)
    await _notify_module('attendance', f"{user['name']} checked in",
                          f"{now_local.strftime('%I:%M %p')}{' · Late' if result['is_late'] else ''}", '/(tabs)/attendance',
                          script='attendance_checkin', subject_employee_id=user['id'])

    return {'ok': True, 'attendance_id': result['attendance_id'], 'is_late': result['is_late'], 'timestamp': result['timestamp']}


@router.post('/attendance/check-out')
async def check_out(body: PunchIn, user=Depends(require_employee)):
    store = await _get_store()
    if not store.get('app_checkin_enabled', True):
        raise HTTPException(status_code=403, detail='App check-out is currently turned off — attendance is tracked another way.')
    dist = haversine_m(body.latitude, body.longitude, store['latitude'], store['longitude'])
    if dist > float(store.get('radius_m', 150)):
        raise HTTPException(status_code=400, detail=f'Outside store area ({int(dist)}m away, allowed {int(store["radius_m"])}m).')
    if not body.selfie or len(body.selfie) < 100:
        raise HTTPException(status_code=400, detail='Selfie is required')

    now = now_utc()
    result = await _apply_punch(user, 'check_out', now, {
        'latitude': body.latitude, 'longitude': body.longitude,
        'selfie': body.selfie, 'distance_m': round(dist, 1),
    })
    if not result['ok']:
        detail = 'You must check in before checking out' if result['reason'] == 'no_check_in' else 'Already checked out today'
        raise HTTPException(status_code=400, detail=detail)

    hours = result['working_hours']
    await _notify_module('attendance', f"{user['name']} checked out",
                          f"Worked {hours}h today" + (' · Half day' if result['status'] == 'half_day' else ''), '/(tabs)/attendance',
                          script='attendance_checkout', subject_employee_id=user['id'])
    return {'ok': True, 'working_hours': hours, 'timestamp': result['timestamp']}


@router.get('/attendance/me/today')
async def my_today(user=Depends(require_employee)):
    doc = await db.attendance.find_one({'employee_id': user['id'], 'date': today_str()}, {'_id': 0})
    return doc or {}


@router.get('/attendance/today')
async def attendance_today(
    date_: Optional[str] = Query(default=None, alias='date'),
    department_id: Optional[str] = None,
    location_id: Optional[str] = None,
    _: dict = Depends(require_staff),
    _mod: dict = Depends(require_module('attendance')),
):
    """Returns one day's attendance for every employee — 'today' by default,
    or any date the owner picks via ?date=YYYY-MM-DD (the Attendance
    screen's date filter). For a past date the day is fully settled (no
    'still mid-shift' leniency); for today it stays live. Optionally narrowed
    to one department/location via the same master-backed ids employees are
    filtered by on GET /employees."""
    d = date_ or today_str()
    is_today = d == today_str()
    # 'photo' excluded in favor of photo_thumb (small avatar) — same
    # reasoning as GET /employees, and this endpoint is refetched on nearly
    # every Attendance screen visit.
    # Inactive (ex-)employees don't belong on the daily attendance list — only
    # active / on-leave staff. (on_leave still shows, with its leave status.)
    emp_query: dict = {'status': {'$ne': 'inactive'}}
    if department_id: emp_query['department_id'] = department_id
    if location_id: emp_query['location_id'] = location_id
    employees = await db.employees.find(emp_query, {'_id': 0, 'password_hash': 0, 'photo': 0}).sort('name', 1).to_list(1000)
    att_map = {}
    async for a in db.attendance.find({'date': d}, {'_id': 0, 'check_in.selfie': 0, 'check_out.selfie': 0}):
        att_map[a['employee_id']] = a

    # Approved leave covering this specific date — not the employee's
    # current (live) status flag, which only reflects "on leave right now"
    # and would be wrong for a past/future date being viewed.
    leave_map = {}
    async for l in db.leaves.find(
        {'status': 'approved', 'from_date': {'$lte': d}, 'to_date': {'$gte': d}}, {'_id': 0, 'employee_id': 1},
    ):
        leave_map[l['employee_id']] = True
    holiday_today = await db.holidays.find_one({'date': d}, {'_id': 0, 'id': 1})

    now_ist = now_utc().astimezone(IST)
    minutes_now = now_ist.hour * 60 + now_ist.minute
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    shifts_by_name = {}
    async for s in db.shifts.find({}, {'_id': 0}):
        shifts_by_name[s['name']] = s
    # Work-from-home shifts don't record attendance — drop those employees from
    # the daily list entirely (they show in Payroll instead).
    remote_shifts = {n for n, s in shifts_by_name.items() if s.get('remote')}
    employees = [e for e in employees if e.get('shift') not in remote_shifts]

    rows = []
    for e in employees:
        a = att_map.get(e['id'])
        shift = shifts_by_name.get(e.get('shift'))
        row = {
            'employee_id': e['id'], 'employee_code': e.get('employee_code'), 'name': e['name'],
            'department': e.get('department', ''), 'department_id': e.get('department_id'),
            'location_id': e.get('location_id'), 'designation': e.get('designation', ''),
            'shift': e.get('shift', ''), 'employee_status': e.get('status', 'active'),
            'photo': e.get('photo_thumb') or '',
        }
        if not a and (leave_map.get(e['id']) or (is_today and e.get('status') == 'on_leave')):
            row.update({'status': 'leave', 'check_in': None, 'check_out': None, 'is_late': False,
                        'working_hours': 0, 'missing_punch': False})
        elif not a and holiday_today:
            row.update({'status': 'holiday', 'check_in': None, 'check_out': None, 'is_late': False,
                        'working_hours': 0, 'missing_punch': False})
        else:
            state = _resolve_attendance_state(a, e, shift, store, is_today, minutes_now)
            row.update({
                'status': state['status'],
                'check_in': a.get('check_in', {}).get('timestamp') if a and a.get('check_in') else None,
                'check_out': a.get('check_out', {}).get('timestamp') if a and a.get('check_out') else None,
                'is_late': state['is_late'],
                'working_hours': (a or {}).get('working_hours', 0),
                'missing_punch': state['status'] == 'missing_punch',
            })
        rows.append(row)
    return rows


@router.get('/attendance/live')
async def attendance_live(limit: int = 120, _: dict = Depends(require_staff), _mod: dict = Depends(require_module('attendance'))):
    # Recent punch feed for the Attendance "Live" view — newest first, spanning
    # enough events to cover several days so the feed can be grouped date-wise.
    limit = max(1, min(limit, 500))
    events = await db.attendance_events.find({}, {'_id': 0}).sort('created_at', -1).limit(limit).to_list(limit)
    return events


# ---- Calendar view + edit ----
@router.get('/attendance/calendar/{emp_id}')
async def attendance_calendar(emp_id: str, year: int, month: int, user=Depends(get_current)):
    if user['role'] == 'employee' and user['id'] != emp_id:
        raise HTTPException(status_code=403, detail='Employees can view only their own calendar')
    emp = await db.employees.find_one({'id': emp_id}, {'_id': 0})
    if not emp:
        raise HTTPException(status_code=404, detail='Employee not found')
    from calendar import monthrange
    days = monthrange(year, month)[1]
    start = f'{year:04d}-{month:02d}-01'
    end = f'{year:04d}-{month:02d}-{days:02d}'
    att_map = {}
    async for a in db.attendance.find(
        {'employee_id': emp_id, 'date': {'$gte': start, '$lte': end}},
        {'_id': 0, 'check_in.selfie': 0, 'check_out.selfie': 0},
    ):
        att_map[a['date']] = a
    holidays: dict = {}
    async for h in db.holidays.find({'date': {'$gte': start, '$lte': end}}, {'_id': 0}):
        holidays[h['date']] = h
    leaves: list = []
    async for l in db.leaves.find({'employee_id': emp_id, 'status': 'approved'}, {'_id': 0}):
        leaves.append(l)

    shift = await db.shifts.find_one({'name': emp.get('shift')}, {'_id': 0})
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    now_ist = now_utc().astimezone(IST)
    today_ds = now_ist.date().isoformat()
    minutes_now = now_ist.hour * 60 + now_ist.minute

    days_out = []
    for d in _iter_month_dates(year, month):
        ds = d.isoformat()
        a = att_map.get(ds)
        # Determine effective status. A record's own resolved state (via
        # _resolve_attendance_state — the same logic Payroll and the live
        # Attendance screen use) takes priority once one exists; otherwise
        # fall back to holiday/leave/weekly-off/absent for a blank day.
        on_leave = any(l['from_date'] <= ds <= l['to_date'] for l in leaves)
        holiday = holidays.get(ds)
        if a:
            status = _resolve_attendance_state(a, emp, shift, store, ds == today_ds, minutes_now)['status']
        elif holiday:
            status = 'holiday'
        elif on_leave:
            status = 'leave'
        elif d.weekday() == 6:
            status = 'weekly_off'  # default paid weekly off (Sunday) when nothing else recorded
        else:
            status = 'absent'
        days_out.append({
            'date': ds, 'weekday': d.weekday(),  # 0=Mon
            'status': status,
            'is_sunday': d.weekday() == 6,
            'holiday_name': holiday['name'] if holiday else None,
            'check_in': a.get('check_in', {}).get('timestamp') if a and a.get('check_in') else None,
            'check_out': a.get('check_out', {}).get('timestamp') if a and a.get('check_out') else None,
            'is_late': a.get('is_late', False) if a else False,
            'working_hours': a.get('working_hours', 0) if a else 0,
            'via_correction': a.get('via_correction', False) if a else False,
            'has_record': bool(a),
        })
    return {'year': year, 'month': month, 'days': days_out}


def _combine_dt(date_str: str, hhmm: Optional[str]) -> Optional[str]:
    if not hhmm: return None
    try:
        h, m = hhmm.split(':')
        # Assume IST for display consistency; store UTC ISO
        d = date.fromisoformat(date_str)
        dt = datetime(d.year, d.month, d.day, int(h), int(m), tzinfo=IST)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return None


@router.put('/attendance/day/{emp_id}/{d}')
async def edit_day(emp_id: str, d: str, body: AttendanceDayIn, user=Depends(require_admin), _mod=Depends(require_module('attendance'))):
    emp = await db.employees.find_one({'id': emp_id}, {'_id': 0})
    if not emp:
        raise HTTPException(status_code=404, detail='Employee not found')
    iso = now_utc().isoformat()
    check_in_ts = _combine_dt(d, body.check_in_time)
    check_out_ts = _combine_dt(d, body.check_out_time)

    status = body.status
    working_hours = body.working_hours
    is_late = False
    half_day_reason = None
    NO_TIME_STATUSES = {'absent', 'leave', 'holiday', 'weekly_off'}

    if check_in_ts and check_out_ts:
        # Times were given — auto-calculate hours/status/lateness from the employee's shift,
        # overriding any manually-picked present/half_day toggle so the calendar always
        # reflects what the punch times actually mean.
        try:
            working_hours = round(
                (datetime.fromisoformat(check_out_ts) - datetime.fromisoformat(check_in_ts)).total_seconds() / 3600, 2
            )
        except Exception:
            working_hours = 0
        shift = await db.shifts.find_one({'name': emp.get('shift')}, {'_id': 0})
        shift_start = shift.get('start') if shift else None
        grace = int(shift.get('grace_min', 15)) if shift else 15
        late_half_day_after = int(shift.get('late_half_day_after_min') or 0) if shift else 0
        if not shift_start:
            store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
            shift_start = store.get('work_start', '10:00')
        late_by_min = 0
        try:
            in_local = datetime.fromisoformat(check_in_ts).astimezone(IST)
            minutes_in = in_local.hour * 60 + in_local.minute
            late_by_min = minutes_in - (_minutes(shift_start) + grace)
            is_late = late_by_min > 0
        except Exception:
            is_late = False
        # Late master: if the employee is late by more than the shift's configured
        # threshold, the day counts as a half-day for payroll even if full hours were
        # otherwise worked. A short-hours day (<4h) still takes priority either way.
        half_day_for_lateness = bool(late_half_day_after) and late_by_min >= late_half_day_after
        status = 'half_day' if (working_hours < 4 or half_day_for_lateness) else 'present'
        if status == 'half_day':
            half_day_reason = 'short_hours' if working_hours < 4 else 'late'
    elif status in NO_TIME_STATUSES:
        # Paid/unpaid day off — no punch times required, clear any partial ones.
        working_hours = 0
        check_in_ts = None
        check_out_ts = None
    else:
        working_hours = working_hours or 0

    doc = {
        'employee_id': emp_id, 'date': d,
        'check_in': {'timestamp': check_in_ts, 'edited': True} if check_in_ts else None,
        'check_out': {'timestamp': check_out_ts, 'edited': True} if check_out_ts else None,
        'working_hours': working_hours or 0,
        'status': status, 'is_late': is_late, 'half_day_reason': half_day_reason,
        'note': body.note or '', 'edited_by': user['name'], 'edited_at': iso,
    }
    existing = await db.attendance.find_one({'employee_id': emp_id, 'date': d}, {'_id': 0})
    if existing:
        await db.attendance.update_one({'id': existing['id']}, {'$set': doc})
        att_id = existing['id']
    else:
        att_id = str(uuid.uuid4())
        await db.attendance.insert_one({'id': att_id, **doc, 'created_at': iso})
    await log_audit(user, 'attendance.edit', 'attendance', att_id, f'{emp_id} · {d}',
                    {'status': body.status, 'check_in': check_in_ts, 'check_out': check_out_ts})
    return {'ok': True, 'attendance_id': att_id}


@router.delete('/attendance/day/{emp_id}/{d}')
async def delete_day(emp_id: str, d: str, user=Depends(require_admin), _mod=Depends(require_module('attendance'))):
    existing = await db.attendance.find_one({'employee_id': emp_id, 'date': d}, {'_id': 0})
    if not existing:
        raise HTTPException(status_code=404, detail='No attendance record for this day')
    await db.attendance.delete_one({'id': existing['id']})
    # Also clear any raw punch events logged for this employee within that IST day,
    # so a deleted entry doesn't linger in the "Live" feed.
    try:
        day_start_ist = datetime.fromisoformat(d).replace(tzinfo=IST)
        day_start_utc = day_start_ist.astimezone(timezone.utc)
        day_end_utc = day_start_utc + timedelta(days=1)
        await db.attendance_events.delete_many({
            'employee_id': emp_id,
            'timestamp': {'$gte': day_start_utc.isoformat(), '$lt': day_end_utc.isoformat()},
        })
    except Exception:
        pass
    await log_audit(user, 'attendance.delete', 'attendance', existing['id'], f'{emp_id} · {d}', {})
    return {'ok': True}


# Extend corrections to accept desired times when raised from calendar
@router.post('/attendance/corrections/calendar')
async def calendar_correction(body: CalendarCorrectionIn, user=Depends(require_employee)):
    iso = now_utc().isoformat()
    doc = {
        'id': str(uuid.uuid4()), 'employee_id': user['id'], 'employee_name': user['name'],
        'employee_code': user['employee_code'], 'date': body.date,
        'reason_type': body.reason_type, 'note': body.note or '',
        'desired_check_in': body.desired_check_in, 'desired_check_out': body.desired_check_out,
        'status': 'pending', 'created_at': iso, 'decided_by': None, 'decided_at': None, 'decision_note': '',
    }
    await db.corrections.insert_one(dict(doc))
    return {k: v for k, v in doc.items() if k != '_id'}

# ---------------- Corrections ----------------
@router.post('/attendance/corrections')
async def create_correction(body: CorrectionIn, user=Depends(require_employee)):
    iso = now_utc().isoformat()
    doc = {
        'id': str(uuid.uuid4()), 'employee_id': user['id'], 'employee_name': user['name'],
        'employee_code': user['employee_code'],
        'date': body.date or today_str(),
        'reason_type': body.reason_type, 'note': body.note or '',
        'status': 'pending', 'created_at': iso, 'decided_by': None, 'decided_at': None, 'decision_note': '',
    }
    await db.corrections.insert_one(dict(doc))
    await _notify_module('attendance', 'New attendance correction request',
                          f"{user['name']} requested a correction for {doc['date']}", '/approvals',
                          script='attendance_correction_request', admin_only=True)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.get('/attendance/corrections')
async def list_corrections(
    status_: Optional[str] = Query(default=None, alias='status'),
    user=Depends(get_current),
):
    query: dict = {}
    if status_: query['status'] = status_
    if user['role'] == 'employee': query['employee_id'] = user['id']
    return await db.corrections.find(query, {'_id': 0}).sort('created_at', -1).to_list(500)


@router.post('/attendance/corrections/{cid}/decide')
async def decide_correction(cid: str, body: DecisionIn, user=Depends(require_admin_or_module_right('approvals', 'edit'))):
    r = await db.corrections.find_one({'id': cid}, {'_id': 0})
    if not r: raise HTTPException(status_code=404, detail='Correction not found')
    if r['status'] != 'pending': raise HTTPException(status_code=400, detail='Already decided')
    new_status = 'approved' if body.action == 'approve' else 'rejected'
    await db.corrections.update_one({'id': cid}, {'$set': {
        'status': new_status, 'decided_by': user['name'], 'decided_at': now_utc().isoformat(),
        'decision_note': body.note or '',
    }})
    # If approved, add a stub attendance entry so it counts in payroll
    if new_status == 'approved':
        existing = await db.attendance.find_one({'employee_id': r['employee_id'], 'date': r['date']}, {'_id': 0})
        # If desired times were provided, apply them precisely; otherwise create a stub 8-hour day.
        desired_in = r.get('desired_check_in')
        desired_out = r.get('desired_check_out')
        if desired_in or desired_out:
            iso_in = _combine_dt(r['date'], desired_in) if desired_in else None
            iso_out = _combine_dt(r['date'], desired_out) if desired_out else None
            hours = 0
            if iso_in and iso_out:
                try:
                    hours = round((datetime.fromisoformat(iso_out) - datetime.fromisoformat(iso_in)).total_seconds() / 3600, 2)
                except Exception: hours = 0
            update = {
                'check_in': {'timestamp': iso_in, 'edited': True} if iso_in else None,
                'check_out': {'timestamp': iso_out, 'edited': True} if iso_out else None,
                'working_hours': hours, 'status': 'present' if hours >= 4 else 'half_day' if hours > 0 else 'present',
                'via_correction': True, 'edited_by': user['name'], 'edited_at': now_utc().isoformat(),
            }
            if existing:
                await db.attendance.update_one({'id': existing['id']}, {'$set': update})
            else:
                await db.attendance.insert_one({
                    'id': str(uuid.uuid4()), 'employee_id': r['employee_id'], 'date': r['date'],
                    'is_late': False, 'created_at': now_utc().isoformat(), **update,
                })
        elif not existing:
            await db.attendance.insert_one({
                'id': str(uuid.uuid4()), 'employee_id': r['employee_id'], 'date': r['date'],
                'check_in': None, 'check_out': None, 'is_late': False, 'working_hours': 8,
                'status': 'present', 'created_at': now_utc().isoformat(), 'via_correction': True,
            })
    await log_audit(user, f'correction.{new_status}', 'correction', cid, r.get('employee_code', ''))
    await notify_user(r['employee_id'], f'Correction {new_status}',
                       f"Your correction request for {r['date']} was {new_status}", '/leaves')
    return await db.corrections.find_one({'id': cid}, {'_id': 0})

# ---------------- Leaves ----------------
@router.post('/leaves')
async def create_leave(body: LeaveIn, user=Depends(require_employee)):
    iso = now_utc().isoformat()
    doc = {
        'id': str(uuid.uuid4()), 'employee_id': user['id'], 'employee_name': user['name'],
        'employee_code': user['employee_code'],
        'from_date': body.from_date, 'to_date': body.to_date, 'leave_type': body.leave_type,
        'reason': body.reason or '', 'status': 'pending', 'created_at': iso,
        'decided_by': None, 'decided_at': None, 'decision_note': '',
    }
    await db.leaves.insert_one(dict(doc))
    await log_audit(user, 'leave.create', 'leave', doc['id'], user['name'], {'from': doc['from_date'], 'to': doc['to_date']})
    await _notify_module('attendance', 'New leave request',
                          f"{user['name']} requested leave {doc['from_date']} to {doc['to_date']}", '/approvals',
                          script='attendance_leave_request', admin_only=True)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.get('/leaves')
async def list_leaves(
    status_: Optional[str] = Query(default=None, alias='status'),
    user=Depends(get_current),
):
    query: dict = {}
    if status_: query['status'] = status_
    if user['role'] == 'employee': query['employee_id'] = user['id']
    return await db.leaves.find(query, {'_id': 0}).sort('created_at', -1).to_list(500)


@router.post('/leaves/{lid}/decide')
async def decide_leave(lid: str, body: DecisionIn, user=Depends(require_admin_or_module_right('approvals', 'edit'))):
    l = await db.leaves.find_one({'id': lid}, {'_id': 0})
    if not l: raise HTTPException(status_code=404, detail='Leave not found')
    if l['status'] != 'pending': raise HTTPException(status_code=400, detail='Already decided')
    new_status = 'approved' if body.action == 'approve' else 'rejected'
    await db.leaves.update_one({'id': lid}, {'$set': {
        'status': new_status, 'decided_by': user['name'], 'decided_at': now_utc().isoformat(),
        'decision_note': body.note or '',
    }})
    if new_status == 'approved':
        # Add timeline event
        await db.timeline.insert_one({
            'id': str(uuid.uuid4()), 'employee_id': l['employee_id'], 'type': 'leave',
            'title': f"Leave: {l['leave_type'].title()}",
            'description': f"{l['from_date']} → {l['to_date']}", 'amount': 0,
            'created_at': now_utc().isoformat(),
        })
    await notify_user(l['employee_id'], f'Leave {new_status}',
                       f"Your leave request ({l['from_date']} → {l['to_date']}) was {new_status}", '/leaves')
    await log_audit(user, f'leave.{new_status}', 'leave', lid, l.get('employee_code', ''))
    return await db.leaves.find_one({'id': lid}, {'_id': 0})

# ---------------- Shifts ----------------
@router.get('/shifts')
async def list_shifts(_: dict = Depends(get_current)):
    return await db.shifts.find({}, {'_id': 0}).sort('start', 1).to_list(50)


@router.post('/shifts')
async def create_shift(body: ShiftIn, user: dict = Depends(require_owner), _mod=Depends(require_module('shifts'))):
    doc = {'id': str(uuid.uuid4()), **body.model_dump(), 'created_at': now_utc().isoformat()}
    await db.shifts.insert_one(dict(doc))
    await log_audit(user, 'shift.create', 'shift', doc['id'], body.name)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.put('/shifts/{sid}')
async def update_shift(sid: str, body: ShiftIn, user: dict = Depends(require_owner), _mod=Depends(require_module('shifts'))):
    if not await db.shifts.find_one({'id': sid}):
        raise HTTPException(status_code=404, detail='Shift not found')
    await db.shifts.update_one({'id': sid}, {'$set': body.model_dump()})
    await log_audit(user, 'shift.update', 'shift', sid, body.name)
    return await db.shifts.find_one({'id': sid}, {'_id': 0})


@router.delete('/shifts/{sid}')
async def delete_shift(sid: str, user: dict = Depends(require_owner), _mod=Depends(require_module('shifts'))):
    existing = await db.shifts.find_one({'id': sid}, {'_id': 0})
    r = await db.shifts.delete_one({'id': sid})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail='Shift not found')
    await log_audit(user, 'shift.delete', 'shift', sid, (existing or {}).get('name', ''))
    return {'ok': True}


# ---------------- Holidays ----------------
@router.get('/holidays')
async def list_holidays(_: dict = Depends(get_current)):
    return await db.holidays.find({}, {'_id': 0}).sort('date', 1).to_list(500)


@router.post('/holidays')
async def create_holiday(body: HolidayIn, user: dict = Depends(require_owner), _mod=Depends(require_module('holidays'))):
    doc = {'id': str(uuid.uuid4()), **body.model_dump(), 'created_at': now_utc().isoformat()}
    await db.holidays.insert_one(dict(doc))
    await log_audit(user, 'holiday.create', 'holiday', doc['id'], body.name)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.delete('/holidays/{hid}')
async def delete_holiday(hid: str, user: dict = Depends(require_owner), _mod=Depends(require_module('holidays'))):
    existing = await db.holidays.find_one({'id': hid}, {'_id': 0})
    r = await db.holidays.delete_one({'id': hid})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail='Holiday not found')
    await log_audit(user, 'holiday.delete', 'holiday', hid, (existing or {}).get('name', ''))
    return {'ok': True}


# ---------------- Departments ----------------
@router.get('/departments')
async def list_departments(_: dict = Depends(get_current)):
    return await db.departments.find({}, {'_id': 0}).sort('name', 1).to_list(200)


@router.post('/departments')
async def create_department(body: DepartmentIn, user: dict = Depends(require_owner), _mod=Depends(require_module('departments'))):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail='Name is required')
    if await db.departments.find_one({'name': {'$regex': f'^{re.escape(name)}$', '$options': 'i'}}):
        raise HTTPException(status_code=400, detail='A department with this name already exists')
    doc = {'id': str(uuid.uuid4()), 'name': name, 'is_active': body.is_active, 'created_at': now_utc().isoformat()}
    await db.departments.insert_one(dict(doc))
    await log_audit(user, 'department.create', 'department', doc['id'], name)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.put('/departments/{did}')
async def update_department(did: str, body: DepartmentIn, user: dict = Depends(require_owner), _mod=Depends(require_module('departments'))):
    if not await db.departments.find_one({'id': did}):
        raise HTTPException(status_code=404, detail='Department not found')
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail='Name is required')
    await db.departments.update_one({'id': did}, {'$set': {'name': name, 'is_active': body.is_active}})
    await log_audit(user, 'department.update', 'department', did, name)
    return await db.departments.find_one({'id': did}, {'_id': 0})


@router.delete('/departments/{did}')
async def delete_department(did: str, user: dict = Depends(require_owner), _mod=Depends(require_module('departments'))):
    existing = await db.departments.find_one({'id': did}, {'_id': 0})
    if not existing:
        raise HTTPException(status_code=404, detail='Department not found')
    used = await db.employees.count_documents({'department_id': did})
    if used > 0:
        raise HTTPException(status_code=400, detail=f'{used} employee(s) use this department — reassign them first')
    await db.departments.delete_one({'id': did})
    await log_audit(user, 'department.delete', 'department', did, existing.get('name', ''))
    return {'ok': True}


# ---------------- Locations / Branches ----------------
@router.get('/locations')
async def list_locations(_: dict = Depends(get_current)):
    return await db.locations.find({}, {'_id': 0}).sort('name', 1).to_list(200)


@router.post('/locations')
async def create_location(body: LocationIn, user: dict = Depends(require_owner), _mod=Depends(require_module('locations'))):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail='Name is required')
    if await db.locations.find_one({'name': {'$regex': f'^{re.escape(name)}$', '$options': 'i'}}):
        raise HTTPException(status_code=400, detail='A location with this name already exists')
    doc = {
        'id': str(uuid.uuid4()), 'name': name, 'address': (body.address or '').strip(),
        'is_active': body.is_active, 'created_at': now_utc().isoformat(),
    }
    await db.locations.insert_one(dict(doc))
    await log_audit(user, 'location.create', 'location', doc['id'], name)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.put('/locations/{lid}')
async def update_location(lid: str, body: LocationIn, user: dict = Depends(require_owner), _mod=Depends(require_module('locations'))):
    if not await db.locations.find_one({'id': lid}):
        raise HTTPException(status_code=404, detail='Location not found')
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail='Name is required')
    await db.locations.update_one({'id': lid}, {'$set': {'name': name, 'address': (body.address or '').strip(), 'is_active': body.is_active}})
    await log_audit(user, 'location.update', 'location', lid, name)
    return await db.locations.find_one({'id': lid}, {'_id': 0})


@router.delete('/locations/{lid}')
async def delete_location(lid: str, user: dict = Depends(require_owner), _mod=Depends(require_module('locations'))):
    existing = await db.locations.find_one({'id': lid}, {'_id': 0})
    if not existing:
        raise HTTPException(status_code=404, detail='Location not found')
    used = await db.employees.count_documents({'location_id': lid})
    if used > 0:
        raise HTTPException(status_code=400, detail=f'{used} employee(s) use this location — reassign them first')
    await db.locations.delete_one({'id': lid})
    await log_audit(user, 'location.delete', 'location', lid, existing.get('name', ''))
    return {'ok': True}
