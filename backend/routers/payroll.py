"""Employee ledger (advances/loans) + Payroll compute/save/lock/pay

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Literal
from datetime import timedelta, date
import uuid
from server import (
    db,
    now_utc,
    get_current,
    require_owner,
    require_admin,
    require_staff,
    require_payroll_writer,
    require_module,
    LedgerEntryIn,
    LedgerEntryEdit,
    PayrollGenerateIn,
    PayrollEntryUpdateIn,
    log_audit,
    notify_user,
    _ledger_sign,
    _iter_month_dates,
    _opening_balance,
    _resolve_attendance_state,
    IST,
)

router = APIRouter()

# ---------------- Ledger ----------------
@router.post('/ledger/entries')
async def add_ledger_entry(body: LedgerEntryIn, user=Depends(require_staff), _mod=Depends(require_module('payroll'))):
    emp = await db.employees.find_one({'id': body.employee_id}, {'_id': 0})
    if not emp: raise HTTPException(status_code=404, detail='Employee not found')
    iso = now_utc().isoformat()
    when = body.date or iso
    # Timeline event doubles as ledger entry.
    title_map = {'advance': 'Salary Advance', 'bonus': 'Bonus', 'fine': 'Fine',
                 'deduction': 'Deduction', 'other': 'Other'}
    doc = {
        'id': str(uuid.uuid4()), 'employee_id': body.employee_id, 'type': body.entry_type,
        'title': title_map.get(body.entry_type, 'Ledger Entry'),
        'description': body.note or '', 'amount': float(body.amount),
        'sign': _ledger_sign(body.entry_type), 'created_at': when, 'added_by': user['name'],
    }
    await db.timeline.insert_one(dict(doc))
    if body.entry_type in ('advance', 'bonus', 'fine', 'deduction'):
        _y, _m = _entry_year_month(doc)
        if _y:
            await _refresh_unpaid_payroll(body.employee_id, _y, _m)
    await log_audit(user, 'ledger.create', 'ledger', doc['id'], emp.get('employee_code', ''),
                     {'type': body.entry_type, 'amount': body.amount})
    # Personal alert to the employee when money is recorded against/for them.
    if body.entry_type in ('advance', 'bonus', 'fine', 'deduction'):
        label = title_map.get(body.entry_type, 'Ledger entry')
        await notify_user(
            body.employee_id,
            f'{label}: ₹{float(body.amount):,.0f}',
            (body.note or '').strip() or f'{label} recorded on your account.',
            '/(emp)/profile',
        )
    return {k: v for k, v in doc.items() if k != '_id'}


@router.get('/ledger/{emp_id}')
async def get_ledger(emp_id: str, user: dict = Depends(get_current)):
    # Staff can view anyone's ledger; an employee can only view their own (read-only
    # on the frontend — the edit/delete endpoints below stay require_admin).
    if user.get('role') == 'employee':
        if user['id'] != emp_id:
            raise HTTPException(status_code=403, detail='Staff access required')
    elif user.get('role') not in ('owner', 'admin', 'accountant'):
        raise HTTPException(status_code=403, detail='Staff access required')
    if not await db.employees.find_one({'id': emp_id}):
        raise HTTPException(status_code=404, detail='Employee not found')
    events = await db.timeline.find({'employee_id': emp_id}, {'_id': 0}).sort('created_at', 1).to_list(2000)
    running = 0.0
    entries = []
    for e in events:
        amount = float(e.get('amount') or 0)
        t = e.get('type', 'other')
        sign = e.get('sign', _ledger_sign(t))
        # Only monetary events affect balance.
        #   salary / salary_earned : credit (+, shop owed the employee)
        #   salary_paid            : debit  (-, cash paid out)
        #   advance/fine/deduction : debit;  bonus : credit (via _ledger_sign)
        if t in ('advance', 'bonus', 'fine', 'deduction', 'salary', 'salary_earned', 'salary_paid'):
            if t in ('salary', 'salary_earned'):
                delta = abs(amount)
            elif t == 'salary_paid':
                delta = -abs(amount)
            else:
                delta = sign * abs(amount)
            running += delta
            entries.append({**e, 'delta': delta, 'balance': round(running, 2)})
        else:
            entries.append({**e, 'delta': 0, 'balance': round(running, 2)})
    # Newest first for display
    entries.sort(key=lambda x: x.get('created_at') or '', reverse=True)
    return {'entries': entries, 'closing_balance': round(running, 2)}


@router.get('/ledger/{emp_id}/month/{year}/{month}')
async def get_ledger_month(emp_id: str, year: int, month: int, type: Optional[str] = None, user: dict = Depends(get_current)):
    """Drill-down for one payroll month: just the ledger entries of one type
    (advance/bonus/fine/deduction) that fed into that month's payroll figure —
    used by the tappable Advance/Bonus/Fine rows on the payroll breakdown so
    the owner can see and correct exactly what's behind the number."""
    if user.get('role') == 'employee':
        if user['id'] != emp_id:
            raise HTTPException(status_code=403, detail='Staff access required')
    elif user.get('role') not in ('owner', 'admin', 'accountant'):
        raise HTTPException(status_code=403, detail='Staff access required')
    if not await db.employees.find_one({'id': emp_id}):
        raise HTTPException(status_code=404, detail='Employee not found')
    start, end, _ = _month_bounds(year, month)
    query: dict = {'employee_id': emp_id, 'created_at': {'$gte': start, '$lte': f'{end}T23:59:59'}}
    if type:
        query['type'] = type
    entries = await db.timeline.find(query, {'_id': 0}).sort('created_at', 1).to_list(200)
    total = round(sum(float(e.get('amount') or 0) for e in entries), 2)
    return {'entries': entries, 'total': total}


