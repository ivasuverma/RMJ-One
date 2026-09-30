"""Home — the daily briefing: where the money is, what needs you today, and what's coming.

One call, GET /home/summary, built server-side and filtered to what the caller may see
(the same per-module access as everywhere: a section or row only appears for a module the
account can open, and an action that changes data needs Edit on that module). Each section
is computed independently — one that fails comes back as {'unavailable': True} instead of
failing the whole call — and the result is cached per user for a short while so Home can
refresh often without re-running every query.

Nothing here re-implements a module's rules: overdue loans, karigar balances, document
visibility, cash balances and attendance all come from the modules' own helpers. The few
numbers that are Home's own (how many days before a sample counts as out too long, when a
broadcast should have gone out, ...) live in Settings › Home (GET/PUT /settings/home).
"""
import asyncio
import logging
import time
from calendar import monthrange
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from server import (
    db, now_utc, IST, get_current, require_admin, resolve_modules, _minutes, _karigar_ledger_balances,
)

router = APIRouter()
logger = logging.getLogger('home')

# ---------------- Settings › Home ----------------
HOME_DEFAULTS = {
    'sample_overdue_days': 3,       # a sample with no due date counts as out too long after this many days
    'document_pending_days': 1,     # pending photos turn amber after this many days
    'not_checked_in_min': 15,       # "not checked in" = this many minutes past shift start with no punch
    'broadcast_deadline': '11:00',  # a rate broadcast not sent by this time (IST) is flagged
    'customer_balance_min': 5000,   # customer balances listed under Owed to you start at this amount
    'coming_up_days': 7,            # how far ahead Coming up looks
    'payday_day': 2,                # day of the month last month's salaries are paid (for Coming up)
}