_LEDGER_EDITABLE_TYPES = ('advance', 'bonus', 'fine', 'deduction', 'other')
_LEDGER_TITLE_MAP = {'advance': 'Salary Advance', 'bonus': 'Bonus', 'fine': 'Fine',
                      'deduction': 'Deduction', 'other': 'Other'}


@router.put('/ledger/entries/{entry_id}')
async def edit_ledger_entry(entry_id: str, body: LedgerEntryEdit, user=Depends(require_admin), _mod=Depends(require_module('payroll'))):
    existing = await db.timeline.find_one({'id': entry_id}, {'_id': 0})
    if not existing:
        raise HTTPException(status_code=404, detail='Ledger entry not found')
    if existing.get('type') not in _LEDGER_EDITABLE_TYPES:
        raise HTTPException(status_code=400, detail='This entry cannot be edited')
    update = {
        'type': body.entry_type,
        'title': _LEDGER_TITLE_MAP.get(body.entry_type, 'Ledger Entry'),
        'description': body.note or '',
        'amount': float(body.amount),
        'sign': _ledger_sign(body.entry_type),
    }
    await db.timeline.update_one({'id': entry_id}, {'$set': update})
    _y, _m = _entry_year_month(existing)
    if _y and existing.get('employee_id'):
        await _refresh_unpaid_payroll(existing['employee_id'], _y, _m)
    await log_audit(user, 'ledger.edit', 'ledger', entry_id,
                     f"{existing.get('employee_id')} · {update['title']} · {update['amount']}", {})
    return {**existing, **update}


@router.delete('/ledger/entries/{entry_id}')
async def delete_ledger_entry(entry_id: str, user=Depends(require_admin), _mod=Depends(require_module('payroll'))):
    existing = await db.timeline.find_one({'id': entry_id}, {'_id': 0})
    if not existing:
        raise HTTPException(status_code=404, detail='Ledger entry not found')
    if existing.get('type') not in _LEDGER_EDITABLE_TYPES:
        raise HTTPException(status_code=400, detail='This entry cannot be deleted')
    await db.timeline.delete_one({'id': entry_id})
    _y, _m = _entry_year_month(existing)
    if _y and existing.get('employee_id'):
        await _refresh_unpaid_payroll(existing['employee_id'], _y, _m)
    await log_audit(user, 'ledger.delete', 'ledger', entry_id,
                     f"{existing.get('employee_id')} · {existing.get('title')} · {existing.get('amount')}", {})
    return {'ok': True}


# ---------------- Payroll ----------------
def _month_bounds(year: int, month: int) -> tuple:
    from calendar import monthrange
    start = f"{year:04d}-{month:02d}-01"
    last_day = monthrange(year, month)[1]
    end = f"{year:04d}-{month:02d}-{last_day:02d}"
    return start, end, last_day


async def _compute_payroll(year: int, month: int) -> list:
    start, end, total_days = _month_bounds(year, month)
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    round_nearest_10 = bool(store.get('round_net_salary'))
    shifts_by_name = {}
    async for s in db.shifts.find({}, {'_id': 0}):
        shifts_by_name[s['name']] = s
    now_ist = now_utc().astimezone(IST)
    today_ds = now_ist.date().isoformat()
    minutes_now = now_ist.hour * 60 + now_ist.minute

    # Attendance in month, keyed by date so each employee's day can be
    # looked up and resolved individually.
    att_by_emp: dict = {}
    async for a in db.attendance.find({'date': {'$gte': start, '$lte': end}}, {'_id': 0, 'check_in.selfie': 0, 'check_out.selfie': 0}):
        att_by_emp.setdefault(a['employee_id'], {})[a['date']] = a
    # Approved leaves in month
    leaves_by_emp: dict = {}
    async for l in db.leaves.find({'status': 'approved'}, {'_id': 0}):
        if l['from_date'] <= end and l['to_date'] >= start:
            leaves_by_emp.setdefault(l['employee_id'], []).append(l)
    # Holidays in month
    holidays = set()
    async for h in db.holidays.find({'date': {'$gte': start, '$lte': end}}, {'_id': 0, 'date': 1}):
        holidays.add(h['date'])
    all_month_dates = [d.isoformat() for d in _iter_month_dates(year, month)]
    # Ledger entries in month (advance/bonus/fine/deduction). An entry
    # normally counts toward whichever month its created_at falls in — but
    # an auto-advance is explicitly an early payout against the month that
    # just ended (paid on e.g. the 1st of the next month, before that
    # month's payroll is finalized), so it's tagged with for_month at
    # creation time (see _check_auto_advances) and must be matched against
    # THAT month here regardless of when it was actually created.
    month_ym = f'{year:04d}-{month:02d}'
    ledger_by_emp: dict = {}
    async for t in db.timeline.find(
        {
            'type': {'$in': ['advance', 'bonus', 'fine', 'deduction']},
            '$or': [
                {'for_month': month_ym},
                {'for_month': {'$in': [None, '']}, 'created_at': {'$gte': start, '$lte': f'{end}T23:59:59'}},
            ],
        },
        {'_id': 0},
    ):
        ledger_by_emp.setdefault(t['employee_id'], []).append(t)

    rows = []
    # 'photo' excluded in favor of photo_thumb (small avatar) — this list is
    # recomputed on every Payroll screen visit, same reasoning as
    # GET /employees and GET /attendance/today.
    async for e in db.employees.find({}, {'_id': 0, 'password_hash': 0, 'photo': 0}):
        att_by_date = att_by_emp.get(e['id'], {})
        shift = shifts_by_name.get(e.get('shift'))

        # Approved leaves -> exact set of covered dates within this month.
        # Only status == 'approved' leaves ever reach leaves_by_emp (see the
        # query above) — a pending/rejected leave request is NOT paid leave,
        # it falls through to a normal attendance/absent day like any other
        # unapproved day off, per the owner/admin-approval rule.
        leave_days = 0
        leave_dates = set()
        for l in leaves_by_emp.get(e['id'], []):
            try:
                fd = max(date.fromisoformat(l['from_date']), date.fromisoformat(start))
                td = min(date.fromisoformat(l['to_date']), date.fromisoformat(end))
                if td >= fd:
                    leave_days += (td - fd).days + 1
                    dd = fd
                    while dd <= td:
                        leave_dates.add(dd.isoformat())
                        dd += timedelta(days=1)
            except Exception: pass

        # Classify every day of the month exactly once — the single source
        # of truth for both the paid-days math below and the counts shown
        # on the Payroll row. A day only counts as a full 'present' day if
        # it resolves that way via _resolve_attendance_state, which
        # requires BOTH a check-in and a check-out within shift timing (a
        # checked-in-but-never-checked-out day settles to 'missing_punch',
        # not 'present' — no free full-day pay just for showing up).
        day_state: dict = {}
        late_days = 0
        for ds in all_month_dates:
            if ds in leave_dates:
                day_state[ds] = 'leave'
                continue
            a = att_by_date.get(ds)
            if a and a.get('status') in ('holiday', 'weekly_off'):
                day_state[ds] = a['status']
                continue
            if ds in holidays:
                day_state[ds] = 'holiday'
                continue
            is_sunday = date.fromisoformat(ds).weekday() == 6
            if not a:
                if ds > today_ds:
                    # A day that hasn't happened yet (payroll run mid-month,
                    # before the month is over) is neither paid nor absent —
                    # including a not-yet-arrived Sunday, which shouldn't be
                    # auto-paid before it's actually occurred.
                    day_state[ds] = 'future'
                elif is_sunday:
                    day_state[ds] = 'weekly_off'
                else:
                    day_state[ds] = 'absent'
                continue
            state = _resolve_attendance_state(a, e, shift, store, ds == today_ds, minutes_now)
            day_state[ds] = state['status']  # present | half_day | missing_punch | absent
            if state.get('is_late'):
                late_days += 1  # a present/half day where the employee arrived late

        # Sunday pay is forfeited for a week where every scheduled workday
        # (Mon-Sat) was a genuine absence — applied only to a Sunday that
        # would otherwise be the default auto-paid weekly-off, and only
        # when the full Mon-Sat block preceding it falls entirely inside
        # this month (a partial week at the very start of the month isn't
        # judged on data this payroll run doesn't have).
        for ds in all_month_dates:
            d_obj = date.fromisoformat(ds)
            if d_obj.weekday() != 6 or day_state.get(ds) != 'weekly_off':
                continue
            week_start = d_obj - timedelta(days=6)
            if week_start.isoformat() < start:
                continue
            week_days = [(week_start + timedelta(days=i)).isoformat() for i in range(6)]
            if all(day_state.get(wd) == 'absent' for wd in week_days):
                day_state[ds] = 'absent'

        present = sum(1 for v in day_state.values() if v == 'present')
        half = sum(1 for v in day_state.values() if v == 'half_day')
        missing_punch = sum(1 for v in day_state.values() if v == 'missing_punch')
        absent = sum(1 for v in day_state.values() if v == 'absent')
        holiday_days = sum(1 for v in day_state.values() if v == 'holiday')
        weekly_off_days = sum(1 for v in day_state.values() if v == 'weekly_off')
        # Sunday-work bonus: half a day's extra pay for a Sunday that
        # resolved to a real present/half-day (shop opened, employee
        # actually worked it) — on top of normal pay for that day, not
        # instead of it.
        sunday_work = sum(
            1 for ds in all_month_dates
            if date.fromisoformat(ds).weekday() == 6 and day_state.get(ds) in ('present', 'half_day')
        )

        base = float(e.get('salary') or 0)
        per_day = base / total_days if total_days > 0 else 0
        # Effective days paid: present + 0.5*half + paid leaves/holidays/weekly-offs
        # (minus any Sunday forfeited above by the whole-week-absent rule).
        effective = present + 0.5 * half + leave_days + holiday_days + weekly_off_days
        earned = round(per_day * min(effective, total_days) + per_day * 0.5 * sunday_work, 2)

        # Work-from-home shift: no attendance is tracked, so pay the full set
        # salary for the month. Nothing is counted as absent/late/half; the
        # whole month reads as paid days. Ledger entries (advance/bonus/fine)
        # and opening balance still apply below, exactly like any other row.
        is_remote = bool(shift and shift.get('remote'))
        if is_remote:
            present = total_days
            half = missing_punch = absent = 0
            holiday_days = weekly_off_days = sunday_work = late_days = 0
            leave_days = 0
            effective = total_days
            earned = round(base, 2)

        # Ledger tallies in month
        month_advance = 0.0
        month_bonus = 0.0
        month_fine = 0.0
        month_deduction = 0.0
        for t in ledger_by_emp.get(e['id'], []):
            amt = float(t.get('amount') or 0)
            if t['type'] == 'advance': month_advance += amt
            elif t['type'] == 'bonus': month_bonus += amt
            elif t['type'] == 'fine': month_fine += amt
            elif t['type'] == 'deduction': month_deduction += amt

        net = round(earned + month_bonus - month_advance - month_fine - month_deduction, 2)
        opening = await _opening_balance(e['id'], start)
        net_with_opening = round(net + opening, 2)
        net_rounded = round(net_with_opening / 10) * 10 if round_nearest_10 else net_with_opening
        rows.append({
            'employee_id': e['id'], 'employee_code': e.get('employee_code'), 'name': e['name'],
            'designation': e.get('designation'), 'department': e.get('department'), 'photo': e.get('photo_thumb') or '',
            'remote': is_remote,
            'base_salary': base, 'present_days': present, 'half_days': half,
            'absent_days': absent, 'missing_punch_days': missing_punch,
            'sunday_work': sunday_work, 'leave_days': leave_days, 'late_days': late_days,
            'holiday_days': holiday_days, 'weekly_off_days': weekly_off_days,
            'total_days': total_days, 'effective_days': round(min(effective, total_days), 2),
            'per_day_rate': round(per_day, 2),
            'earned': earned, 'advance': round(month_advance, 2), 'bonus': round(month_bonus, 2),
            'fine': round(month_fine, 2), 'manual_deduction': round(month_deduction, 2),
            'opening_balance': opening,
            'net_salary_exact': net_with_opening,
            'net_salary': net_rounded,
        })
    return rows