class HomeSettingsIn(BaseModel):
    sample_overdue_days: Optional[int] = Field(default=None, ge=0, le=90)
    document_pending_days: Optional[int] = Field(default=None, ge=0, le=90)
    not_checked_in_min: Optional[int] = Field(default=None, ge=0, le=480)
    broadcast_deadline: Optional[str] = Field(default=None, pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    customer_balance_min: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    coming_up_days: Optional[int] = Field(default=None, ge=1, le=31)
    payday_day: Optional[int] = Field(default=None, ge=1, le=31)


async def home_settings() -> dict:
    doc = await db.settings.find_one({'id': 'home'}, {'_id': 0}) or {}
    return {k: doc.get(k, v) for k, v in HOME_DEFAULTS.items()}


@router.get('/settings/home')
async def get_home_settings(_: dict = Depends(require_admin)):
    return {'settings': await home_settings(), 'defaults': HOME_DEFAULTS}


@router.put('/settings/home')
async def put_home_settings(body: HomeSettingsIn, user: dict = Depends(require_admin)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if upd:
        await db.settings.update_one({'id': 'home'}, {'$set': {'id': 'home', **upd}}, upsert=True)
        _USER_CACHE.clear()   # thresholds changed — rebuild everyone's Home
    return {'settings': await home_settings(), 'defaults': HOME_DEFAULTS}


# ---------------- Access ----------------
def can_view(user: dict, key: str) -> bool:
    return user.get('role') == 'owner' or key in resolve_modules(user)


def can_edit(user: dict, key: str) -> bool:
    """Edit on a module: owner always; admin/accountant with the module; an
    employee only when the owner also gave them the Edit right on it."""
    role = user.get('role')
    if role == 'owner':
        return True
    if key not in resolve_modules(user):
        return False
    if role == 'employee':
        return bool(((user.get('module_rights') or {}).get(key) or {}).get('edit'))
    return True


# ---------------- Quick actions ----------------
# The tiles Home can show, in their default order. Each opens that module's create flow
# (the app maps the key to the screen), and only shows for someone who can edit the module.
QUICK_ACTIONS = [
    {'key': 'cash_in', 'label': 'Cash in', 'module': 'cash_book'},
    {'key': 'cash_out', 'label': 'Cash out', 'module': 'cash_book'},
    {'key': 'new_repair', 'label': 'New repair', 'module': 'repairs'},
    {'key': 'issue_stock', 'label': 'Issue stock', 'module': 'samples'},
    {'key': 'update_rate', 'label': 'Update rate', 'module': 'gold_rate'},
    {'key': 'send_rates', 'label': 'Send rates', 'module': 'rate_broadcast'},
    {'key': 'new_loan', 'label': 'New loan', 'module': 'gold_loans'},
    {'key': 'add_task', 'label': 'Add task', 'module': 'tasks'},
    {'key': 'advance', 'label': 'Advance', 'module': 'payroll'},
]
QUICK_KEYS = [q['key'] for q in QUICK_ACTIONS]


async def _quick_actions(user: dict) -> dict:
    prefs = await db.user_prefs.find_one({'user_id': user['id']}, {'_id': 0, 'home_quick_order': 1, 'home_quick_hidden': 1}) or {}
    allowed = [q for q in QUICK_ACTIONS if can_edit(user, q['module'])]
    by_key = {q['key']: q for q in allowed}
    order = [k for k in (prefs.get('home_quick_order') or []) if k in by_key]
    order += [q['key'] for q in allowed if q['key'] not in order]   # tiles added later go at the end
    hidden = [k for k in (prefs.get('home_quick_hidden') or []) if k in by_key]
    return {
        'tiles': [by_key[k] for k in order if k not in hidden],
        'available': [by_key[k] for k in order],   # everything this person may pick from, in their order
        'hidden': hidden,
    }


class QuickActionsIn(BaseModel):
    order: list[str] = Field(default_factory=list, max_length=50)
    hidden: list[str] = Field(default_factory=list, max_length=50)


@router.get('/home/quick-actions')
async def get_quick_actions(user: dict = Depends(get_current)):
    return await _quick_actions(user)


@router.put('/home/quick-actions')
async def put_quick_actions(body: QuickActionsIn, user: dict = Depends(get_current)):
    """Which tiles this person shows and in what order — saved per user, so it follows them to any device."""
    order = [k for k in dict.fromkeys(body.order) if k in QUICK_KEYS]
    hidden = [k for k in dict.fromkeys(body.hidden) if k in QUICK_KEYS]
    await db.user_prefs.update_one(
        {'user_id': user['id']},
        {'$set': {'user_id': user['id'], 'home_quick_order': order, 'home_quick_hidden': hidden, 'updated_at': now_utc().isoformat()}},
        upsert=True,
    )
    _USER_CACHE.pop(user['id'], None)
    return await _quick_actions(user)


# ---------------- Small helpers ----------------
def _ist_now() -> datetime:
    return now_utc().astimezone(IST)


def _ist_time(iso: Optional[str]) -> Optional[str]:
    """'2026-09-30T04:32:00+00:00' -> '10:02' (IST)."""
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso).astimezone(IST).strftime('%H:%M')
    except ValueError:
        return None


def _days_since(day: Optional[str], today: date) -> Optional[int]:
    try:
        return (today - date.fromisoformat((day or '')[:10])).days
    except ValueError:
        return None


def _names(names: list, n: int = 3) -> str:
    seen = list(dict.fromkeys(x for x in names if x))
    return ', '.join(seen[:n]) + (f' +{len(seen) - n}' if len(seen) > n else '')


def _first_name(name: str) -> str:
    return (name or '').strip().split(' ')[0] if name else ''


# Shop-wide numbers that don't depend on who's asking (every overdue loan's state, all
# karigar balances, ...) are computed once and shared by everyone's Home for a short while.
_SHARED: dict = {}
_SHARED_LOCKS: dict = {}


async def _shared(key: str, ttl: float, loader):
    hit = _SHARED.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    lock = _SHARED_LOCKS.setdefault(key, asyncio.Lock())
    async with lock:
        hit = _SHARED.get(key)
        if hit and time.monotonic() - hit[0] < ttl:
            return hit[1]
        val = await loader()
        _SHARED[key] = (time.monotonic(), val)
        return val


# ---------------- Sections ----------------
async def _header(user: dict, now: datetime) -> dict:
    h = now.hour
    part = 'morning' if h < 12 else 'afternoon' if h < 17 else 'evening'
    unread = await db.notifications.count_documents({'user_id': user['id'], 'read': False})
    return {
        'date': now.date().isoformat(), 'greeting': f'Good {part}', 'first_name': _first_name(user.get('name', '')),
        'unread_notifications': unread,
    }


async def _rates(user: dict, today: str, s: dict, now: datetime) -> dict:
    from routers.rate_master import get_items, compute
    live = await db.settings.find_one({'id': 'gold_rate_live'}, {'_id': 0, 'gold_rate': 1, 'silver_rate': 1, 'fetched_at': 1}) or {}
    prev = await db.rate_daily.find_one({'date': {'$lt': today}}, {'_id': 0}, sort=[('date', -1)])
    gold, silver = live.get('gold_rate'), live.get('silver_rate')
    items = [i for i in await get_items() if i['key'] == 'gold_22k']

    def k22(g):
        return compute(items, int(g), 0)[0]['rate'] if (g and items) else None

    def change(now_v, prev_v):
        return round(now_v - prev_v) if (now_v is not None and prev_v is not None) else None

    rows = [
        {'key': 'gold_24k', 'label': '24K', 'rate': gold, 'change': change(gold, (prev or {}).get('gold'))},
        {'key': 'gold_22k', 'label': '22K', 'rate': k22(gold), 'change': change(k22(gold), k22((prev or {}).get('gold')))},
        {'key': 'silver', 'label': 'Silver', 'rate': silver, 'change': change(silver, (prev or {}).get('silver'))},
    ]
    out = {'items': [r for r in rows if r['rate']], 'fetched_at': live.get('fetched_at'),
           'can_open': can_view(user, 'gold_rate'), 'broadcast': None}
    if can_view(user, 'rate_broadcast'):
        out['broadcast'] = await _broadcast_status(s, now)
    return out


async def _template_status() -> dict:
    """Meta's approval status for the daily rate template — an outside HTTP call, so it's
    looked up at most every 10 minutes."""
    async def load():
        import whatsapp_meta
        from routers.rate_broadcast import TEMPLATE_NAME
        if not whatsapp_meta.is_configured():
            return {'configured': False, 'status': None}
        st = await whatsapp_meta.template_status(TEMPLATE_NAME)
        return {'configured': True, 'status': st.get('status')}
    return await _shared('rate_template', 600, load)


async def _broadcast_status(s: dict, now: datetime) -> dict:
    from routers.rate_broadcast import _ist_day_start_utc_iso
    day_start = _ist_day_start_utc_iso()
    last = await db.rate_broadcasts.find_one(
        {'created_at': {'$gte': day_start}, 'status': {'$ne': 'failed'}}, {'_id': 0, 'created_at': 1, 'status': 1},
        sort=[('created_at', -1)],
    )
    tpl = await _template_status()
    if tpl['configured'] and tpl['status'] and tpl['status'] != 'APPROVED':
        state = 'template_not_approved'
    elif last:
        state = 'sent'
    else:
        state = 'not_sent'
    overdue = state == 'not_sent' and now.weekday() != 6 and (now.hour * 60 + now.minute) >= _minutes(s['broadcast_deadline'])
    subscribers = await db.rate_subscribers.count_documents({'status': 'active'})
    return {'state': state, 'sent_at': (last or {}).get('created_at'), 'late': overdue,
            'template_status': tpl['status'], 'subscribers': subscribers}


async def _cash(user: dict, today: str) -> dict:
    from routers.cashbook import _employee_allowed_counter_ids, _counters_closing_balances
    counters = await db.cashbook_counters.find({'active': True}, {'_id': 0, 'id': 1, 'name': 1}).sort('created_at', 1).to_list(200)
    allowed = _employee_allowed_counter_ids(user)
    if allowed is not None:
        counters = [c for c in counters if c['id'] in allowed]
    ids = [c['id'] for c in counters]
    if not ids:
        return {'total': 0, 'received_today': 0, 'paid_today': 0, 'net_today': 0, 'locations': [], 'can_edit': can_edit(user, 'cash_book'),
                'day_close_available': False}
    balances, entries_today, last = await asyncio.gather(
        _counters_closing_balances(ids),
        db.cashbook_entries.find({'counter_id': {'$in': ids}, 'date': today},
                                 {'_id': 0, 'type': 1, 'amount': 1, 'transfer_counter_id': 1}).to_list(10000),
        db.cashbook_entries.aggregate([
            {'$match': {'counter_id': {'$in': ids}}},
            {'$group': {'_id': '$counter_id', 'at': {'$max': '$created_at'}}},
        ]).to_list(500),
    )
    # Moving cash between counter, drawer and locker isn't money in or out of the shop.
    real = [e for e in entries_today if not e.get('transfer_counter_id')]
    received = round(sum(e['amount'] for e in real if e['type'] == 'received'), 2)
    paid = round(sum(e['amount'] for e in real if e['type'] == 'paid'), 2)
    last_at = {r['_id']: r['at'] for r in last}
    total = round(sum(balances.get(i, 0) for i in ids), 2)
    locs = []
    for c in counters:
        bal = balances.get(c['id'], 0)
        locs.append({'id': c['id'], 'name': c['name'], 'balance': bal,
                     'share': round(bal / total, 4) if total > 0 and bal > 0 else 0, 'last_entry_at': last_at.get(c['id'])})
    return {
        'total': total, 'received_today': received, 'paid_today': paid, 'net_today': round(received - paid, 2),
        'locations': locs, 'can_edit': can_edit(user, 'cash_book'),
        # Cash Book has no close-the-day flow yet; the app opens today's Cash Book instead.
        'day_close_available': False,
    }


async def _loan_states() -> list:
    async def load():
        from routers.gold_loans import _bulk_loan_txns, _compute_loan_state
        loans = await db.gold_loans.find({'status': 'active'}, {'_id': 0, 'photo': 0}).to_list(5000)
        txns = await _bulk_loan_txns([l['id'] for l in loans])
        out = []
        for l in loans:
            st = _compute_loan_state(l, txns.get(l['id'], []))
            unpaid = [m for m in st.get('interest_months', []) if not m['paid']]
            out.append({'id': l['id'], 'customer_name': l.get('customer_name'), 'loan_no': l.get('loan_no'),
                        'interest_balance': st['interest_balance'], 'oldest_unpaid_date': unpaid[0]['date'] if unpaid else None})
        return out
    return await _shared('loan_states', 30, load)


async def _staff_today(user: dict, s: dict, now: datetime) -> dict:
    """Everyone due in today with a status for their avatar ring."""
    today = now.date().isoformat()
    minutes_now = now.hour * 60 + now.minute
    employees, att, holiday, store, shifts, leaves = await asyncio.gather(
        db.employees.find({'status': {'$ne': 'inactive'}},
                          {'_id': 0, 'id': 1, 'name': 1, 'status': 1, 'shift': 1, 'photo_thumb': 1, 'designation': 1, 'department': 1}).sort('name', 1).to_list(2000),
        db.attendance.find({'date': today}, {'_id': 0, 'employee_id': 1, 'check_in.timestamp': 1, 'check_out.timestamp': 1, 'status': 1, 'is_late': 1}).to_list(2000),
        db.holidays.find_one({'date': today}, {'_id': 0, 'id': 1}),
        db.settings.find_one({'id': 'store'}, {'_id': 0}),
        db.shifts.find({}, {'_id': 0}).to_list(200),
        db.leaves.find({'status': 'approved', 'from_date': {'$lte': today}, 'to_date': {'$gte': today}}, {'_id': 0, 'employee_id': 1}).to_list(2000),
    )
    store = store or {}
    if now.weekday() == 6 or holiday:
        return {'working_day': False, 'due': 0, 'present': 0, 'people': []}
    shifts_by = {x['name']: x for x in shifts}
    on_leave = {l['employee_id'] for l in leaves}
    att_by = {a['employee_id']: a for a in att}
    people = []
    for e in employees:
        shift = shifts_by.get(e.get('shift'))
        if shift and shift.get('remote'):
            continue   # work-from-home shifts don't punch in
        start = _minutes((shift or {}).get('start') or store.get('work_start', '10:00'))
        a = att_by.get(e['id']) or {}
        cin = (a.get('check_in') or {}).get('timestamp')
        if e.get('status') == 'on_leave' or e['id'] in on_leave or a.get('status') in ('leave', 'holiday', 'weekly_off'):
            status, late_min = 'leave', 0
        elif cin:
            t = datetime.fromisoformat(cin).astimezone(IST)
            late_min = max(0, t.hour * 60 + t.minute - start)
            # Late is whatever Attendance decided at punch time (shift grace, else the store's
            # grace from Settings); only recompute with the same rule if the flag is missing.
            if 'is_late' in a:
                late = bool(a['is_late'])
            else:
                late = late_min > int((shift or {}).get('grace_min', store.get('grace_min', 15)))
            status = 'late' if late else 'present'
        elif a.get('status') == 'absent':
            status, late_min = 'absent', 0
        else:
            status, late_min = ('not_in' if minutes_now >= start + s['not_checked_in_min'] else 'due'), 0
        people.append({
            'id': e['id'], 'name': e['name'], 'first_name': _first_name(e['name']), 'photo': e.get('photo_thumb') or '',
            'role': e.get('designation') or '', 'department': e.get('department') or '',
            'status': status, 'check_in': _ist_time(cin), 'late_min': late_min,
        })
    due = [p for p in people if p['status'] != 'leave']
    present = sum(1 for p in due if p['status'] in ('present', 'late'))
    return {'working_day': True, 'due': len(due), 'present': present, 'people': people,
            'can_see_pay': can_view(user, 'payroll')}


async def _needs_you(user: dict, s: dict, now: datetime, staff: Optional[dict]) -> list:
    today_d = now.date()
    today = today_d.isoformat()
    rows: list = []

    if can_view(user, 'gold_loans'):
        pending = [l for l in await _loan_states() if l['interest_balance'] > 0.01]
        if pending:
            total = round(sum(l['interest_balance'] for l in pending), 2)
            oldest = max((_days_since(l['oldest_unpaid_date'], today_d) or 0) for l in pending)
            rows.append({'key': 'loans_overdue', 'severity': 'red', 'module': 'gold_loans', 'count': len(pending),
                         'title': f"{len(pending)} gold loan{'s' if len(pending) != 1 else ''} overdue",
                         'detail': f"₹{total:,.0f} interest pending · oldest {oldest} days", 'amount': total, 'oldest_days': oldest,
                         'action': 'Remind all', 'route': '/loans?status=overdue', 'can_act': can_edit(user, 'gold_loans')})

    if can_view(user, 'repairs'):
        open_items = await db.repair_items.find(
            {'status': {'$ne': 'delivered'}}, {'_id': 0, 'status': 1, 'due_date': 1, 'customer_name': 1, 'created_at': 1},
        ).sort('due_date', 1).to_list(5000)
        overdue = [i for i in open_items if i.get('due_date') and i['due_date'] < today]
        if overdue:
            rows.append({'key': 'repairs_overdue', 'severity': 'red', 'module': 'repairs', 'count': len(overdue),
                         'title': f"{len(overdue)} repair{'s' if len(overdue) != 1 else ''} overdue",
                         'detail': _names([i.get('customer_name') for i in overdue]),
                         'action': 'Review', 'route': '/repairs?filter=overdue', 'can_act': True})
        ready = sorted([i for i in open_items if i['status'] == 'ready'], key=lambda i: i.get('created_at') or '')
        if ready:
            rows.append({'key': 'repairs_ready', 'severity': 'gold', 'module': 'repairs', 'count': len(ready),
                         'title': f"{len(ready)} repair{'s' if len(ready) != 1 else ''} ready to bill",
                         'detail': _names([i.get('customer_name') for i in ready]),
                         'action': 'Bill', 'route': '/repairs?filter=ready', 'can_act': can_edit(user, 'repairs')})

    if can_view(user, 'samples'):
        cutoff = (now_utc() - timedelta(days=s['sample_overdue_days'])).isoformat()
        out = await db.samples.find({'status': 'with_karigar'},
                                    {'_id': 0, 'due_date': 1, 'issued_at': 1, 'karigar_name': 1}).sort('issued_at', 1).to_list(5000)
        # Past its due date, or — with no due date — out longer than the Settings › Home limit.
        late = [x for x in out if (x['due_date'] < today if x.get('due_date') else (x.get('issued_at') or '') < cutoff)]
        if late:
            rows.append({'key': 'samples_overdue', 'severity': 'amber', 'module': 'samples', 'count': len(late),
                         'title': f"{len(late)} sample{'s' if len(late) != 1 else ''} out too long",
                         'detail': f"With {_names([x.get('karigar_name') for x in late])}",
                         'action': 'Review', 'route': '/samples?status=overdue', 'can_act': True})

    # Tasks: the whole team's for whoever has the Tasks module, otherwise just your own.
    tq = {'status': 'open', 'due_date': {'$lt': today, '$nin': [None, '']}}
    if not can_view(user, 'tasks'):
        tq['assigned_to'] = user['id']
    if can_view(user, 'tasks') or user.get('role') == 'employee':
        tasks = await db.tasks.find(tq, {'_id': 0, 'title': 1, 'due_date': 1}).sort('due_date', 1).to_list(2000)
        if tasks:
            rows.append({'key': 'tasks_overdue', 'severity': 'amber', 'module': 'tasks', 'count': len(tasks),
                         'title': f"{len(tasks)} task{'s' if len(tasks) != 1 else ''} overdue",
                         'detail': f"Oldest: {tasks[0].get('title') or 'Untitled'}",
                         'action': 'Review', 'route': '/tasks', 'can_act': True})

    if can_view(user, 'documents'):
        from routers.documents import _account_rights, _visible_keys, _role
        visible = await _visible_keys(_role(user), await _account_rights(user))
        if visible:
            docs = await db.documents.find(
                {'status': 'pending', 'deleted': {'$ne': True}, 'category_key': {'$in': list(visible)}},
                {'_id': 0, 'created_at': 1},
            ).sort('created_at', 1).to_list(5000)
            if docs:
                age = _days_since(docs[0].get('created_at'), today_d) or 0
                rows.append({'key': 'documents_pending', 'severity': 'amber' if age >= s['document_pending_days'] else 'gold',
                             'module': 'documents', 'count': len(docs),
                             'title': f"{len(docs)} photo{'s' if len(docs) != 1 else ''} to record",
                             'detail': 'Oldest added today' if age == 0 else f"Oldest {age} day{'s' if age != 1 else ''} ago",
                             'action': 'Record', 'route': '/documents?tab=pending', 'can_act': True})

    if can_view(user, 'rate_broadcast'):
        b = await _broadcast_status(s, now)
        if b['state'] == 'template_not_approved':
            rows.append({'key': 'broadcast', 'severity': 'amber', 'module': 'rate_broadcast',
                         'title': 'Rate broadcast template not approved',
                         'detail': f"{b['subscribers']:,} customers can't get daily rates yet",
                         'action': 'Check', 'route': '/settings/rate-broadcast', 'can_act': True})
        elif b['late']:
            rows.append({'key': 'broadcast', 'severity': 'amber', 'module': 'rate_broadcast',
                         'title': "Today's rates not sent", 'detail': f"Due by {s['broadcast_deadline']}",
                         'action': 'Check', 'route': '/settings/rate-broadcast', 'can_act': True})

    if staff and staff.get('working_day') and can_view(user, 'attendance'):
        missing = [p for p in staff['people'] if p['status'] == 'not_in']
        if missing:
            rows.append({'key': 'staff_not_in', 'severity': 'amber', 'module': 'attendance', 'count': len(missing),
                         'title': f"{len(missing)} not checked in",
                         'detail': _names([p['first_name'] for p in missing]),
                         'action': 'Review', 'route': '/attendance', 'can_act': True})

    rank = {'red': 0, 'amber': 1, 'gold': 2}
    rows.sort(key=lambda r: rank.get(r['severity'], 3))
    return rows


async def _customer_balances() -> list:
    """Every customer ledger account's money balance (positive = they owe the shop), with the
    date it has been owed since (the day the balance last went from settled to owing)."""
    async def load():
        t = await db.account_types.find_one({'key': 'customer'}, {'_id': 0, 'id': 1})
        if not t:
            return []
        accounts = await db.accounts.find({'type_id': t['id'], 'active': {'$ne': False}},
                                          {'_id': 0, 'id': 1, 'name': 1, 'opening_amount': 1, 'created_at': 1}).to_list(10000)
        ids = [a['id'] for a in accounts]
        sums = {r['_id']: r for r in await db.ledger_entries.aggregate([
            {'$match': {'account_id': {'$in': ids}}},
            {'$group': {'_id': '$account_id', 'amount': {'$sum': '$amount_delta'}}},
        ]).to_list(20000)}
        out = []
        for a in accounts:
            bal = round((a.get('opening_amount') or 0) + (sums.get(a['id'], {}).get('amount') or 0), 2)
            if bal > 0.5:
                out.append({'id': a['id'], 'name': a['name'], 'balance': bal, 'opening': a.get('opening_amount') or 0,
                            'created_at': a.get('created_at')})
        return out
    return await _shared('customer_balances', 30, load)


async def _owing_since(acc: dict) -> Optional[str]:
    """Walk this account's entries in date order and find when the balance last went from
    settled (≤ 0) to owing."""
    run = acc['opening'] or 0
    since = (acc.get('created_at') or '')[:10] if run > 0.5 else None
    async for e in db.ledger_entries.find({'account_id': acc['id']}, {'_id': 0, 'date': 1, 'created_at': 1, 'amount_delta': 1}).sort('created_at', 1):
        before = run
        run += e.get('amount_delta') or 0
        if before <= 0.5 < run:
            since = (e.get('date') or e.get('created_at') or '')[:10]
        elif run <= 0.5:
            since = None
    return since


async def _owed(user: dict, s: dict, today_d: date) -> dict:
    out: dict = {'customers': None, 'loan_interest': None, 'karigars': None, 'top': []}
    if can_view(user, 'ledger') or can_view(user, 'customer_ledger'):
        bals = await _customer_balances()
        out['customers'] = {'total': round(sum(b['balance'] for b in bals), 2), 'accounts': len(bals)}
        big = [b for b in bals if b['balance'] >= s['customer_balance_min']]
        since = await asyncio.gather(*[_owing_since(b) for b in big])
        rows = [{'id': b['id'], 'name': b['name'], 'balance': b['balance'], 'since': sn, 'days': _days_since(sn, today_d)}
                for b, sn in zip(big, since)]
        rows.sort(key=lambda r: (r['since'] or '9999'))
        out['top'] = rows[:3]
    if can_view(user, 'gold_loans'):
        states = await _loan_states()
        pending = [l for l in states if l['interest_balance'] > 0.01]
        out['loan_interest'] = {'total': round(sum(l['interest_balance'] for l in pending), 2), 'overdue': len(pending)}
    if can_view(user, 'karigar_ledger'):
        async def load():
            bal = _karigar_ledger_balances(await db.karigar_ledger.find({}, {'_id': 0}).to_list(None))
            return {'fine': round(sum(b.get('fine_bal', 0) for b in bal.values()), 3),
                    'amount': round(sum(b.get('amt_due', 0) for b in bal.values()), 2)}
        out['karigars'] = await _shared('karigar_totals', 30, load)
    return out


async def _coming_up(user: dict, s: dict, now: datetime) -> dict:
    today_d = now.date()
    start = (today_d + timedelta(days=1)).isoformat()
    end_d = today_d + timedelta(days=s['coming_up_days'])
    end = end_d.isoformat()
    items: list = []

    if can_view(user, 'repairs'):
        due: dict = {}
        async for i in db.repair_items.find({'status': {'$ne': 'delivered'}, 'due_date': {'$gte': start, '$lte': end}},
                                            {'_id': 0, 'due_date': 1, 'customer_name': 1, 'description': 1}):
            due.setdefault(i['due_date'], []).append(i)
        for d, its in due.items():
            items.append({'date': d, 'kind': 'repairs_due', 'module': 'repairs',
                          'title': f"{len(its)} repair{'s' if len(its) != 1 else ''} promised",
                          'detail': _names([f"{x.get('customer_name') or ''} {x.get('description') or ''}".strip() for x in its], 2),
                          'route': '/repairs'})

    if can_view(user, 'samples'):
        async for x in db.samples.find({'status': 'with_karigar', 'due_date': {'$gte': start, '$lte': end}},
                                       {'_id': 0, 'id': 1, 'due_date': 1, 'karigar_name': 1, 'description': 1}):
            items.append({'date': x['due_date'], 'kind': 'sample_due', 'module': 'samples', 'title': 'Sample due back',
                          'detail': ' · '.join(p for p in (x.get('karigar_name'), x.get('description')) if p),
                          'route': f"/samples/{x['id']}"})

    if can_view(user, 'gold_loans'):
        # Interest posts on every active loan on the last day of each month.
        month_end = date(today_d.year, today_d.month, monthrange(today_d.year, today_d.month)[1])
        if start <= month_end.isoformat() <= end:
            n = await db.gold_loans.count_documents({'status': 'active'})
            if n:
                items.append({'date': month_end.isoformat(), 'kind': 'loan_interest', 'module': 'gold_loans',
                              'title': 'Loan interest posts', 'detail': f"{n} active loan{'s' if n != 1 else ''}", 'route': '/loans'})

    if can_view(user, 'payroll'):
        pay_d = None
        for y, m in ((today_d.year, today_d.month), (today_d.year + (today_d.month == 12), today_d.month % 12 + 1)):
            d = date(y, m, min(s['payday_day'], monthrange(y, m)[1]))
            if today_d < d <= end_d:
                pay_d = d
                break
        if pay_d:
            prev = pay_d.replace(day=1) - timedelta(days=1)   # salaries paid for the month before payday

            async def load():
                from routers.payroll import _compute_payroll
                rows = await _compute_payroll(prev.year, prev.month)
                return {'count': len(rows), 'net': round(sum(max(r.get('net_salary') or 0, 0) for r in rows), 2)}
            p = await _shared(f'payday:{pay_d.isoformat()}', 300, load)
            items.append({'date': pay_d.isoformat(), 'kind': 'payday', 'module': 'payroll', 'title': f"Payday · {prev.strftime('%B')} salaries",
                          'detail': f"{p['count']} employee{'s' if p['count'] != 1 else ''} · ₹{p['net']:,.0f} after advances",
                          'route': f'/attendance?seg=pay&year={prev.year}&month={prev.month}'})

    items.sort(key=lambda x: x['date'])
    return {'items': items[:6], 'total': len(items), 'until': end}


# ---------------- Sections shown ----------------
# The Home sections a person can switch off for themselves (Settings › Home screen).
HOME_SECTIONS = [
    {'key': 'rates', 'label': 'Rates ticker'},
    {'key': 'cash', 'label': 'Cash in hand'},
    {'key': 'quick_actions', 'label': 'Quick actions'},
    {'key': 'needs_you', 'label': 'Needs you today'},
    {'key': 'staff', 'label': 'In the shop'},
    {'key': 'owed', 'label': 'Owed to you'},
    {'key': 'coming_up', 'label': 'Coming up'},
    {'key': 'notifications', 'label': 'Notifications'},
]


async def _notifications(user: dict) -> dict:
    """The latest few notifications and how many are unread — the same list the bell opens."""
    items, unread = await asyncio.gather(
        db.notifications.find({'user_id': user['id']}, {'_id': 0, 'id': 1, 'title': 1, 'body': 1, 'url': 1, 'read': 1, 'created_at': 1})
        .sort('created_at', -1).to_list(5),
        db.notifications.count_documents({'user_id': user['id'], 'read': False}),
    )
    return {'unread': unread, 'items': items}
SECTION_KEYS = [x['key'] for x in HOME_SECTIONS]


async def _hidden_sections(user: dict) -> list[str]:
    prefs = await db.user_prefs.find_one({'user_id': user['id']}, {'_id': 0, 'home_hidden_sections': 1}) or {}
    return [k for k in (prefs.get('home_hidden_sections') or []) if k in SECTION_KEYS]


class SectionsIn(BaseModel):
    hidden: list[str] = Field(default_factory=list, max_length=20)


@router.get('/home/sections')
async def get_sections(user: dict = Depends(get_current)):
    return {'sections': HOME_SECTIONS, 'hidden': await _hidden_sections(user)}


@router.put('/home/sections')
async def put_sections(body: SectionsIn, user: dict = Depends(get_current)):
    """Which Home sections this person hides — saved per user, so it follows them to any device."""
    hidden = [k for k in dict.fromkeys(body.hidden) if k in SECTION_KEYS]
    await db.user_prefs.update_one(
        {'user_id': user['id']},
        {'$set': {'user_id': user['id'], 'home_hidden_sections': hidden, 'updated_at': now_utc().isoformat()}},
        upsert=True,
    )
    _USER_CACHE.pop(user['id'], None)
    return {'sections': HOME_SECTIONS, 'hidden': hidden}


# ---------------- Summary ----------------
_USER_CACHE: dict = {}      # user id -> (monotonic time, summary)
_USER_LOCKS: dict = {}
CACHE_SEC = 30.0


async def _section(name: str, coro):
    """Run one section; if it fails, log it and mark just that section unavailable."""
    try:
        return await coro
    except Exception:   # noqa: BLE001 — a broken section must never take Home down
        logger.exception('home: section %s failed', name)
        return {'unavailable': True}


async def build_summary(user: dict) -> dict:
    t0 = time.monotonic()
    now = _ist_now()
    today = now.date().isoformat()
    s, hidden = await asyncio.gather(home_settings(), _hidden_sections(user))
    show = lambda k: k not in hidden   # noqa: E731

    async def none():
        return None

    header, rates, quick = await asyncio.gather(
        _section('header', _header(user, now)),
        _section('rates', _rates(user, today, s, now)) if show('rates') else none(),
        _section('quick_actions', _quick_actions(user)) if show('quick_actions') else none(),
    )
    # Staff is also what Needs you reads for late / not-in rows, so it's built when either shows.
    want_staff = can_view(user, 'attendance') and (show('staff') or show('needs_you'))
    staff_task = asyncio.ensure_future(_section('staff', _staff_today(user, s, now))) if want_staff else None
    cash_task = asyncio.ensure_future(_section('cash', _cash(user, today))) if can_view(user, 'cash_book') and show('cash') else None
    owed_task = asyncio.ensure_future(_section('owed', _owed(user, s, now.date()))) if show('owed') else None
    coming_task = asyncio.ensure_future(_section('coming_up', _coming_up(user, s, now))) if show('coming_up') else None
    notif_task = asyncio.ensure_future(_section('notifications', _notifications(user))) if show('notifications') else None
    staff = await staff_task if staff_task else None
    needs = await _section('needs_you', _needs_you(user, s, now, staff if staff and not staff.get('unavailable') else None)) if show('needs_you') else None
    owed = await owed_task if owed_task else None
    if owed and not owed.get('unavailable') and not any(owed.get(k) for k in ('customers', 'loan_interest', 'karigars')):
        owed = None   # nothing here this person may see
    return {
        'generated_at': now_utc().isoformat(),
        'header': header,
        'rates': rates,
        'cash': await cash_task if cash_task else None,
        'quick_actions': quick,
        'needs_you': needs,
        'staff': staff if show('staff') else None,
        'owed': owed,
        'coming_up': await coming_task if coming_task else None,
        'notifications': await notif_task if notif_task else None,
        'hidden_sections': hidden,
        'settings': s,
        'took_ms': round((time.monotonic() - t0) * 1000),
    }


@router.get('/home/summary')
async def home_summary(fresh: bool = Query(default=False), user: dict = Depends(get_current)):
    """The whole Home briefing in one call. Cached per user for 30 s; `fresh=1` (pull to
    refresh) rebuilds it now."""
    uid = user['id']
    hit = _USER_CACHE.get(uid)
    if hit and not fresh and time.monotonic() - hit[0] < CACHE_SEC:
        return {**hit[1], 'cached': True}
    lock = _USER_LOCKS.setdefault(uid, asyncio.Lock())
    async with lock:
        hit = _USER_CACHE.get(uid)
        if hit and not fresh and time.monotonic() - hit[0] < CACHE_SEC:
            return {**hit[1], 'cached': True}
        data = await build_summary(user)
        _USER_CACHE[uid] = (time.monotonic(), data)
        return {**data, 'cached': False}


@router.get('/home/quick-actions/catalog')
async def quick_actions_catalog(_: dict = Depends(get_current)):
    return QUICK_ACTIONS