async def _upsert_salary_earned(employee_id: str, year: int, month: int, earned: float, entry_id: str) -> None:
    """Post/refresh the month's salary as a RECEIVABLE (owed to the employee) in
    the wage ledger the moment payroll is generated — so the ledger shows what's
    owed before payment, and a later payment (salary_paid) clears it. Idempotent
    per employee+month."""
    ym = f"{year}-{month:02d}"
    doc_set = {
        'title': f'Salary earned {ym}', 'description': f'Earned ₹{earned:.0f}',
        'amount': round(float(earned or 0), 2), 'sign': 1, 'year': year, 'month': month, 'entry_id': entry_id,
    }
    existing = await db.timeline.find_one(
        {'employee_id': employee_id, 'type': 'salary_earned', 'year': year, 'month': month}, {'_id': 0, 'id': 1},
    )
    if existing:
        await db.timeline.update_one({'id': existing['id']}, {'$set': doc_set})
    else:
        await db.timeline.insert_one({
            'id': str(uuid.uuid4()), 'employee_id': employee_id, 'type': 'salary_earned',
            'created_at': now_utc().isoformat(), **doc_set,
        })


async def _refresh_unpaid_payroll(employee_id: str, year: int, month: int) -> None:
    """Recompute a saved-but-unpaid payroll entry from the current attendance +
    ledger — so deleting/adding an advance (or bonus/fine/deduction) in the
    ledger flows straight through to that month's payroll instead of showing a
    stale figure. No-op if the month is locked, already paid, or not saved."""
    lock = await db.payroll_locks.find_one({'year': year, 'month': month}, {'_id': 0})
    if lock and lock.get('locked'):
        return
    existing = await db.payroll_entries.find_one({'year': year, 'month': month, 'employee_id': employee_id}, {'_id': 0})
    if not existing or existing.get('paid'):
        return
    rows = await _compute_payroll(year, month)
    r = next((x for x in rows if x['employee_id'] == employee_id), None)
    if not r:
        return
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    net_exact = round(r['earned'] + r['bonus'] - r['advance'] - r['fine'] - r['manual_deduction'] + r['opening_balance'], 2)
    net_salary = round(net_exact / 10) * 10 if store.get('round_net_salary') else net_exact
    await db.payroll_entries.update_one(
        {'id': existing['id']}, {'$set': {**r, 'net_salary_exact': net_exact, 'net_salary': net_salary}},
    )
    await _upsert_salary_earned(employee_id, year, month, r['earned'], existing['id'])


def _entry_year_month(e: dict) -> tuple:
    """Which payroll month a ledger entry belongs to — its for_month tag if
    present (auto-advances set this), else the month of its date/created_at."""
    fm = e.get('for_month')
    if isinstance(fm, str) and len(fm) >= 7 and fm[4] == '-':
        try:
            return int(fm[:4]), int(fm[5:7])
        except ValueError:
            pass
    c = (e.get('created_at') or e.get('date') or '')[:7]
    try:
        return int(c[:4]), int(c[5:7])
    except ValueError:
        return 0, 0


@router.post('/payroll/compute')
async def payroll_compute(body: PayrollGenerateIn, _: dict = Depends(require_payroll_writer), _mod=Depends(require_module('payroll'))):
    rows = await _compute_payroll(body.year, body.month)
    lock = await db.payroll_locks.find_one({'year': body.year, 'month': body.month}, {'_id': 0})
    return {
        'year': body.year, 'month': body.month, 'rows': rows,
        'total_net': round(sum(r['net_salary'] for r in rows), 2),
        'locked': bool(lock and lock.get('locked')),
        'generated_at': lock.get('generated_at') if lock else None,
    }


@router.post('/payroll/save')
async def payroll_save(body: PayrollGenerateIn, user=Depends(require_payroll_writer), _mod=Depends(require_module('payroll'))):
    lock = await db.payroll_locks.find_one({'year': body.year, 'month': body.month}, {'_id': 0})
    if lock and lock.get('locked'):
        raise HTTPException(status_code=400, detail='Payroll is locked for this month')
    rows = await _compute_payroll(body.year, body.month)
    iso = now_utc().isoformat()

    existing_entries = await db.payroll_entries.find({'year': body.year, 'month': body.month}, {'_id': 0}).to_list(1000)
    existing_by_emp = {e['employee_id']: e for e in existing_entries}
    is_regenerate = len(existing_entries) > 0

    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    round_nearest_10 = bool(store.get('round_net_salary'))

    refreshed, kept_paid = 0, 0
    for r in rows:
        prior = existing_by_emp.get(r['employee_id'])
        if prior and prior.get('paid'):
            # Never touch an already-paid entry when regenerating after attendance edits.
            kept_paid += 1
            continue
        entry_id = prior['id'] if prior else str(uuid.uuid4())
        # Bonus/fine/deduction now come purely from the ledger (the inline
        # "adjust" panel was removed) — always take the freshly-computed figures
        # so a ledger edit flows straight through on regenerate.
        note = prior.get('note', '') if prior else ''
        payment_mode = prior.get('payment_mode') if prior else None
        net_exact = round(r['earned'] + r['bonus'] - r['advance'] - r['fine'] - r['manual_deduction'] + r['opening_balance'], 2)
        net_salary = round(net_exact / 10) * 10 if round_nearest_10 else net_exact
        doc = {
            'id': entry_id, 'year': body.year, 'month': body.month, **r,
            'net_salary_exact': net_exact, 'net_salary': net_salary, 'note': note, 'payment_mode': payment_mode,
            'paid': False, 'generated_at': iso, 'generated_by': user['name'],
        }
        await db.payroll_entries.update_one({'id': entry_id}, {'$set': doc}, upsert=True)
        # Post/refresh the month's salary as a receivable in the wage ledger.
        await _upsert_salary_earned(r['employee_id'], body.year, body.month, r['earned'], entry_id)
        refreshed += 1

    await db.payroll_locks.update_one(
        {'year': body.year, 'month': body.month},
        {'$set': {'year': body.year, 'month': body.month, 'locked': False,
                  'generated_at': iso, 'generated_by': user['name']}},
        upsert=True,
    )
    await log_audit(
        user, 'payroll.regenerate' if is_regenerate else 'payroll.save', 'payroll',
        f'{body.year}-{body.month:02d}', '', {'refreshed': refreshed, 'kept_paid': kept_paid},
    )
    return {'ok': True, 'entries': refreshed, 'kept_paid': kept_paid, 'regenerated': is_regenerate}


@router.get('/payroll/{year}/{month}')
async def payroll_get(year: int, month: int, _: dict = Depends(require_staff), _mod=Depends(require_module('payroll'))):
    rows = await db.payroll_entries.find({'year': year, 'month': month}, {'_id': 0}).sort('name', 1).to_list(1000)
    lock = await db.payroll_locks.find_one({'year': year, 'month': month}, {'_id': 0})
    if not rows:
        # Compute preview (not persisted)
        computed = await _compute_payroll(year, month)
        return {'year': year, 'month': month, 'rows': computed, 'saved': False,
                'locked': False, 'total_net': round(sum(r['net_salary'] for r in computed), 2)}
    return {
        'year': year, 'month': month, 'rows': rows, 'saved': True,
        'locked': bool(lock and lock.get('locked')),
        'total_net': round(sum(float(r.get('net_salary') or 0) for r in rows), 2),
    }


@router.post('/payroll/{year}/{month}/lock')
async def payroll_lock(year: int, month: int, user=Depends(require_payroll_writer), _mod=Depends(require_module('payroll'))):
    lock = await db.payroll_locks.find_one({'year': year, 'month': month}, {'_id': 0})
    if not lock: raise HTTPException(status_code=400, detail='Save payroll before locking')
    await db.payroll_locks.update_one(
        {'year': year, 'month': month},
        {'$set': {'locked': True, 'locked_by': user['name'], 'locked_at': now_utc().isoformat()}},
    )
    await log_audit(user, 'payroll.lock', 'payroll', f'{year}-{month:02d}')
    return {'ok': True}


@router.post('/payroll/{year}/{month}/unlock')
async def payroll_unlock(year: int, month: int, user=Depends(require_owner), _mod=Depends(require_module('payroll'))):
    await db.payroll_locks.update_one({'year': year, 'month': month},
                                       {'$set': {'locked': False}})
    await log_audit(user, 'payroll.unlock', 'payroll', f'{year}-{month:02d}')
    return {'ok': True}


@router.put('/payroll/entry/{entry_id}')
async def payroll_entry_update(entry_id: str, body: PayrollEntryUpdateIn, user=Depends(require_payroll_writer), _mod=Depends(require_module('payroll'))):
    entry = await db.payroll_entries.find_one({'id': entry_id}, {'_id': 0})
    if not entry: raise HTTPException(status_code=404, detail='Entry not found')
    lock = await db.payroll_locks.find_one({'year': entry['year'], 'month': entry['month']}, {'_id': 0})
    if lock and lock.get('locked'):
        raise HTTPException(status_code=400, detail='Payroll month is locked')
    upd: dict = {}
    if body.bonus_override is not None: upd['bonus'] = float(body.bonus_override)
    if body.fine_override is not None: upd['fine'] = float(body.fine_override)
    if body.manual_deduction_override is not None: upd['manual_deduction'] = float(body.manual_deduction_override)
    if body.paid_days_override is not None: upd['effective_days'] = float(body.paid_days_override)
    if body.note is not None: upd['note'] = body.note
    # payment_mode is intentionally not settable here — it's derived from actual
    # recorded payments (see POST /payroll/entry/{id}/payments) so it can't drift
    # out of sync with what was really paid.
    # Recompute net using new numbers (keep the Sunday-work half-day bonus, which sits
    # outside the capped effective-days figure, intact when only bonus/fine/etc. change)
    merged = {**entry, **upd}
    per_day = merged['base_salary'] / merged['total_days'] if merged['total_days'] else 0
    earned = round(
        per_day * min(merged.get('effective_days', 0), merged['total_days'])
        + per_day * 0.5 * merged.get('sunday_work', 0), 2)
    upd['earned'] = earned
    net_exact = round(
        earned + merged.get('bonus', 0) - merged.get('advance', 0)
        - merged.get('fine', 0) - merged.get('manual_deduction', 0)
        + merged.get('opening_balance', 0), 2)
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    upd['net_salary_exact'] = net_exact
    upd['net_salary'] = round(net_exact / 10) * 10 if store.get('round_net_salary') else net_exact
    await db.payroll_entries.update_one({'id': entry_id}, {'$set': upd})
    await log_audit(user, 'payroll.entry.update', 'payroll_entry', entry_id, entry.get('employee_code', ''), upd)
    return await db.payroll_entries.find_one({'id': entry_id}, {'_id': 0})


class PayrollPaymentIn(BaseModel):
    payment_mode: Literal['cash', 'bank', 'upi', 'cheque']
    amount: float
    note: Optional[str] = ''


def _payroll_modes_label(modes: set) -> Optional[str]:
    if not modes: return None
    return next(iter(modes)) if len(modes) == 1 else 'split'


@router.get('/payroll/entry/{entry_id}/payments')
async def list_payroll_payments(entry_id: str, _: dict = Depends(require_staff), _mod=Depends(require_module('payroll'))):
    return await db.payroll_payments.find({'entry_id': entry_id}, {'_id': 0}).sort('paid_at', 1).to_list(50)


@router.post('/payroll/entry/{entry_id}/payments')
async def add_payroll_payment(entry_id: str, body: PayrollPaymentIn, user=Depends(require_payroll_writer), _mod=Depends(require_module('payroll'))):
    """Record one payment against a payroll entry. An employee's salary can be
    split across several payments in different modes (e.g. part cash, part bank
    transfer) — each call here adds one; the entry is only marked `paid` once
    the total recorded meets the net salary."""
    entry = await db.payroll_entries.find_one({'id': entry_id}, {'_id': 0})
    if not entry: raise HTTPException(status_code=404, detail='Entry not found')
    if entry.get('paid'): raise HTTPException(status_code=400, detail='This entry is already fully paid')
    if body.amount <= 0: raise HTTPException(status_code=400, detail='Amount must be greater than 0')

    existing = await db.payroll_payments.find({'entry_id': entry_id}, {'_id': 0}).to_list(50)
    already_paid = round(sum(float(p['amount']) for p in existing), 2)
    net = float(entry['net_salary'])
    remaining = round(net - already_paid, 2)
    if body.amount > remaining + 0.5:  # small rounding tolerance
        raise HTTPException(status_code=400, detail=f'Amount exceeds the remaining balance of ₹{remaining:.0f}')

    iso = now_utc().isoformat()
    payment_doc = {
        'id': str(uuid.uuid4()), 'entry_id': entry_id, 'employee_id': entry['employee_id'],
        'payment_mode': body.payment_mode, 'amount': float(body.amount), 'note': body.note or '',
        'paid_by': user['name'], 'paid_at': iso,
    }
    await db.payroll_payments.insert_one(dict(payment_doc))

    new_total = round(already_paid + body.amount, 2)
    fully_paid = (net - new_total) <= 0.5
    modes_used = {p['payment_mode'] for p in existing} | {body.payment_mode}
    upd: dict = {'amount_paid': new_total, 'payment_mode': _payroll_modes_label(modes_used)}
    if fully_paid:
        upd.update({'paid': True, 'paid_at': iso, 'paid_by': user['name']})
    await db.payroll_entries.update_one({'id': entry_id}, {'$set': upd})

    if fully_paid:
        # Correct double-entry so a fully-paid month nets to ZERO in the ledger:
        #   + salary EARNED for the month (what the shop owed for the work), and
        #   - the actual net cash paid out.
        # Advance / bonus / fine / deduction are already their own ledger
        # entries, so the earned credit minus every payout (advance + net)
        # settles the month to nil — no more double-counting the advance.
        ym = f"{entry['year']}-{entry['month']:02d}"
        # Make sure the receivable exists (normally posted at save), then record
        # the actual net paid as a debit so the month settles in the ledger.
        await _upsert_salary_earned(entry['employee_id'], entry['year'], entry['month'], float(entry.get('earned') or 0), entry_id)
        await db.timeline.insert_one(
            {'id': str(uuid.uuid4()), 'employee_id': entry['employee_id'], 'type': 'salary_paid',
             'title': f"Salary paid {ym}", 'description': f"Net paid ₹{net:.0f}", 'amount': net,
             'sign': -1, 'created_at': iso, 'year': entry['year'], 'month': entry['month'], 'entry_id': entry_id},
        )
        await notify_user(entry['employee_id'], 'Salary paid',
                           f"Your salary for {ym} (₹{net:.0f}) has been paid", '/profile')
    await log_audit(user, 'payroll.payment.add', 'payroll_entry', entry_id, entry.get('employee_code', ''),
                     {'mode': body.payment_mode, 'amount': body.amount, 'fully_paid': fully_paid})
    return {'ok': True, 'fully_paid': fully_paid, 'amount_paid': new_total, 'remaining': round(net - new_total, 2)}


async def _remove_salary_ledger_entries(entry: dict) -> None:
    """Remove the PAYMENT record when a month is un-paid or drops below
    fully-paid — the salary_paid debit (and any legacy single 'salary' +net
    entry). The salary_earned RECEIVABLE is intentionally kept, so the employee
    still shows as owed their salary for the month until it's paid again."""
    ym = f"{entry['year']}-{entry['month']:02d}"
    await db.timeline.delete_many({
        'employee_id': entry['employee_id'],
        '$or': [
            {'entry_id': entry['id'], 'type': 'salary_paid'},
            {'type': 'salary', 'title': f'Salary {ym}'},   # legacy single +net entry
        ],
    })


@router.post('/payroll/entry/{entry_id}/unpay')
async def payroll_unpay(entry_id: str, user=Depends(require_payroll_writer), _mod=Depends(require_module('payroll'))):
    """Undo a fully/partly paid salary: removes every recorded payment and the
    salary ledger entries, and resets the entry to unpaid — so the month can be
    recalculated and paid again from scratch."""
    entry = await db.payroll_entries.find_one({'id': entry_id}, {'_id': 0})
    if not entry: raise HTTPException(status_code=404, detail='Entry not found')
    lock = await db.payroll_locks.find_one({'year': entry['year'], 'month': entry['month']}, {'_id': 0})
    if lock and lock.get('locked'):
        raise HTTPException(status_code=400, detail='Payroll month is locked — unlock it first')
    await db.payroll_payments.delete_many({'entry_id': entry_id})
    await _remove_salary_ledger_entries(entry)
    await db.payroll_entries.update_one({'id': entry_id}, {'$set': {
        'paid': False, 'amount_paid': 0, 'payment_mode': None, 'paid_at': None, 'paid_by': None,
    }})
    await log_audit(user, 'payroll.unpay', 'payroll_entry', entry_id, entry.get('employee_code', ''), {})
    return {'ok': True}


@router.delete('/payroll/entry/{entry_id}/payments/{payment_id}')
async def delete_payroll_payment(entry_id: str, payment_id: str, user=Depends(require_payroll_writer), _mod=Depends(require_module('payroll'))):
    """Undo a single recorded payment (e.g. it was logged in the wrong mode) —
    recomputes the entry's paid/amount_paid/payment_mode from what's left."""
    p = await db.payroll_payments.find_one({'id': payment_id, 'entry_id': entry_id}, {'_id': 0})
    if not p: raise HTTPException(status_code=404, detail='Payment not found')
    await db.payroll_payments.delete_one({'id': payment_id})

    remaining = await db.payroll_payments.find({'entry_id': entry_id}, {'_id': 0}).to_list(50)
    total = round(sum(float(x['amount']) for x in remaining), 2)
    entry = await db.payroll_entries.find_one({'id': entry_id}, {'_id': 0})
    net = float(entry['net_salary']) if entry else 0.0
    fully_paid = total > 0 and (net - total) <= 0.5
    # Dropping below fully-paid means the salary is no longer settled — remove
    # the salary ledger entries so the wage ledger doesn't show a paid salary.
    if not fully_paid and entry:
        await _remove_salary_ledger_entries(entry)
    modes_used = {x['payment_mode'] for x in remaining}
    upd = {'amount_paid': total, 'paid': fully_paid, 'payment_mode': _payroll_modes_label(modes_used)}
    if not fully_paid:
        upd['paid_at'] = None
        upd['paid_by'] = None
    await db.payroll_entries.update_one({'id': entry_id}, {'$set': upd})
    await log_audit(user, 'payroll.payment.delete', 'payroll_entry', entry_id, (entry or {}).get('employee_code', ''),
                     {'mode': p['payment_mode'], 'amount': p['amount']})
    return {'ok': True, 'fully_paid': fully_paid, 'amount_paid': total, 'remaining': round(net - total, 2)}


@router.get('/payroll/entry/{entry_id}/pdf')
async def payroll_pdf(entry_id: str, _: dict = Depends(require_staff), _mod=Depends(require_module('payroll'))):
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors as rlcolors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from starlette.responses import Response as StarletteResponse

    entry = await db.payroll_entries.find_one({'id': entry_id}, {'_id': 0})
    if not entry: raise HTTPException(status_code=404, detail='Entry not found')
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    emp = await db.employees.find_one({'id': entry['employee_id']}, {'_id': 0, 'password_hash': 0}) or {}

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=18*mm, bottomMargin=18*mm)
    styles = getSampleStyleSheet()
    gold = rlcolors.HexColor('#D4AF37')
    dark = rlcolors.HexColor('#0D0D0D')
    title_style = ParagraphStyle('t', parent=styles['Title'], textColor=dark, fontSize=22)
    sub_style = ParagraphStyle('s', parent=styles['Normal'], textColor=rlcolors.HexColor('#555'), fontSize=10)
    label_style = ParagraphStyle('lbl', parent=styles['Normal'], fontSize=9, textColor=rlcolors.HexColor('#666'))

    elements = []
    elements.append(Paragraph(store.get('name', 'Ram Murti Jewellers'), title_style))
    elements.append(Paragraph('Salary Receipt', sub_style))
    elements.append(Spacer(1, 6*mm))

    period = f"{entry['year']}-{entry['month']:02d}"
    header_data = [
        ['Employee', emp.get('name', '—'), 'Code', emp.get('employee_code', '—')],
        ['Designation', emp.get('designation', '—'), 'Department', emp.get('department', '—')],
        ['Period', period, 'Base Salary', f"₹{entry['base_salary']:.0f}"],
    ]
    t1 = Table(header_data, colWidths=[28*mm, 60*mm, 28*mm, 60*mm])
    t1.setStyle(TableStyle([
        ('FONT', (0,0), (-1,-1), 'Helvetica', 10),
        ('TEXTCOLOR', (0,0), (0,-1), rlcolors.HexColor('#888')),
        ('TEXTCOLOR', (2,0), (2,-1), rlcolors.HexColor('#888')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LINEBELOW', (0,0), (-1,-1), 0.25, rlcolors.HexColor('#eee')),
    ]))
    elements.append(t1)
    elements.append(Spacer(1, 6*mm))

    body_data = [
        ['Days worked', f"{entry['present_days']}"],
        ['Half days', f"{entry['half_days']}"],
        ['Sunday work', f"{entry['sunday_work']}"],
        ['Leave days', f"{entry['leave_days']}"],
        ['Effective days', f"{entry['effective_days']} / {entry['total_days']}"],
    ]
    t2 = Table(body_data, colWidths=[80*mm, 90*mm])
    t2.setStyle(TableStyle([
        ('FONT', (0,0), (-1,-1), 'Helvetica', 10),
        ('TEXTCOLOR', (0,0), (0,-1), rlcolors.HexColor('#555')),
        ('ALIGN', (1,0), (1,-1), 'RIGHT'),
        ('LINEBELOW', (0,0), (-1,-1), 0.25, rlcolors.HexColor('#eee')),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 6),
    ]))
    elements.append(t2)
    elements.append(Spacer(1, 5*mm))

    # Earnings block
    elements.append(Paragraph('EARNINGS', ParagraphStyle('h', parent=styles['Normal'], fontSize=9, textColor=gold, spaceAfter=4)))
    earn_data = [
        ['Earned salary', f"₹{entry['earned']:.0f}"],
        ['Bonus', f"₹{entry['bonus']:.0f}"],
    ]
    if entry.get('opening_balance', 0) > 0:
        earn_data.append(['Opening balance (owed to employee)', f"₹{entry.get('opening_balance', 0):.0f}"])
    t_earn = Table(earn_data, colWidths=[110*mm, 60*mm])
    t_earn.setStyle(TableStyle([
        ('FONT', (0,0), (-1,-1), 'Helvetica', 10),
        ('ALIGN', (1,0), (1,-1), 'RIGHT'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    elements.append(t_earn)
    elements.append(Spacer(1, 4*mm))

    # Deductions block
    elements.append(Paragraph('DEDUCTIONS', ParagraphStyle('h', parent=styles['Normal'], fontSize=9, textColor=rlcolors.HexColor('#7A2828'), spaceAfter=4)))
    ded_data = [
        ['Advance', f"₹{entry['advance']:.0f}"],
        ['Fine', f"₹{entry['fine']:.0f}"],
        ['Manual deduction', f"₹{entry['manual_deduction']:.0f}"],
    ]
    if entry.get('opening_balance', 0) < 0:
        ded_data.append(['Opening balance (owed by employee)', f"₹{abs(entry.get('opening_balance', 0)):.0f}"])
    t_ded = Table(ded_data, colWidths=[110*mm, 60*mm])
    t_ded.setStyle(TableStyle([
        ('FONT', (0,0), (-1,-1), 'Helvetica', 10),
        ('ALIGN', (1,0), (1,-1), 'RIGHT'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    elements.append(t_ded)
    elements.append(Spacer(1, 5*mm))

    net_data = [['NET SALARY', f"₹{entry['net_salary']:.0f}"]]
    t3 = Table(net_data, colWidths=[80*mm, 90*mm])
    t3.setStyle(TableStyle([
        ('FONT', (0,0), (-1,-1), 'Helvetica-Bold', 14),
        ('BACKGROUND', (0,0), (-1,-1), gold),
        ('TEXTCOLOR', (0,0), (-1,-1), dark),
        ('ALIGN', (1,0), (1,-1), 'RIGHT'),
        ('TOPPADDING', (0,0), (-1,-1), 10),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
    ]))
    elements.append(t3)
    elements.append(Spacer(1, 4*mm))

    # Payment mode + note — if the salary was split across multiple modes
    # (part cash, part bank, etc.), list each recorded payment individually.
    if entry.get('payment_mode') == 'split':
        payments = await db.payroll_payments.find({'entry_id': entry_id}, {'_id': 0}).sort('paid_at', 1).to_list(50)
        elements.append(Paragraph('Payment mode: <b>SPLIT</b>', label_style))
        for p in payments:
            elements.append(Paragraph(
                f"&nbsp;&nbsp;• {p['payment_mode'].upper()} — ₹{float(p['amount']):.0f}"
                + (f" ({p['note']})" if p.get('note') else ''),
                label_style,
            ))
    else:
        pay_mode = (entry.get('payment_mode') or '—').upper()
        elements.append(Paragraph(f"Payment mode: <b>{pay_mode}</b>", label_style))
    if entry.get('note'):
        elements.append(Spacer(1, 2*mm))
        elements.append(Paragraph(f"Note: {entry.get('note')}", label_style))
    elements.append(Spacer(1, 10*mm))

    elements.append(Paragraph('Received by: __________________________', label_style))
    elements.append(Spacer(1, 8*mm))
    elements.append(Paragraph('Signature: ____________________________     Date: __________', label_style))
    elements.append(Spacer(1, 12*mm))
    elements.append(Paragraph(
        f"Generated on {now_utc().strftime('%d %b %Y %H:%M UTC')} · RMJ One",
        ParagraphStyle('f', parent=styles['Normal'], fontSize=8, textColor=rlcolors.HexColor('#999')),
    ))
    doc.build(elements)
    pdf = buf.getvalue()
    buf.close()
    return StarletteResponse(
        content=pdf,
        media_type='application/pdf',
        headers={'Content-Disposition': f'inline; filename="rmj-salary-{emp.get("employee_code", "emp")}-{period}.pdf"'},
    )
