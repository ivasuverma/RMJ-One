from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import math
from pathlib import Path
from pydantic import BaseModel
from typing import List, Optional, Literal, Dict
import uuid
from datetime import datetime, timedelta, timezone, date
import bcrypt
import jwt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ.get('JWT_SECRET', 'rmj-one-dev-secret-change-in-prod')
JWT_ALGO = 'HS256'
JWT_EXPIRE_MIN = 60 * 24 * 7

VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', '')
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', '')
VAPID_SUBJECT = os.environ.get('VAPID_SUBJECT', 'mailto:admin@example.com')

# Self-hosted OpenWA WhatsApp gateway (E:/OpenWA on this same box, NSSM
# service RMJOneWhatsApp) — see send_whatsapp() below.
OPENWA_BASE_URL = os.environ.get('OPENWA_BASE_URL', '')
OPENWA_API_KEY = os.environ.get('OPENWA_API_KEY', '')
OPENWA_SESSION_NAME = os.environ.get('OPENWA_SESSION_NAME', 'main')

# Daily gold-rate broadcast (see gold_rate.py) — the shop's own WhatsApp
# Channel id ("Ram Murti Jewellers", subscribed via the OPENWA_SESSION_NAME
# account) and the reference page it scrapes. Rarely changes, so it's env
# config like the OpenWA settings above rather than an in-app setting.
GOLD_RATE_CHANNEL_ID = os.environ.get('GOLD_RATE_CHANNEL_ID', '120363420612158717@newsletter')
GOLD_RATE_SOURCE_URL = os.environ.get('GOLD_RATE_SOURCE_URL', 'https://ayodhyabullion.com')
GOLD_RATE_ROW_LABEL = os.environ.get('GOLD_RATE_ROW_LABEL', 'GOLD RETAIL HAJIR')
GOLD_RATE_SILVER_LABEL = os.environ.get('GOLD_RATE_SILVER_LABEL', 'SILVER RETAIL HAJIR')

# Comma-separated list of origins allowed to call this API, e.g.
# "https://app.ramjewellers.in,https://admin.ramjewellers.in". Defaults to
# "*" (anything) so local/dev setups keep working without extra config —
# but ENVIRONMENT=production below refuses to boot with an unset JWT_SECRET,
# so treat ALLOWED_ORIGINS the same way in your prod .env.
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get('ALLOWED_ORIGINS', '*').split(',') if o.strip()] or ['*']

ENVIRONMENT = os.environ.get('ENVIRONMENT', 'development')
if ENVIRONMENT == 'production' and JWT_SECRET == 'rmj-one-dev-secret-change-in-prod':
    raise RuntimeError(
        'Refusing to start: ENVIRONMENT=production but JWT_SECRET is still the default dev value. '
        'Set a real JWT_SECRET in backend/.env before running in production.'
    )
if ENVIRONMENT == 'production' and ALLOWED_ORIGINS == ['*']:
    raise RuntimeError(
        'Refusing to start: ENVIRONMENT=production but ALLOWED_ORIGINS is still "*" (wide open CORS). '
        'Set a real comma-separated origin list in backend/.env, e.g. '
        'ALLOWED_ORIGINS=https://app.ramjewellers.in,https://admin.ramjewellers.in'
    )

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="RMJ One API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rmj-one")

# ---------------- Utils ----------------
def hash_secret(s: str) -> str:
    return bcrypt.hashpw(s.encode(), bcrypt.gensalt(rounds=10)).decode()


def verify_secret(s: str, hashed: str) -> bool:
    try: return bcrypt.checkpw(s.encode(), hashed.encode())
    except Exception: return False


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# Every shift/grace-period/attendance calculation in this file assumes IST,
# so "today" has to mean IST-today everywhere too. A single shared constant
# instead of each call site spelling out timezone(timedelta(hours=5,
# minutes=30))) on its own — used to be duplicated ~12 times, which is how
# today_str() below drifted to UTC while the rest of the file didn't.
IST = timezone(timedelta(hours=5, minutes=30))


def today_str() -> str:
    # IST, not UTC/system date. A UTC-based "today" would make any record
    # written between 00:00-05:29 UTC (5:30am-11:00am IST) look like it
    # belongs to the wrong day everywhere this is used to query back —
    # this bit biometric punches landing in that window (see
    # _ingest_biometric_punch, which already computed the date in IST;
    # today_str() previously didn't, so the two disagreed).
    return datetime.now(IST).date().isoformat()


def haversine_m(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    R = 6371000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lng - a_lng)
    x = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(x))


def create_token(payload: dict) -> str:
    now = now_utc()
    body = {**payload, 'iat': now, 'exp': now + timedelta(minutes=JWT_EXPIRE_MIN)}
    return jwt.encode(body, JWT_SECRET, algorithm=JWT_ALGO)


async def get_current(authorization: str = Header(default='')) -> dict:
    if not authorization.lower().startswith('bearer '):
        raise HTTPException(status_code=401, detail='Missing bearer token')
    token = authorization.split(' ', 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail='Token expired')
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail='Invalid token')
    role = payload.get('role')
    if role in ('owner', 'admin', 'accountant'):
        u = await db.users.find_one({'id': payload.get('sub')}, {'_id': 0, 'password_hash': 0})
    else:
        u = await db.employees.find_one({'id': payload.get('sub')}, {'_id': 0, 'password_hash': 0})
    if not u:
        raise HTTPException(status_code=401, detail='User not found')
    u['role'] = role
    return u


def require_owner(user=Depends(get_current)):
    if user.get('role') != 'owner':
        raise HTTPException(status_code=403, detail='Owner access required')
    return user


def require_admin(user=Depends(get_current)):
    """Owner or admin — for employee management, corrections, leaves."""
    if user.get('role') not in ('owner', 'admin'):
        raise HTTPException(status_code=403, detail='Admin access required')
    return user


def require_staff(user=Depends(get_current)):
    """Owner, admin, or accountant."""
    if user.get('role') not in ('owner', 'admin', 'accountant'):
        raise HTTPException(status_code=403, detail='Staff access required')
    return user


def require_payroll_writer(user=Depends(get_current)):
    """Owner or accountant."""
    if user.get('role') not in ('owner', 'accountant'):
        raise HTTPException(status_code=403, detail='Payroll access required')
    return user


def require_employee(user=Depends(get_current)):
    if user.get('role') != 'employee':
        raise HTTPException(status_code=403, detail='Employee access required')
    return user


# ---------------- Module Access (User Roles) ----------------
# The app used to gate everything purely by role (owner/admin/accountant/employee).
# This adds a finer-grained layer on top: every account can be granted an explicit
# list of modules it's allowed to see, overriding its role's default set. Owner
# always gets every module — it can't lock itself out of its own app.
MODULE_DEFS = [
    {'key': 'dashboard', 'label': 'Dashboard', 'default_roles': ['owner', 'admin', 'accountant']},
    {'key': 'attendance', 'label': 'Attendance', 'default_roles': ['owner', 'admin']},
    {'key': 'team', 'label': 'Team', 'default_roles': ['owner', 'admin']},
    {'key': 'payroll', 'label': 'Payroll', 'default_roles': ['owner', 'admin', 'accountant']},
    # Approvals/Tasks are owner/admin-only now — no longer grantable to employee
    # accounts (previously employee_assignable). Deliberately kept as plain
    # modules rather than deleted so owner/admin staff-account access is unaffected.
    {'key': 'approvals', 'label': 'Approvals', 'default_roles': ['owner', 'admin']},
    {'key': 'reports', 'label': 'Reports', 'default_roles': ['owner', 'admin', 'accountant']},
    {'key': 'biometric', 'label': 'Biometric Devices', 'default_roles': ['owner']},
    {'key': 'audit', 'label': 'Audit Log', 'default_roles': ['owner']},
    {'key': 'user_roles', 'label': 'User Roles', 'default_roles': ['owner']},
    {'key': 'shifts', 'label': 'Shifts', 'default_roles': ['owner']},
    {'key': 'holidays', 'label': 'Holidays', 'default_roles': ['owner']},
    {'key': 'departments', 'label': 'Departments', 'default_roles': ['owner']},
    {'key': 'locations', 'label': 'Locations', 'default_roles': ['owner']},
    {'key': 'store_settings', 'label': 'Store Settings', 'default_roles': ['owner']},
    {'key': 'users', 'label': 'Staff Accounts', 'default_roles': ['owner']},
    {'key': 'tasks', 'label': 'Tasks', 'default_roles': ['owner', 'admin']},
    # The modules an employee can be granted, matching the tiles they're ever
    # shown: Transactions > Repair, Sample Issue/Receive; Reports > Customer
    # Ledger, Karigar Ledger. Creating, tracking AND billing a repair are one
    # module ("repairs") — the old separate "repair_bill" grant was merged in
    # (see the legacy alias in resolve_modules), so a single grant covers the
    # whole repair lifecycle end to end.
    {'key': 'repairs', 'label': 'Repair', 'default_roles': ['owner', 'admin'], 'employee_assignable': True},
    {'key': 'customer_ledger', 'label': 'Customer Ledger', 'default_roles': ['owner', 'admin', 'accountant'], 'employee_assignable': True},
    {'key': 'karigar_ledger', 'label': 'Karigar Ledger', 'default_roles': ['owner', 'admin', 'accountant'], 'employee_assignable': True},
    {'key': 'samples', 'label': 'Stock In/Out', 'default_roles': ['owner', 'admin'], 'employee_assignable': True},
    {'key': 'cash_book', 'label': 'Cash Book', 'default_roles': ['owner', 'admin', 'accountant'], 'employee_assignable': True},
    # Unified dual-balance ledger (v2 Phase 5) — the single account list with
    # per-account fine (g) + amount (₹) balances. Staff-level; not granted to
    # employee accounts (they see only their own wage/advance ledger elsewhere).
    {'key': 'ledger', 'label': 'Ledger', 'default_roles': ['owner', 'admin', 'accountant']},
    # Documents — snap/record photos of receipts, KYC, cash sheets, bills,
    # statements. Per-category role visibility is layered on top (see
    # document_categories); this module just gates the Work-tab row.
    {'key': 'documents', 'label': 'Documents', 'default_roles': ['owner', 'admin', 'accountant'], 'employee_assignable': True},
    # Not employee_assignable by default — this module hands shop cash to a
    # customer against collateral and auto-accrues interest, a different risk
    # level than issuing a repair/sample tag; owner/admin/accountant only
    # unless an owner deliberately grants it further.
    {'key': 'gold_loans', 'label': 'Gold Loans', 'default_roles': ['owner', 'admin', 'accountant']},
    # Fetching/sending the daily rate is a "do the job" action like repairs/
    # samples — assignable to a trusted employee (e.g. whoever runs the
    # WhatsApp Channel). The margin/fetch-time CONFIG stays owner-only
    # regardless (enforced directly with require_owner, not this module) —
    # it's pricing policy, not a task.
    {'key': 'gold_rate', 'label': 'Gold Rate Channel', 'default_roles': ['owner', 'admin'], 'employee_assignable': True},
]
MODULE_KEYS = {m['key'] for m in MODULE_DEFS}
MODULE_DEFAULT_ROLES = {m['key']: set(m['default_roles']) for m in MODULE_DEFS}
# The subset of modules that can be handed to an employee account (as opposed to
# only owner/admin/accountant staff accounts) — these are the ones whose screens
# live outside the owner-only tab shell and are actually reachable by employees.
EMPLOYEE_ASSIGNABLE_MODULES = {m['key'] for m in MODULE_DEFS if m.get('employee_assignable')}


def _default_modules_for_role(role: str) -> list:
    return sorted(k for k, roles in MODULE_DEFAULT_ROLES.items() if role in roles)


def resolve_modules(user: dict) -> list:
    """Owner always has every module. Otherwise an explicit `module_access` list
    (which may be set to []) overrides the role's default set; module_access being
    absent/None means 'use whatever this role normally gets'.

    An employee's override is additionally clamped to EMPLOYEE_ASSIGNABLE_MODULES
    (belt-and-suspenders alongside the same check in update_access) — so if a
    module is ever removed from that set (as tasks/approvals were), any account
    that still has it stored from before loses access immediately, with no
    separate data migration needed."""
    if user.get('role') == 'owner':
        return sorted(MODULE_KEYS)
    override = user.get('module_access')
    if override is not None:
        # Legacy alias: "repair_bill" was merged into "repairs" (one module now
        # covers the whole repair lifecycle incl. billing). Any account still
        # storing the old grant keeps working — no data migration needed.
        override = ['repairs' if m == 'repair_bill' else m for m in override]
        rights = user.get('module_rights')
        if isinstance(rights, dict) and 'repair_bill' in rights and 'repairs' not in rights:
            rights['repairs'] = rights['repair_bill']
        allowed = EMPLOYEE_ASSIGNABLE_MODULES if user.get('role') == 'employee' else MODULE_KEYS
        return sorted(set(override) & allowed)
    return _default_modules_for_role(user.get('role', ''))


def require_module(key: str):
    def _check(user=Depends(get_current)):
        if key not in resolve_modules(user):
            raise HTTPException(status_code=403, detail=f'No access to "{key}"')
        return user
    return _check


# ---------------- Employee-assignable module access (repairs/repair_bill/customer_ledger/karigar_ledger) ----------------
# Everything above (require_admin/require_staff) hard-rejects role == 'employee',
# because most of the app (payroll, HR, settings) should never be touchable by an
# employee account no matter what. But an owner can now explicitly hand an employee
# one of the EMPLOYEE_ASSIGNABLE_MODULES — at that point the employee needs to be
# able to actually call the endpoints behind it. These three helpers are the employee
# on-ramp for exactly those modules; every other endpoint in the app is untouched.
#
# `key` may be a single module key, or a list of keys checked any-of (used where
# a screen is reachable via more than one grant — e.g. browsing repair items is
# needed both to work a repair AND to bill one, so it accepts either module).
#
# - require_staff_or_module: read access. Owner/admin/accountant always pass (same
#   as require_staff always did); an employee passes only if the module is resolved
#   for them.
# - require_admin_or_module: the "do the job" actions — creating/advancing records
#   (issue to karigar, receive from karigar, create a task, etc). Owner/admin always
#   pass; an employee passes with module access alone, no extra right needed.
# - require_admin_or_module_right: editing or deleting records that already exist.
#   Owner/admin always pass; an employee additionally needs module_rights[key][right]
#   explicitly set True by an owner in User Roles. This is the "if edit or delete
#   rights are disabled the employee cannot make changes" behavior. Always a single
#   key — a right is granted per-module, never shared across an any-of group.
def _keys_label(key) -> str:
    return key if isinstance(key, str) else '/'.join(key)


def _has_any_module(user: dict, key) -> bool:
    keys = [key] if isinstance(key, str) else key
    resolved = resolve_modules(user)
    return any(k in resolved for k in keys)


def require_staff_or_module(key):
    def _check(user=Depends(get_current)):
        role = user.get('role')
        if role in ('owner', 'admin', 'accountant'):
            return user
        if role == 'employee' and _has_any_module(user, key):
            return user
        raise HTTPException(status_code=403, detail=f'No access to "{_keys_label(key)}"')
    return _check


def _accountant_has_any_module(key) -> bool:
    keys = [key] if isinstance(key, str) else key
    return any('accountant' in MODULE_DEFAULT_ROLES.get(k, set()) for k in keys)


def require_admin_or_module(key):
    def _check(user=Depends(get_current)):
        role = user.get('role')
        if role in ('owner', 'admin'):
            return user
        # An accountant gets the same "do the job" pass as admin, but only for
        # modules that actually list accountant as a default role (e.g.
        # customer_ledger, karigar_ledger, cash_book) — modules like repairs or
        # samples that don't include accountant stay owner/admin-only, same as
        # before. Otherwise accountant could view a module (require_staff_or_module
        # always lets accountant through) but never act on it, which is the bug
        # this closes.
        if role == 'accountant' and _accountant_has_any_module(key):
            return user
        if role == 'employee' and _has_any_module(user, key):
            return user
        raise HTTPException(status_code=403, detail=f'No access to "{_keys_label(key)}"')
    return _check


def require_admin_or_module_right(key: str, right: str):
    def _check(user=Depends(get_current)):
        role = user.get('role')
        if role in ('owner', 'admin'):
            return user
        # See require_admin_or_module above — accountant is trusted like admin
        # (no separate module_rights concept for accountant accounts), but only
        # for modules where accountant is a configured default role.
        if role == 'accountant' and 'accountant' in MODULE_DEFAULT_ROLES.get(key, set()):
            return user
        if role == 'employee' and key in resolve_modules(user):
            rights = (user.get('module_rights') or {}).get(key) or {}
            if rights.get(right):
                return user
            raise HTTPException(status_code=403, detail=f'You do not have {right} rights on "{key}"')
        raise HTTPException(status_code=403, detail=f'No access to "{key}"')
    return _check


# ---------------- Models ----------------
class LoginIn(BaseModel):
    username: str
    password: str


class EmployeeLoginIn(BaseModel):
    username: str
    password: str


class SetEmployeeCredentialsIn(BaseModel):
    username: str
    password: str


class EmployeeIn(BaseModel):
    name: str
    employee_code: Optional[str] = None
    biometric_id: Optional[str] = ''  # device-side user/person ID, e.g. "1" — set this when the
                                       # biometric device's enrolled IDs don't match employee_code
    department_id: Optional[str] = None
    location_id: Optional[str] = None
    designation: Optional[str] = ''
    shift: Optional[str] = 'General'
    salary: float = 0
    joining_date: Optional[str] = None
    mobile: Optional[str] = ''
    address: Optional[str] = ''
    gender: Optional[str] = None
    guardian_name: Optional[str] = ''
    aadhaar: Optional[str] = ''
    pan: Optional[str] = ''
    bank_account: Optional[str] = ''
    bank_ifsc: Optional[str] = ''
    bank_name: Optional[str] = ''
    photo: Optional[str] = ''
    status: Literal['active', 'inactive', 'on_leave'] = 'active'
    # Last working day (inclusive) — set when marking an employee as left.
    # Feeds payroll's day-window proration (see _compute_payroll) so a month
    # they departed mid-way through isn't paid in full. Cleared on
    # reactivation, same as deactivated_at.
    left_date: Optional[str] = None
    notes: Optional[str] = ''
    # Recurring monthly advance — e.g. a fixed ₹5,000 auto-recorded as a salary
    # advance every 5th of the month. Flows into the existing 'advance' ledger
    # type, so it's automatically deducted by payroll like any manual advance;
    # the rest of that month's salary gets paid normally (e.g. by cash).
    auto_advance_amount: Optional[float] = None
    auto_advance_day: Optional[int] = None  # 1-31; clamped to the month's last day


class StoreSettingsIn(BaseModel):
    name: str = 'Ram Murti Jewellers'
    latitude: float
    longitude: float
    radius_m: int = 150
    work_start: str = '10:00'  # HH:MM
    work_end: str = '19:30'
    grace_min: int = 15
    round_net_salary: bool = False
    # Sunday is auto-paid as a weekly-off by default. When True (the
    # historical, always-on behavior — default True so existing shops see no
    # change), a Sunday forfeits that auto-pay if the whole Mon-Sat before it
    # was a genuine absence (see _compute_payroll in payroll.py). Off means
    # every Sunday is paid regardless of the preceding week's attendance.
    unpaid_sunday_after_absent_week: bool = True
    # When False, employees can't self-mark attendance from the app (GPS+selfie
    # check-in/check-out) — the buttons are disabled in their profile. Meant for
    # shops that have switched fully to a biometric device as the attendance
    # source of truth. Enforced server-side too (see /attendance/check-in and
    # /attendance/check-out), not just hidden client-side.
    app_checkin_enabled: bool = True
    # WiFi ESC/POS thermal receipt printer (e.g. Retsol RTP82) — raw socket
    # printing on the standard JetDirect/RAW port, no driver needed. Left
    # unset means no printer is configured and print actions will 400.
    printer_ip: Optional[str] = None
    printer_port: int = 9100
    # Shared secret for the eBioServer webhook receiver (?key=... query param).
    # eBioServer's Master Settings only has one "Web URL" field for the whole
    # app (not per-device), so this is one shop-wide key rather than a
    # per-device secret. Leave blank to accept unauthenticated pushes (fine
    # if the tunnel/network is already trusted).
    biometric_webhook_secret: Optional[str] = None


class PunchIn(BaseModel):
    latitude: float
    longitude: float
    selfie: str  # base64 data URI or raw base64


class CorrectionIn(BaseModel):
    date: Optional[str] = None  # YYYY-MM-DD, default today
    reason_type: Literal['forgot_check_in', 'forgot_check_out', 'machine_error', 'other']
    note: Optional[str] = ''


class LeaveIn(BaseModel):
    from_date: str
    to_date: str
    leave_type: Literal['casual', 'sick', 'paid', 'unpaid'] = 'casual'
    reason: Optional[str] = ''


class DecisionIn(BaseModel):
    action: Literal['approve', 'reject']
    note: Optional[str] = ''


class IdProofIn(BaseModel):
    name: str
    data_uri: str  # base64 data URI (image or PDF)


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: dict
    expirationTime: Optional[float] = None


# ---- M2B additions ----
class UserCreateIn(BaseModel):
    username: str
    name: str
    password: str
    role: Literal['owner', 'admin', 'accountant']


class UserUpdateIn(BaseModel):
    username: Optional[str] = None
    name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[Literal['owner', 'admin', 'accountant']] = None


class SelfAccountUpdateIn(BaseModel):
    current_password: str
    new_name: Optional[str] = None
    new_username: Optional[str] = None
    new_password: Optional[str] = None


class ModuleAccessUpdateIn(BaseModel):
    # None = "use this account's role default"; [] = "explicitly no modules";
    # a list = "exactly these modules", regardless of role default.
    module_access: Optional[List[str]] = None
    # Per-module edit/delete rights for employee-assignable modules only, e.g.
    # {'repairs': {'edit': True, 'delete': False}}. A module with access but no
    # entry here (or entries left False) means the employee can do the module's
    # everyday actions but cannot edit or delete existing records.
    module_rights: Optional[Dict[str, Dict[str, bool]]] = None
    # Which Cash Book counters (routers/cashbook.py) this employee can see and
    # use — a sub-permission of the 'cash_book' module itself. None/omitted or
    # [] means none assigned yet; having the module alone is not enough, the
    # owner must explicitly pick counters here (unlike other employee-assignable
    # modules, which don't have a further sub-resource to restrict).
    cashbook_counter_ids: Optional[List[str]] = None
    # Master notification switch for this account (push + in-app bell). None =
    # leave unchanged; True/False sets it.
    notifications_enabled: Optional[bool] = None
    # Per-module notification opt-in, e.g. {'attendance': True, 'payroll': False}.
    # A module left out falls back to that module's default roles. None = leave
    # unchanged.
    notif_prefs: Optional[Dict[str, bool]] = None
    # Per-category document permissions, e.g.
    # {'kyc': {'view': True, 'record': False}}. None = leave unchanged. When an
    # account has this set, it overrides the category's role-based visibility.
    doc_category_rights: Optional[Dict[str, Dict[str, bool]]] = None
    # Whether this account can browse the Documents "Done" folder. None = leave
    # unchanged.
    doc_see_done: Optional[bool] = None


class ShiftIn(BaseModel):
    name: str
    start: str  # HH:MM
    end: str    # HH:MM
    grace_min: int = 15
    # "Late master": if set (>0), a check-in this many minutes past start+grace turns
    # the whole day into a half-day for payroll, even if full hours were later worked.
    late_half_day_after_min: Optional[int] = None
    # Work-from-home shift: employees on it don't record attendance at all. They
    # never appear on the Attendance screen or get missed-check reminders, and
    # payroll pays their full set salary every month regardless of punches.
    remote: bool = False
    is_active: bool = True


class HolidayIn(BaseModel):
    date: str  # YYYY-MM-DD
    name: str
    type: Literal['public', 'festival', 'store_closed'] = 'public'


class DepartmentIn(BaseModel):
    name: str
    is_active: bool = True


class LocationIn(BaseModel):
    name: str
    address: Optional[str] = ''
    is_active: bool = True


class LedgerEntryIn(BaseModel):
    employee_id: str
    entry_type: Literal['advance', 'bonus', 'fine', 'deduction', 'other']
    amount: float
    date: Optional[str] = None
    note: Optional[str] = ''


class LedgerEntryEdit(BaseModel):
    entry_type: Literal['advance', 'bonus', 'fine', 'deduction', 'other']
    amount: float
    note: Optional[str] = ''


class PayrollGenerateIn(BaseModel):
    month: int  # 1-12
    year: int


class PayrollAdjustIn(BaseModel):
    bonus: Optional[float] = 0
    fine: Optional[float] = 0
    manual_deduction: Optional[float] = 0
    note: Optional[str] = ''
    paid: Optional[bool] = None


class PayrollEntryUpdateIn(BaseModel):
    bonus_override: Optional[float] = None
    fine_override: Optional[float] = None
    manual_deduction_override: Optional[float] = None
    paid_days_override: Optional[float] = None
    note: Optional[str] = None


class AttendanceDayIn(BaseModel):
    status: Literal['present', 'absent', 'half_day', 'leave', 'holiday', 'weekly_off'] = 'present'
    check_in_time: Optional[str] = None   # HH:MM (local)
    check_out_time: Optional[str] = None  # HH:MM (local)
    working_hours: Optional[float] = None
    note: Optional[str] = ''


class CalendarCorrectionIn(BaseModel):
    date: str
    desired_check_in: Optional[str] = None   # HH:MM
    desired_check_out: Optional[str] = None  # HH:MM
    reason_type: Literal['forgot_check_in', 'forgot_check_out', 'machine_error', 'other'] = 'other'
    note: Optional[str] = ''


# ---------------- Tasks ----------------
class TaskIn(BaseModel):
    title: str
    description: Optional[str] = ''
    assigned_to: str  # employee_id
    priority: Literal['low', 'normal', 'urgent'] = 'normal'
    due_date: Optional[str] = None  # YYYY-MM-DD
    due_time: Optional[str] = None  # HH:MM, optional — paired with due_date
    # Points (shown to the assignee as stars) earned if this task is
    # completed by its due date/time. 0 = no points system on this task.
    points: int = 0
    # When true, the assignee gets a repeating nudge notification every few
    # hours until the task is marked done — not extra recipients, just
    # persistence, for tasks that tend to get forgotten.
    repeat_reminder: bool = False
    # Caps how many repeat_reminder nudges get sent — None keeps nudging
    # until the task is done (the original, unbounded behavior).
    max_reminders: Optional[int] = None
    # How often those nudges go out — every hour or once a day.
    reminder_interval: Literal['hourly', 'daily'] = 'hourly'


class TaskUpdateIn(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    assigned_to: Optional[str] = None
    priority: Optional[Literal['low', 'normal', 'urgent']] = None
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    points: Optional[int] = None
    repeat_reminder: Optional[bool] = None
    max_reminders: Optional[int] = None
    reminder_interval: Optional[Literal['hourly', 'daily']] = None


class TaskCommentIn(BaseModel):
    text: str


class TaskTemplateIn(BaseModel):
    title: str
    description: Optional[str] = ''
    assigned_to: str
    priority: Literal['low', 'normal', 'urgent'] = 'normal'
    freq: Literal['hourly', 'daily', 'weekly', 'monthly', 'yearly'] = 'daily'
    # First date this template is eligible to generate an instance — also
    # the anchor for weekly/monthly/yearly (same weekday / day-of-month /
    # month+day as this date), so there's no separate weekday picker.
    # Optional only so a template predating this field (weekly, anchored by
    # the old standalone `weekday`) can still be edited/paused without
    # suddenly needing one — _check_recurring_tasks falls back accordingly.
    start_date: Optional[str] = None
    interval_hours: Optional[int] = 1  # required when freq='hourly' — spawn a fresh instance every N hours
    due_time: Optional[str] = None  # optional due time-of-day applied to each generated instance
    points: int = 0  # stars awarded per on-time completion of each generated instance
    repeat_reminder: bool = False  # each generated instance nudges the assignee until done
    max_reminders: Optional[int] = None
    reminder_interval: Literal['hourly', 'daily'] = 'hourly'
    # At most one of these — how the recurrence ends. Neither set = repeats
    # indefinitely until paused/deleted.
    max_repetitions: Optional[int] = None  # capped at 120, matching the schedule-transfer UI this mirrors
    end_date: Optional[str] = None
    active: bool = True


# ---------------- Repairs ----------------
class CustomerIn(BaseModel):
    name: str
    mobile: Optional[str] = ''
    address: Optional[str] = ''
    notes: Optional[str] = ''


class KarigarIn(BaseModel):
    name: str
    mobile: Optional[str] = ''
    is_employee: bool = False
    employee_id: Optional[str] = None  # required when is_employee is True
    active: bool = True


class RepairTypeIn(BaseModel):
    name: str
    default_labour: float = 0
    requires_karigar_default: bool = False
    active: bool = True


class ItemMasterIn(BaseModel):
    # Predefined item/purity master — e.g. "22K Ring" @ 91.6%, "18K Chain" @ 75%.
    # Picking one on a repair item snapshots its purity onto the item so the
    # karigar's gold ledger can be tracked in fine-gold-equivalent terms.
    name: str
    purity: float = 100.0  # % fine gold, e.g. 91.6 for 22K, 75 for 18K, 100 for fine/pure gold
    category: Optional[str] = ''
    active: bool = True


class RepairItemSpec(BaseModel):
    item_master_id: Optional[str] = None  # Items Master reference; purity snapshotted at creation
    description: str
    repair_type: Optional[str] = ''  # RepairType name, prefills labour/needs_karigar client-side
    gross_weight: float = 0
    pc_count: int = 1
    labour_charge: float = 0
    needs_karigar: bool = False
    due_date: Optional[str] = None
    stone_notes: Optional[str] = ''
    notes: Optional[str] = ''
    intake_photo: Optional[str] = ''  # base64 data URI


class RepairOrderIn(BaseModel):
    customer_id: Optional[str] = None  # existing customer, or...
    new_customer: Optional[CustomerIn] = None  # ...create one inline
    items: List[RepairItemSpec]


class RepairItemUpdateIn(BaseModel):
    description: Optional[str] = None
    repair_type: Optional[str] = None
    gross_weight: Optional[float] = None
    pc_count: Optional[int] = None
    labour_charge: Optional[float] = None
    due_date: Optional[str] = None
    notes: Optional[str] = None


class IssueToKarigarIn(BaseModel):
    # Optional — leaving this blank means the tag doesn't need a karigar at
    # all (in-house work, or nothing further to do) and skips straight to
    # Pending to Bill, the same effect the old separate "Mark Ready" action
    # had. Picking a karigar behaves exactly as issuing always has.
    karigar_id: Optional[str] = None
    # No weight field — the whole tag goes out, so weight issued always equals
    # the item's own gross_weight. Server derives it; never trust client input here.
    note: Optional[str] = ''


class ReceiveFromKarigarIn(BaseModel):
    weight: float
    note: Optional[str] = ''
    # Photo of the karigar's physical slip/voucher for this receive — kept on
    # the transaction (and the main ledger entry) so it can be pulled up later
    # from the karigar's ledger without digging through paper.
    slip_photo: Optional[str] = ''
    # Loss declared during the repair process (filing, polishing, etc.) — it's
    # forgiven back into what's credited (inherent to the work, not the
    # karigar's fault): new_wt = issued - loss - received.
    process_loss: Optional[float] = 0
    # Wastage the karigar is explicitly claiming (metal used/lost doing the
    # work, on their own account). Unlike loss, this is NOT forgiven — it adds
    # to the outstanding balance: karigar_gap = new_wt + wastage; balance (fine g) = karigar_gap x touch%.
    wastage_weight: Optional[float] = 0
    # Touch/purity of the metal actually coming back this time — editable since
    # it can differ from the item's issued purity (mixed lots, karigar's own
    # stated assay, etc). Defaults to the item's own purity when not given.
    purity_override: Optional[float] = None
    # Optional on-the-spot settlement of what the shop owes the karigar for this
    # job — split across cash and metal (gold handed over, valued in ₹ manually
    # since there's no live rate feed). Posts straight to the Karigar Ledger.
    labour_amount: Optional[float] = 0
    pay_cash: Optional[float] = 0
    pay_metal_weight: Optional[float] = 0
    pay_metal_value: Optional[float] = 0
    # ...and the reverse: the karigar settling a shortfall by handing the shop
    # cash and/or extra metal, right here at receive time.
    recv_cash: Optional[float] = 0
    recv_metal_weight: Optional[float] = 0


class KarigarTransactionEditIn(BaseModel):
    # Issue edits: change which karigar it went to and/or the note. Weight is
    # never editable here — it always equals the item's gross weight, exactly
    # as at issue time (same rule as creating an issue).
    karigar_id: Optional[str] = None
    note: Optional[str] = ''
    # Receive edits: the same full field set as ReceiveFromKarigarIn, so
    # correcting a receive re-opens the same full form used to create it
    # rather than a bare weight box. `weight` is required for a receive edit.
    weight: Optional[float] = None
    slip_photo: Optional[str] = ''
    process_loss: Optional[float] = 0
    wastage_weight: Optional[float] = 0
    purity_override: Optional[float] = None
    labour_amount: Optional[float] = 0
    pay_cash: Optional[float] = 0
    pay_metal_weight: Optional[float] = 0
    pay_metal_value: Optional[float] = 0
    recv_cash: Optional[float] = 0
    recv_metal_weight: Optional[float] = 0


class DeliverIn(BaseModel):
    # Itemized billing: each line is optional and defaults sensibly so old
    # clients / quick deliveries still work with just a payment mode.
    labour_charge: Optional[float] = None  # defaults to the item's own labour_charge
    material_adjustment: Optional[float] = None  # defaults to any customer-charged adjustment set at receive time
    extra_charges: Optional[float] = 0
    extra_charges_note: Optional[str] = ''
    # Any earlier outstanding balance this customer still owes (manually entered
    # by staff, since there's no running customer AR ledger) — folded into this
    # bill's total so it isn't forgotten.
    previous_balance: Optional[float] = 0
    payment_mode: Optional[str] = 'cash'
    note: Optional[str] = ''
    final_photo: Optional[str] = ''
    # The rate (Rs/g) and value-add (g) that produced material_adjustment —
    # persisted purely so the weight breakdown can be shown on the printed
    # bill/quotation and pre-filled correctly when re-opening the bill to
    # edit it (previously only the resulting ₹ figure was kept).
    weight_rate: Optional[float] = 0
    value_add: Optional[float] = 0


class CloseDeliveryIn(BaseModel):
    # Closing a repair (customer physically picks the item up) is now a
    # separate step from billing it — see repairs.py's close_delivery.
    # Both default sensibly so a quick "just close it" tap still works.
    delivered_at: Optional[str] = None  # date YYYY-MM-DD; defaults to today
    delivered_by: Optional[str] = ''    # defaults to the acting staff member's name


class KarigarLedgerEntryIn(BaseModel):
    type: Literal['labour_payable', 'payment', 'receipt', 'adjustment', 'gold_out', 'gold_in']
    amount: Optional[float] = 0   # ₹ types (labour_payable/payment/adjustment)
    weight: Optional[float] = 0   # gold types (gold_out/gold_in) — entered directly in fine-gold grams
    note: Optional[str] = ''


# ---------------- Samples (gold sample pieces issued to a karigar, expected back at the same weight) ----------------
class SampleItemSpec(BaseModel):
    description: str
    tag_number: Optional[str] = ''
    weight: float
    pc_count: int = 1
    photo: Optional[str] = ''


class SampleIn(BaseModel):
    karigar_id: str
    note: Optional[str] = ''
    # What the sample is going out for (e.g. "quoting", "reference",
    # "exhibition") — free text, voucher-level, same for every item in the batch.
    issue_type: Optional[str] = ''
    due_date: Optional[str] = None  # when it's expected back, for the Overdue filter
    items: List[SampleItemSpec]


class SampleUpdateIn(BaseModel):
    description: Optional[str] = None
    tag_number: Optional[str] = None
    weight: Optional[float] = None
    pc_count: Optional[int] = None
    issue_type: Optional[str] = None
    due_date: Optional[str] = None
    photo: Optional[str] = None
    note: Optional[str] = None


class SampleReceiveIn(BaseModel):
    received_weight: float
    note: Optional[str] = ''


# ---------------- Loan Against Gold — see routers/gold_loans.py ----------------
class GoldLoanIn(BaseModel):
    customer_id: Optional[str] = None  # existing customer, or...
    new_customer: Optional[CustomerIn] = None  # ...create one inline
    description: str
    weight: float  # grams pledged (total, across however many pieces)
    pc_count: int = 1
    principal: float  # amount paid out to the customer
    interest_rate_percent: float  # per month, on the outstanding principal
    loan_date: Optional[str] = None  # YYYY-MM-DD, defaults to today
    estimate_return_date: Optional[str] = None
    note: Optional[str] = ''


class GoldLoanUpdateIn(BaseModel):
    # Deliberately excludes principal/interest_rate_percent/customer — changing
    # those after the fact would retroactively distort interest already posted
    # against them. Close the loan and start a new one for a genuine renegotiation.
    description: Optional[str] = None
    weight: Optional[float] = None
    pc_count: Optional[int] = None
    estimate_return_date: Optional[str] = None
    note: Optional[str] = None


class GoldLoanPaymentIn(BaseModel):
    amount: float
    type: Literal['interest', 'principal']
    date: Optional[str] = None  # YYYY-MM-DD, defaults to today
    note: Optional[str] = ''
    periods: Optional[List[str]] = None  # 'YYYY-MM' months this interest payment covers, from the calendar picker


class GoldLoanTxnUpdateIn(BaseModel):
    amount: Optional[float] = None
    date: Optional[str] = None
    note: Optional[str] = None


# ---------------- Cash Book (manual daily cash in/out ledger — see
# routers/cashbook.py; deliberately kept separate from cash_ledger, which is
# auto-populated from repair bill cash payments). Supports multiple named
# "counters" (separate cash registers/books), each with its own entries and
# its own auto-carried-forward running balance. ----------------
class CashBookEntryIn(BaseModel):
    date: str  # YYYY-MM-DD
    counter_id: str
    type: Literal['received', 'paid']
    amount: float
    name: str  # who/what — matches the paper cash book's NAME column
    note: Optional[str] = ''
    # If set, this entry is one side of a transfer between two counters —
    # the backend auto-creates the mirrored opposite-type entry on this
    # counter (e.g. this counter pays out, the other counter automatically
    # receives the same amount), linked via linked_entry_id on both.
    transfer_counter_id: Optional[str] = None


class CashBookEntryUpdateIn(BaseModel):
    date: Optional[str] = None
    counter_id: Optional[str] = None
    type: Optional[Literal['received', 'paid']] = None
    amount: Optional[float] = None
    name: Optional[str] = None
    note: Optional[str] = None


class CashBookCounterIn(BaseModel):
    name: str
    # One-time base balance for seeding this counter with a real starting
    # cash position when the shop switches over from the paper book — every
    # day after that carries forward automatically from entries alone.
    opening_balance: Optional[float] = 0


class CashBookCounterUpdateIn(BaseModel):
    name: Optional[str] = None
    opening_balance: Optional[float] = None
    active: Optional[bool] = None


class CashBookQuickNameIn(BaseModel):
    # A reusable Name/Description preset (e.g. "Milk", "Tea", "Electricity")
    # shop staff can tap to fill an entry instantly instead of retyping it
    # every time — shared across counters and both Received/Paid.
    name: str


# ---------------- Ledger: unified accounts (v2 Phase 5) ----------------
# The dual-balance core. An "account" is one entity carrying a *type* (from the
# account_types master) rather than living in a separate customer/karigar/
# employee directory. Every account and every ledger entry tracks two
# independent values: fine (pure-gold-equivalent grams, 3dp) and amount (₹).
# They are NEVER collapsed into one number — a karigar can hold fine gold while
# the shop owes them cash. This layer is additive: the existing per-party
# ledgers (karigar_ledger, repairs, employee ledger) are left intact and their
# API contracts unchanged; wiring those sources to also post here is a separate
# integration step, done deliberately so live bookkeeping isn't double-counted.
class AccountTypeIn(BaseModel):
    name: str


class AccountTypeUpdateIn(BaseModel):
    name: Optional[str] = None
    sort: Optional[int] = None


class LedgerAccountIn(BaseModel):
    type_id: str
    name: str
    phone: Optional[str] = ''
    # Opening position when the account is first created — both halves are
    # independent and either may be non-zero (or negative, if the shop already
    # owes them). Balances are always derived: opening + sum of entry deltas.
    opening_fine: Optional[float] = 0      # grams, 3dp
    opening_amount: Optional[float] = 0    # ₹
    note: Optional[str] = ''


class LedgerAccountUpdateIn(BaseModel):
    type_id: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    opening_fine: Optional[float] = None
    opening_amount: Optional[float] = None
    note: Optional[str] = None
    active: Optional[bool] = None


class LedgerAccountEntryIn(BaseModel):
    date: str  # YYYY-MM-DD
    particulars: str
    # Signed deltas — positive = owed to the shop (a debit to the account),
    # negative = owed by the shop. At least one must be non-zero; an entry may
    # move gold only, cash only, or both at once.
    fine_delta: Optional[float] = 0    # grams, 3dp, signed
    amount_delta: Optional[float] = 0  # ₹, signed
    note: Optional[str] = ''


# ---------------- Seed ----------------
async def seed():
    await db.users.create_index('username', unique=True)
    await db.employees.create_index('employee_code')
    await db.employees.create_index('biometric_id')
    await db.attendance.create_index([('employee_id', 1), ('date', 1)], unique=True)
    await db.attendance_events.create_index('created_at')
    # Added as part of the perf pass — these collections are filtered by
    # these exact fields on nearly every list/lookup call above, but had no
    # index (full collection scan every time). Cheap to create, index_exists
    # is idempotent so this is safe to run on every startup.
    await db.repair_items.create_index('order_id')
    await db.repair_items.create_index('status')
    await db.karigar_ledger.create_index('karigar_id')
    await db.karigar_transactions.create_index('item_id')
    await db.timeline.create_index('employee_id')
    await db.notifications.create_index([('user_id', 1), ('created_at', -1)])
    await db.corrections.create_index('status')
    await db.corrections.create_index('employee_id')
    await db.leaves.create_index('employee_id')
    await db.leaves.create_index('status')
    await db.payroll_entries.create_index([('year', 1), ('month', 1)])
    await db.push_subscriptions.create_index('user_id')
    await db.push_subscriptions.create_index('role')
    await db.samples.create_index('status')
    await db.cashbook_entries.create_index([('counter_id', 1), ('date', 1)])
    await db.cashbook_quick_names.create_index('name')
    await db.accounts.create_index('type_id')
    await db.accounts.create_index('name')
    await db.ledger_entries.create_index([('account_id', 1), ('date', 1)])
    # Documents: list is filtered by status/category and sorted newest-first;
    # the upload worker polls by upload_state. Without these, both scan the
    # whole collection as it grows.
    await db.documents.create_index([('status', 1), ('created_at', -1)])
    await db.documents.create_index('category_key')
    await db.documents.create_index('upload_state')
    await db.documents.create_index('client_id', sparse=True)
    await db.record_photos.create_index([('ref_type', 1), ('ref_id', 1)])
    await db.record_photos.create_index('upload_state')
    await db.record_photos.create_index('client_id', sparse=True)
    # Biometric dedupe looks up an employee's most recent punch by source.
    await db.attendance_events.create_index([('employee_id', 1), ('timestamp', -1)])

    # Seed the account-type master with the four base types the ledger is
    # built around (Customer, Karigar, Employee, Difference/Loss). They're
    # marked is_system so they can be renamed but not deleted — the ledger's
    # filter chips and the Difference/wastage sink depend on them existing.
    if await db.account_types.count_documents({}) == 0:
        base_types = [
            ('Customer', 'customer'), ('Karigar', 'karigar'),
            ('Employee', 'employee'), ('Difference (Loss)', 'difference'),
        ]
        for i, (name, key) in enumerate(base_types):
            await db.account_types.insert_one({
                'id': str(uuid.uuid4()), 'name': name, 'key': key, 'is_system': True,
                'sort': i, 'created_at': now_utc().isoformat(), 'created_by': 'system',
            })

    # Seed the Documents category master (Customer KYC, IDs, Supplier, Cash
    # Sheets, Bills, Bank/CC Statements, Expense Bills) with default per-role
    # view/record permissions — editable in Settings afterward.
    from routers.documents import seed_document_categories
    await seed_document_categories()

    # One-time setup/migration: every shop needs at least one Cash Book
    # counter to have anywhere to record entries. If none exist yet, create
    # a default "Main" one — carrying forward any balance from the old
    # single-cashbook 'settings' doc (pre-multi-counter) and backfilling any
    # entries created before counter_id existed, so nothing is orphaned.
    if await db.cashbook_counters.count_documents({}) == 0:
        legacy_settings = await db.settings.find_one({'id': 'cash_book'}, {'_id': 0})
        default_counter_id = str(uuid.uuid4())
        await db.cashbook_counters.insert_one({
            'id': default_counter_id, 'name': 'Main', 'active': True,
            'opening_balance': (legacy_settings or {}).get('opening_balance') or 0,
            'created_at': now_utc().isoformat(), 'created_by': 'system',
        })
        await db.cashbook_entries.update_many(
            {'counter_id': {'$exists': False}}, {'$set': {'counter_id': default_counter_id}},
        )

    # Idempotent backfill: make sure every customer and karigar is mirrored as
    # a unified-ledger account, so the all-in-one Ledger lists them and can
    # carry their reflected balance. Employees are deliberately NOT included —
    # they have their own dedicated Employee Ledger. Any Employee accounts that
    # a previous build auto-created here are cleaned up below.
    _type_by_key = {}
    async for _t in db.account_types.find({'key': {'$in': ['customer', 'karigar']}}, {'_id': 0, 'key': 1, 'id': 1}):
        _type_by_key[_t['key']] = _t['id']
    if _type_by_key:
        _existing_mirrors = set()
        async for _a in db.accounts.find({'source.ref': {'$exists': True}}, {'_id': 0, 'source': 1}):
            _s = _a.get('source') or {}
            if _s.get('ref'):
                _existing_mirrors.add((_s.get('kind'), _s.get('ref')))

        async def _ensure_mirror(kind, ref, name, phone):
            tid = _type_by_key.get(kind)
            if not tid or not ref or (kind, ref) in _existing_mirrors:
                return
            await db.accounts.insert_one({
                'id': str(uuid.uuid4()), 'type_id': tid, 'name': (name or '').strip(),
                'phone': (phone or '').strip(), 'opening_fine': 0, 'opening_amount': 0,
                'note': '', 'active': True, 'created_at': now_utc().isoformat(), 'created_by': 'auto',
                'source': {'kind': kind, 'ref': ref},
            })
            _existing_mirrors.add((kind, ref))

        async for _c in db.customers.find({}, {'_id': 0, 'id': 1, 'name': 1, 'mobile': 1}):
            await _ensure_mirror('customer', _c['id'], _c.get('name'), _c.get('mobile'))
        async for _k in db.karigars.find({}, {'_id': 0, 'id': 1, 'name': 1, 'phone': 1, 'mobile': 1}):
            await _ensure_mirror('karigar', _k['id'], _k.get('name'), _k.get('phone') or _k.get('mobile'))

    # Clean up Employee accounts that an earlier build auto-mirrored into the
    # unified ledger. Only remove auto-created ones with no manual entries, so a
    # deliberately-added account (if any) is never touched.
    async for _ea in db.accounts.find({'source.kind': 'employee'}, {'_id': 0, 'id': 1, 'created_by': 1}):
        if _ea.get('created_by') != 'auto':
            continue
        if await db.ledger_entries.count_documents({'account_id': _ea['id']}) == 0:
            await db.accounts.delete_one({'id': _ea['id']})

    # One-time backfill: any employee with a full-size photo but no thumb yet
    # (i.e. saved before photo_thumb existed) gets one generated now, so
    # every list screen benefits immediately on this restart rather than only
    # once each employee's photo happens to be re-saved.
    async for emp in db.employees.find(
        {'photo': {'$nin': [None, '']}, '$or': [{'photo_thumb': {'$exists': False}}, {'photo_thumb': ''}]},
        {'_id': 0, 'id': 1, 'photo': 1},
    ):
        thumb = _make_photo_thumb(emp.get('photo'))
        if thumb:
            await db.employees.update_one({'id': emp['id']}, {'$set': {'photo_thumb': thumb}})

    if not await db.users.find_one({'username': 'owner'}):
        uid = str(uuid.uuid4())
        await db.users.insert_one({
            'id': uid, 'username': 'owner', 'name': 'Ram Murti (Owner)',
            'role': 'owner', 'password_hash': hash_secret('Owner@123'),
            'created_at': now_utc().isoformat(),
        })
        logger.info('Seeded owner user: owner / Owner@123')

    # Seed demo admin + accountant
    if not await db.users.find_one({'username': 'admin'}):
        await db.users.insert_one({
            'id': str(uuid.uuid4()), 'username': 'admin', 'name': 'Store Admin',
            'role': 'admin', 'password_hash': hash_secret('Admin@123'),
            'created_at': now_utc().isoformat(),
        })
        logger.info('Seeded admin user: admin / Admin@123')
    if not await db.users.find_one({'username': 'accountant'}):
        await db.users.insert_one({
            'id': str(uuid.uuid4()), 'username': 'accountant', 'name': 'Store Accountant',
            'role': 'accountant', 'password_hash': hash_secret('Accountant@123'),
            'created_at': now_utc().isoformat(),
        })
        logger.info('Seeded accountant user: accountant / Accountant@123')

    if await db.shifts.count_documents({}) == 0:
        await db.shifts.insert_many([
            {'id': str(uuid.uuid4()), 'name': 'General', 'start': '10:00', 'end': '19:30', 'grace_min': 15, 'is_active': True, 'created_at': now_utc().isoformat()},
            {'id': str(uuid.uuid4()), 'name': 'Morning', 'start': '08:00', 'end': '16:00', 'grace_min': 10, 'is_active': True, 'created_at': now_utc().isoformat()},
            {'id': str(uuid.uuid4()), 'name': 'Night', 'start': '20:00', 'end': '05:00', 'grace_min': 15, 'is_active': True, 'created_at': now_utc().isoformat()},
        ])

    if await db.holidays.count_documents({}) == 0:
        yr = date.today().year
        await db.holidays.insert_one({
            'id': str(uuid.uuid4()), 'date': f'{yr}-01-26', 'name': 'Republic Day',
            'type': 'public', 'created_at': now_utc().isoformat(),
        })
        await db.holidays.insert_one({
            'id': str(uuid.uuid4()), 'date': f'{yr}-08-15', 'name': 'Independence Day',
            'type': 'public', 'created_at': now_utc().isoformat(),
        })

    if not await db.settings.find_one({'id': 'store'}):
        await db.settings.insert_one({
            'id': 'store', 'name': 'Ram Murti Jewellers - Main Store',
            'latitude': 28.6139, 'longitude': 77.2090,  # Delhi default
            'radius_m': 150, 'work_start': '10:00', 'work_end': '19:30',
            'grace_min': 15, 'updated_at': now_utc().isoformat(),
        })

    if await db.employees.count_documents({}) == 0:
        iso = now_utc().isoformat()
        samples = [
            ('Rahul Sharma','RMJ001','Sales','Senior Sales Associate','General',32000,'2023-06-15','+91 98765 43210','1234'),
            ('Aman Verma','RMJ002','Workshop','Goldsmith','General',28000,'2022-11-01','+91 98111 22233','2345'),
            ('Priya Singh','RMJ003','Accounts','Accountant','General',35000,'2024-01-20','+91 90000 12345','3456'),
            ('Ramesh Kumar','RMJ004','Security','Security Head','Night',22000,'2021-03-10','+91 99887 76655','4567'),
            ('Neha Gupta','RMJ005','Sales','Sales Associate','General',26000,'2024-08-05','+91 98765 00001','5678'),
        ]
        # Seed the Departments master with each distinct name this demo data
        # uses, so the seeded employees can carry a real department_id (not
        # just the display-cache string) like any employee created for real.
        dept_id_by_name: dict = {}
        for dept_name in dict.fromkeys(s[2] for s in samples):
            did = str(uuid.uuid4())
            await db.departments.insert_one({
                'id': did, 'name': dept_name, 'is_active': True, 'created_at': iso,
            })
            dept_id_by_name[dept_name] = did
        docs, events = [], []
        for name, code, dept, desig, shift, sal, jd, mob, pin in samples:
            eid = str(uuid.uuid4())
            docs.append({
                'id': eid, 'name': name, 'employee_code': code,
                'department_id': dept_id_by_name[dept], 'department': dept,
                'designation': desig, 'shift': shift, 'salary': sal, 'joining_date': jd,
                'mobile': mob, 'address': 'Delhi', 'aadhaar': '', 'pan': '',
                'bank_account': '', 'bank_ifsc': '', 'bank_name': '', 'photo': '',
                'status': 'on_leave' if code == 'RMJ004' else 'active',
                'notes': '', 'username': code.lower(), 'password_hash': hash_secret(pin),
                'created_at': iso, 'updated_at': iso,
            })
            events.append({
                'id': str(uuid.uuid4()), 'employee_id': eid, 'type': 'joined',
                'title': 'Joined RMJ', 'description': f'Joined as {desig}',
                'amount': 0, 'created_at': jd,
            })
        await db.employees.insert_many([dict(d) for d in docs])
        await db.timeline.insert_many(events)
        # Extra timeline events for realism
        await db.timeline.insert_one({
            'id': str(uuid.uuid4()), 'employee_id': docs[0]['id'], 'type': 'bonus',
            'title': 'Diwali Bonus', 'description': 'Festive bonus', 'amount': 5000, 'created_at': iso,
        })
        await db.timeline.insert_one({
            'id': str(uuid.uuid4()), 'employee_id': docs[1]['id'], 'type': 'advance',
            'title': 'Salary Advance', 'description': 'Approved advance', 'amount': 3000, 'created_at': iso,
        })
        logger.info(f'Seeded {len(docs)} employees. Passwords: rmj001=1234, rmj002=2345, rmj003=3456, rmj004=4567, rmj005=5678')

    # Backfill: ensure every employee has login credentials (username + password).
    # Employees used to log in with employee_code + a 4-digit PIN; that was replaced
    # by username + password, so any pre-existing employee record without one gets a
    # default username (their employee_code, lowercased) and a default password
    # (last 4 digits of their code) — same pattern the old PIN backfill used, just
    # renamed, so nobody's locked out after the upgrade. They can change it from
    # Settings once logged in.
    async for emp in db.employees.find({}, {'_id': 0, 'id': 1, 'employee_code': 1, 'username': 1, 'password_hash': 1}):
        upd: dict = {}
        code = emp.get('employee_code') or ''
        if not emp.get('username'):
            upd['username'] = (code or emp['id'][:8]).lower()
        if not emp.get('password_hash'):
            digits = ''.join(ch for ch in code if ch.isdigit())[-4:]
            default_password = digits.zfill(4) if digits else '0000'
            upd['password_hash'] = hash_secret(default_password)
            logger.info(f"Backfilled login password for {code} → {default_password}")
        if upd:
            await db.employees.update_one({'id': emp['id']}, {'$set': upd})


@app.on_event('startup')
async def on_startup():
    await seed()
    asyncio.create_task(_attendance_reminder_loop())
    from routers.documents import upload_worker  # background Drive sync for Documents
    asyncio.create_task(upload_worker())
    from backup_service import backup_loop  # daily whole-DB backup to Drive
    asyncio.create_task(backup_loop())
    from routers.record_photos import record_photo_worker  # background Drive sync for record photos
    asyncio.create_task(record_photo_worker())
    from gold_rate import gold_rate_loop  # daily reference gold-rate fetch
    asyncio.create_task(gold_rate_loop())


@app.on_event('shutdown')
async def on_shutdown():
    client.close()


# ---------------- Attendance ----------------
def _parse_hhmm(s: str) -> Optional[tuple]:
    try:
        h, m = s.split(':')
        return int(h), int(m)
    except Exception:
        return None


async def _get_store():
    doc = await db.settings.find_one({'id': 'store'}, {'_id': 0})
    if not doc: raise HTTPException(status_code=400, detail='Store settings not configured')
    return doc


def _minutes(hhmm: str) -> int:
    hm = _parse_hhmm(hhmm)
    return hm[0] * 60 + hm[1] if hm else 0


async def _apply_punch(emp: dict, kind: str, ts: datetime, extra: Optional[dict] = None) -> dict:
    """Shared attendance state machine — the single place shift resolution,
    late/half-day calculation, and the attendance/attendance_events writes
    happen, used by BOTH the app's GPS+selfie check-in/check-out endpoints
    and biometric device punches (via _ingest_biometric_punch). Before this,
    the two paths independently reimplemented this logic, so a future change
    to grace periods/holiday handling/etc. had to be hand-duplicated in two
    places — exactly the kind of drift that let today_str() go UTC-only
    while this logic stayed IST-only.

    `kind` is 'check_in', 'check_out', or 'auto' (resolves by checking
    whether today's record already has a check_in — the toggle behaviour
    biometric punches have always used). `extra` are punch-method-specific
    fields merged into the stored check_in/check_out sub-document — real
    GPS/selfie values for the app, {'source': 'biometric', 'device_serial':
    ...} for a device (which just get merged on top of harmless 0/'' GPS
    defaults). This function does not send notifications or write
    device/audit logs — callers do that, since it differs per punch method.
    """
    extra = extra or {}
    d = ts.astimezone(IST).date().isoformat()
    existing = await db.attendance.find_one({'employee_id': emp['id'], 'date': d}, {'_id': 0})

    # A day an admin has manually corrected (PUT /attendance/day/{emp}/{date},
    # or an approved correction request) is authoritative. Without this guard,
    # a biometric device replaying a punch for that date — its own retry, a
    # delayed resync, or the same historical backlog surfacing again — could
    # silently flip a manually-set 'absent'/'leave'/edited day back to
    # 'present' and overwrite the corrected times, since check_in/check_out
    # are explicitly null on no-time statuses (absent/leave/holiday/
    # weekly_off) and so wouldn't otherwise trip the already_checked_in/out
    # guards below. App-originated punches (extra has no 'source') are
    # unaffected — this only blocks the biometric device path specifically.
    if existing and (existing.get('edited_by') or existing.get('via_correction')) and extra.get('source') == 'biometric':
        return {'ok': False, 'reason': 'manually_edited', 'kind': kind}

    if kind == 'auto':
        kind = 'check_out' if (existing and existing.get('check_in') and not existing.get('check_out')) else 'check_in'

    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    shift = await db.shifts.find_one({'name': emp.get('shift')}, {'_id': 0})

    if kind == 'check_in':
        if existing and existing.get('check_in'):
            return {'ok': False, 'reason': 'already_checked_in', 'kind': kind}

        now_local = ts.astimezone(IST)
        minutes_now = now_local.hour * 60 + now_local.minute
        work_start = _minutes(shift['start']) if shift and shift.get('start') else _minutes(store.get('work_start', '10:00'))
        grace = int(shift.get('grace_min', 15)) if shift else int(store.get('grace_min', 15))
        late_by_min = minutes_now - (work_start + grace)
        is_late = late_by_min > 0

        check_in_doc = {
            'timestamp': ts.isoformat(), 'latitude': 0, 'longitude': 0, 'selfie': '', 'distance_m': 0,
            'is_late': is_late, 'late_by_min': max(late_by_min, 0),
            **extra,
        }
        if existing:
            await db.attendance.update_one({'id': existing['id']}, {'$set': {'check_in': check_in_doc, 'is_late': is_late, 'status': 'present'}})
            att_id = existing['id']
        else:
            att_id = str(uuid.uuid4())
            insert_doc = {
                'id': att_id, 'employee_id': emp['id'], 'date': d,
                'check_in': check_in_doc, 'check_out': None, 'is_late': is_late,
                'working_hours': 0, 'status': 'present', 'created_at': ts.isoformat(),
            }
            if extra.get('source'):
                insert_doc['source'] = extra['source']
            await db.attendance.insert_one(insert_doc)

        event_doc = {
            'id': str(uuid.uuid4()), 'employee_id': emp['id'], 'employee_name': emp['name'],
            'type': 'check_in', 'timestamp': ts.isoformat(), 'is_late': is_late, 'created_at': ts.isoformat(),
        }
        if extra.get('source'):
            event_doc['source'] = extra['source']; event_doc['device_serial'] = extra.get('device_serial', '')
        await db.attendance_events.insert_one(event_doc)
        return {'ok': True, 'kind': 'check_in', 'attendance_id': att_id, 'is_late': is_late, 'timestamp': ts.isoformat()}

    else:  # check_out
        if not existing or not existing.get('check_in'):
            return {'ok': False, 'reason': 'no_check_in', 'kind': kind}
        if existing.get('check_out'):
            return {'ok': False, 'reason': 'already_checked_out', 'kind': kind}

        try:
            check_in_ts = datetime.fromisoformat(existing['check_in']['timestamp'])
            hours = round((ts - check_in_ts).total_seconds() / 3600.0, 2)
        except Exception:
            hours = 0
        late_half_day_after = int(shift.get('late_half_day_after_min') or 0) if shift else 0
        late_by_min = int(existing['check_in'].get('late_by_min') or 0)
        half_day_for_lateness = bool(late_half_day_after) and late_by_min >= late_half_day_after
        status = 'half_day' if (hours < 4 or half_day_for_lateness) else 'present'
        half_day_reason = None
        if status == 'half_day':
            half_day_reason = 'short_hours' if hours < 4 else 'late'

        check_out_doc = {
            'timestamp': ts.isoformat(), 'latitude': 0, 'longitude': 0, 'selfie': '', 'distance_m': 0,
            **extra,
        }
        await db.attendance.update_one(
            {'id': existing['id']},
            {'$set': {'check_out': check_out_doc, 'working_hours': hours, 'status': status, 'half_day_reason': half_day_reason}},
        )
        event_doc = {
            'id': str(uuid.uuid4()), 'employee_id': emp['id'], 'employee_name': emp['name'],
            'type': 'check_out', 'timestamp': ts.isoformat(), 'working_hours': hours, 'created_at': ts.isoformat(),
        }
        if extra.get('source'):
            event_doc['source'] = extra['source']; event_doc['device_serial'] = extra.get('device_serial', '')
        await db.attendance_events.insert_one(event_doc)
        return {'ok': True, 'kind': 'check_out', 'attendance_id': existing['id'], 'working_hours': hours, 'status': status, 'timestamp': ts.isoformat()}


def _resolve_attendance_state(a: Optional[dict], emp: dict, shift: Optional[dict], store: dict,
                               is_today: bool, minutes_now: int) -> dict:
    """Single source of truth for what one employee's attendance means on one
    day — used by the live Attendance screen (today, possibly still
    in-progress), the Dashboard tiles, and Payroll (always a settled past
    date). Returns {'status': 'present'|'half_day'|'absent'|'missing_punch'
    |'leave'|'holiday'|'weekly_off', 'is_late': bool}.

    Rules (per the owner's spec):
    - An explicit no-punch-times status from a manual edit (leave/holiday/
      weekly_off) is authoritative — trust it as-is.
    - Checked out with no check-in is a data anomaly (e.g. a manual edit
      that only set check-out, or bad device data) — 'missing_punch',
      never counts as present/paid.
    - Checked in AND checked out: trust the status computed at checkout
      time (present/half_day — already reflects shift timing + the
      late-master half-day threshold).
    - Checked in with no check-out: fine while the shift is still ongoing
      today (shows as present/late, matches the live view) — but once
      shift end + grace has passed (always true for a past date, since
      the day is over), it's 'missing_punch'. No full-day credit just for
      having shown up with no checkout.
    - Nothing recorded at all: 'absent'.
    """
    if a and a.get('status') in ('leave', 'holiday', 'weekly_off'):
        return {'status': a['status'], 'is_late': False}
    check_in = a.get('check_in') if a else None
    check_out = a.get('check_out') if a else None
    if check_out and not check_in:
        return {'status': 'missing_punch', 'is_late': False}
    if check_in and check_out:
        return {'status': a.get('status') or 'present', 'is_late': bool(a.get('is_late'))}
    if check_in and not check_out:
        end = (shift.get('end') if shift else None) or store.get('work_end', '19:30')
        grace_elapsed = (not is_today) or (minutes_now >= _minutes(end) + MISSED_CHECKOUT_GRACE_MIN)
        if grace_elapsed:
            return {'status': 'missing_punch', 'is_late': bool(a.get('is_late'))}
        return {'status': 'present', 'is_late': bool(a.get('is_late'))}
    return {'status': 'absent', 'is_late': False}


def _karigar_ledger_balances(entries: list) -> dict:
    """Single source of truth for aggregating karigar_ledger entries into
    per-karigar running balances. Used by list_karigars, get_karigar_ledger,
    and the dashboard snapshot — previously each of these re-implemented this
    math separately and had drifted out of sync on which entry types count
    (e.g. the dashboard silently ignored 'receipt' entries). Fix in one place.

    Sign convention: amt_due positive = shop owes the karigar money;
    negative = karigar owes the shop. fine_bal positive = karigar is still
    holding that much fine gold.
    """
    bal: dict = {}
    for e in entries:
        kid = e.get('karigar_id')
        if not kid: continue
        b = bal.setdefault(kid, {'weight_bal': 0.0, 'fine_bal': 0.0, 'amt_due': 0.0})
        t = e.get('type')
        if t == 'gold_out':
            b['weight_bal'] += e.get('weight') or 0
            b['fine_bal'] += e.get('fine_weight') if e.get('fine_weight') is not None else (e.get('weight') or 0)
        elif t == 'gold_in':
            b['weight_bal'] -= e.get('weight') or 0
            b['fine_bal'] -= e.get('fine_weight') if e.get('fine_weight') is not None else (e.get('weight') or 0)
        elif t == 'labour_payable':
            b['amt_due'] += e.get('amount') or 0
        elif t == 'payment':
            b['amt_due'] -= e.get('amount') or 0
        elif t == 'receipt':
            b['amt_due'] += e.get('amount') or 0
        elif t in ('wastage', 'adjustment'):
            # Free-form ± adjustment — sign is baked into the stored amount.
            b['amt_due'] += e.get('amount') or 0
    return bal


# ---------------- Ledger / Payroll helpers (shared — used by employees.py's
# closing-balance column, payroll.py's compute, reports.py's ledger PDF, and
# assistant.py's context builder) ----------------
def _ledger_sign(entry_type: str) -> int:
    # Positive = employer pays / employee receives; Negative = deductions.
    return -1 if entry_type in ('advance', 'fine', 'deduction') else 1


async def _opening_balance(emp_id: str, up_to_date_exclusive: str) -> float:
    running = 0.0
    async for e in db.timeline.find({'employee_id': emp_id}, {'_id': 0}).sort('created_at', 1):
        t = e.get('type')
        if t not in ('advance', 'bonus', 'fine', 'deduction', 'salary', 'salary_earned', 'salary_paid'):
            continue
        # salary_earned/salary_paid are tagged with the payroll month they belong
        # to (year/month) — that's what decides whether they're "before" the
        # cutoff, not created_at. Payroll for a month is normally generated and
        # paid a day or more into the *next* month, so created_at alone would
        # wrongly exclude last month's earned+paid pair (which cancel out) from
        # this month's opening balance while still including a same-month
        # advance/fine dated earlier — dropping the offsetting amount and
        # corrupting the Payroll page's Opening Balance (the Ledger screen has
        # no cutoff at all, so it stayed correct — hence the two disagreeing).
        if t in ('salary_earned', 'salary_paid') and e.get('year') and e.get('month'):
            effective_date = f"{int(e['year']):04d}-{int(e['month']):02d}-01"
        else:
            effective_date = e.get('created_at') or ''
        if effective_date >= up_to_date_exclusive:
            continue
        amt = float(e.get('amount') or 0)
        sign = e.get('sign', _ledger_sign(t))
        if t in ('salary', 'salary_earned'):
            delta = abs(amt)
        elif t == 'salary_paid':
            delta = -abs(amt)
        else:
            delta = sign * abs(amt)
        running += delta
    return round(running, 2)


def _iter_month_dates(year: int, month: int):
    from calendar import monthrange
    days = monthrange(year, month)[1]
    for d in range(1, days + 1):
        yield date(year, month, d)


# ---------------- Audit log (shared — called from nearly every domain) ----------------
async def log_audit(user, action: str, entity_type: str, entity_id: str = '',
                    entity_label: str = '', details: Optional[dict] = None):
    try:
        await db.audit_logs.insert_one({
            'id': str(uuid.uuid4()),
            'actor_id': user.get('id', ''),
            'actor_name': user.get('name') or user.get('employee_code') or user.get('username', ''),
            'actor_role': user.get('role', ''),
            'action': action, 'entity_type': entity_type, 'entity_id': entity_id,
            'entity_label': entity_label, 'details': details or {},
            'created_at': now_utc().isoformat(),
        })
    except Exception as e:
        logger.warning(f'audit log failed: {e}')


# ---------------- Notifications (Web Push) ----------------
try:
    from pywebpush import webpush, WebPushException
    WEBPUSH_AVAILABLE = True
except ImportError:
    WEBPUSH_AVAILABLE = False
    logger.warning('pywebpush not installed — push notifications disabled. Run: pip install pywebpush')

import asyncio
import json as _json


async def _muted_account_ids(ids: list) -> set:
    """Ids among `ids` whose account has explicitly turned notifications off
    (Settings › People › <person>). A missing/True flag means enabled."""
    muted: set = set()
    ids = [i for i in ids if i]
    if not ids:
        return muted
    async for a in db.users.find({'id': {'$in': ids}, 'notifications_enabled': False}, {'_id': 0, 'id': 1}):
        muted.add(a['id'])
    async for a in db.employees.find({'id': {'$in': ids}, 'notifications_enabled': False}, {'_id': 0, 'id': 1}):
        muted.add(a['id'])
    return muted


async def _send_push_to_subs(subs: list, title: str, body: str, url: str = '/'):
    if not WEBPUSH_AVAILABLE or not VAPID_PRIVATE_KEY:
        return
    # Drop subscriptions owned by accounts that have muted notifications.
    muted = await _muted_account_ids([s.get('user_id') for s in subs])
    if muted:
        subs = [s for s in subs if s.get('user_id') not in muted]
    payload = _json.dumps({'title': title, 'body': body, 'url': url})
    for sub in subs:
        def _do_send(s=sub):
            webpush(
                subscription_info={'endpoint': s['endpoint'], 'keys': s['keys']},
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={'sub': VAPID_SUBJECT},
            )
        try:
            await asyncio.to_thread(_do_send)
        except WebPushException as e:
            status = getattr(getattr(e, 'response', None), 'status_code', None)
            resp_text = getattr(getattr(e, 'response', None), 'text', '') or ''
            # 404/410 means the browser/OS dropped the subscription. A 400
            # "VapidPkHashMismatch" or 403 "credentials ... do not correspond"
            # means this subscription was created under a VAPID key pair that
            # no longer matches VAPID_PRIVATE_KEY (e.g. the keys were
            # regenerated) — just as permanently dead, but the browser still
            # thinks it's subscribed, so it'll otherwise fail silently on
            # every single notification forever. Purge it so a stale row
            # doesn't linger — the affected person still needs to toggle
            # notifications off/on once to get a fresh subscription, since
            # the browser holds its own (now-orphaned) subscription object
            # that only an explicit unsubscribe/resubscribe replaces.
            vapid_mismatch = 'VapidPkHashMismatch' in resp_text or 'do not correspond' in resp_text
            if status in (404, 410) or vapid_mismatch:
                await db.push_subscriptions.delete_one({'id': sub['id']})
            else:
                logger.warning(f'push send failed: {e}')
        except Exception as e:
            logger.warning(f'push send failed: {e}')


async def _store_notification(user_id: str, title: str, body: str, url: str):
    # Respect the account's master notification switch for the in-app bell too,
    # not just browser push — a muted person shouldn't accrue a history either.
    if await _muted_account_ids([user_id]):
        return
    await db.notifications.insert_one({
        'id': str(uuid.uuid4()), 'user_id': user_id, 'title': title, 'body': body,
        'url': url or '/', 'read': False, 'created_at': now_utc().isoformat(),
    })


async def _notify_user_impl(user_id: str, title: str, body: str, url: str = '/'):
    try:
        await _store_notification(user_id, title, body, url)
        subs = await db.push_subscriptions.find({'user_id': user_id}, {'_id': 0}).to_list(20)
        await _send_push_to_subs(subs, title, body, url)
    except Exception as e:
        logger.warning(f'notify_user failed: {e}')


async def notify_user(user_id: str, title: str, body: str, url: str = '/'):
    # Fire-and-forget: notification storage + web-push delivery involve
    # several sequential DB writes and outbound HTTP calls to push services,
    # none of which the caller (a form-save request handler) should have to
    # wait on. Scheduling as a background task lets the API response return
    # the instant the actual record is saved instead of blocking on this.
    asyncio.create_task(_notify_user_impl(user_id, title, body, url))


async def _notify_roles_impl(roles: list, title: str, body: str, url: str = '/'):
    try:
        if not roles:
            return
        # In-app notification history — resolve which actual accounts match
        # these roles so each one gets a durable, listable record, not just
        # a fire-and-forget browser push.
        recipient_ids = set()
        async for u in db.users.find({'role': {'$in': roles}}, {'_id': 0, 'id': 1}):
            recipient_ids.add(u['id'])
        if 'employee' in roles:
            async for e in db.employees.find({'status': {'$ne': 'inactive'}}, {'_id': 0, 'id': 1}):
                recipient_ids.add(e['id'])
        for uid in recipient_ids:
            await _store_notification(uid, title, body, url)
        subs = await db.push_subscriptions.find({'role': {'$in': roles}}, {'_id': 0}).to_list(200)
        await _send_push_to_subs(subs, title, body, url)
    except Exception as e:
        logger.warning(f'notify_roles failed: {e}')


async def notify_roles(roles: list, title: str, body: str, url: str = '/'):
    # Same rationale as notify_user: don't block the caller on the recipient
    # resolution + per-recipient inserts + push delivery below.
    asyncio.create_task(_notify_roles_impl(roles, title, body, url))


# ---------------- WhatsApp (OpenWA gateway) ----------------
import httpx as _httpx

# The session's id can change if it's ever re-paired (already happened once
# during setup), so resolve it by name each time rather than pinning a UUID
# in .env — cached in-process and refreshed on a 404 (stale id after a
# re-pair) or a cache miss.
_openwa_session_id_cache: Optional[str] = None


def _to_whatsapp_chat_id(mobile: str) -> Optional[str]:
    """Normalizes a stored customer/karigar mobile number (usually a bare
    10-digit Indian number) into OpenWA's `<countrycode><number>@c.us` chat
    id. Returns None for anything too short to be a real number."""
    digits = ''.join(c for c in (mobile or '') if c.isdigit())
    if not digits:
        return None
    if len(digits) == 10:
        digits = '91' + digits
    elif len(digits) == 11 and digits.startswith('0'):
        digits = '91' + digits[1:]
    if len(digits) < 11:
        return None
    return f'{digits}@c.us'


async def _resolve_openwa_session_id(client: '_httpx.AsyncClient') -> Optional[str]:
    global _openwa_session_id_cache
    if _openwa_session_id_cache:
        return _openwa_session_id_cache
    res = await client.get(
        f'{OPENWA_BASE_URL}/api/sessions',
        headers={'Authorization': f'Bearer {OPENWA_API_KEY}'},
    )
    res.raise_for_status()
    for s in res.json():
        if s.get('name') == OPENWA_SESSION_NAME and s.get('status') == 'ready':
            _openwa_session_id_cache = s['id']
            return _openwa_session_id_cache
    return None


async def _openwa_send_text(chat_id: str, text: str) -> bool:
    """Shared send + stale-session-id retry, used for both a normal chat and
    a channel post (chat_id is just `<id>@newsletter` for the latter)."""
    if not OPENWA_BASE_URL or not OPENWA_API_KEY:
        return False
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            session_id = await _resolve_openwa_session_id(client)
            if not session_id:
                logger.warning('openwa send skipped: no ready session named ' + OPENWA_SESSION_NAME)
                return False
            payload = {'chatId': chat_id, 'text': text}
            headers = {'Authorization': f'Bearer {OPENWA_API_KEY}'}
            res = await client.post(f'{OPENWA_BASE_URL}/api/sessions/{session_id}/messages/send-text', headers=headers, json=payload)
            if res.status_code in (400, 404):
                # Cached id is stale (session was re-paired) — OpenWA reports this as
                # 404 (unknown id) or 400 ("session is not active") depending on
                # whether the old id still exists at all. Refresh once and retry.
                global _openwa_session_id_cache
                _openwa_session_id_cache = None
                session_id = await _resolve_openwa_session_id(client)
                if not session_id:
                    return False
                res = await client.post(f'{OPENWA_BASE_URL}/api/sessions/{session_id}/messages/send-text', headers=headers, json=payload)
            if res.status_code == 201:
                return True
            logger.warning(f'openwa send failed: {res.status_code} {res.text[:200]}')
            return False
    except Exception as e:
        logger.warning(f'openwa send failed: {e}')
        return False


async def send_whatsapp(mobile: str, text: str) -> bool:
    """Best-effort WhatsApp send via the self-hosted OpenWA gateway. Never
    raises — a WhatsApp failure (gateway down, session logged out, bad
    number) must not block or roll back whatever business action triggered
    it, same convention as the push-notification helpers above. Returns
    whether the send actually went out, so a caller that wants to know can
    check it without needing a try/except of its own."""
    chat_id = _to_whatsapp_chat_id(mobile)
    if not chat_id:
        return False
    return await _openwa_send_text(chat_id, text)


async def send_whatsapp_channel(channel_id: str, text: str) -> bool:
    """Post to a WhatsApp Channel this session owns/admins (e.g. the shop's
    gold-rate broadcast channel). `channel_id` is the full `<id>@newsletter`
    id, not a phone number — no normalization needed."""
    if not channel_id:
        return False
    return await _openwa_send_text(channel_id, text)


async def get_whatsapp_status() -> dict:
    """Connection status for Store Settings' WhatsApp panel. `configured`
    means OPENWA_BASE_URL/OPENWA_API_KEY are set at all; `connected` means a
    session named OPENWA_SESSION_NAME is actually paired and ready right
    now — the two can differ (gateway configured but phone logged out)."""
    if not OPENWA_BASE_URL or not OPENWA_API_KEY:
        return {'configured': False, 'connected': False, 'phone': None}
    try:
        async with _httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                f'{OPENWA_BASE_URL}/api/sessions',
                headers={'Authorization': f'Bearer {OPENWA_API_KEY}'},
            )
            res.raise_for_status()
            for s in res.json():
                if s.get('name') == OPENWA_SESSION_NAME:
                    ready = s.get('status') == 'ready'
                    return {'configured': True, 'connected': ready, 'phone': s.get('phone') if ready else None}
            return {'configured': True, 'connected': False, 'phone': None}
    except Exception as e:
        logger.warning(f'openwa status check failed: {e}')
        return {'configured': True, 'connected': False, 'phone': None}


async def whatsapp_flow_enabled(flow: str) -> bool:
    """Master + per-flow WhatsApp toggle (Store Settings > WhatsApp — see
    WhatsAppSettingsIn in routers/settings.py). Both default True: the
    feature works out of the box once OpenWA itself is connected, and staff
    turn OFF specific flows rather than opt in to each one."""
    doc = await db.settings.find_one({'id': 'whatsapp'}, {'_id': 0}) or {}
    if not doc.get('enabled', True):
        return False
    return bool(doc.get(flow, True))


# ---------------- Notification Settings (per-module on/off + recipients) ----------------
# Lets an owner turn off the admin-facing "broadcast" notifications a given
# business module fires (e.g. "someone checked in", "a repair was created"),
# and/or redirect them to a specific set of staff/employees instead of the
# hardcoded default roles. Deliberately does NOT gate the personal notify_user
# calls that tell an individual about their own record (leave decided, salary
# paid, task assigned to them, etc.) — those should never be silenced by an
# admin's module preference since they're informing the affected person, not
# broadcasting to staff.
NOTIFICATION_MODULES = [
    {'key': 'attendance', 'label': 'Attendance', 'default_roles': ['owner', 'admin']},
    {'key': 'tasks', 'label': 'Tasks', 'default_roles': ['owner', 'admin']},
    {'key': 'payroll', 'label': 'Payroll', 'default_roles': ['owner', 'admin']},
    {'key': 'repairs', 'label': 'Repair', 'default_roles': ['owner', 'admin']},
    {'key': 'samples', 'label': 'Stock In/Out', 'default_roles': ['owner', 'admin']},
    {'key': 'cash_book', 'label': 'Cash Book', 'default_roles': ['owner', 'admin']},
    {'key': 'documents', 'label': 'Documents', 'default_roles': ['owner', 'admin']},
    {'key': 'gold_loans', 'label': 'Gold Loans', 'default_roles': ['owner', 'admin']},
]
NOTIFICATION_MODULE_KEYS = {m['key'] for m in NOTIFICATION_MODULES}
NOTIFICATION_MODULE_DEFAULT_ROLES = {m['key']: m['default_roles'] for m in NOTIFICATION_MODULES}

# Finer-grained than NOTIFICATION_MODULES: every distinct broadcast event
# ("script") an owner can individually silence without muting the whole
# module. Each _notify_module(...) call site below passes its own `script`
# key; two call sites can legitimately share one script key when they're the
# same kind of event fired from two code paths (e.g. a repair item becoming
# ready via two different actions).
# `admin_only: True` — this event NEVER reaches an employee no matter what
# they toggle (see _notify_module_impl's admin_only branch, and documents.py's
# equivalent checks) — it's metadata for the People > Alerts screen so it can
# hide/grey out toggles that can never fire for the account being edited,
# instead of showing a switch that quietly does nothing. Keep this in sync
# with each call site's own admin_only=True / (no subject_employee_id) choice
# below — it's descriptive of the code, not enforced from here.
NOTIFICATION_SCRIPTS = [
    {'key': 'attendance_checkin', 'module': 'attendance', 'label': 'Employee checked in', 'admin_only': False},
    {'key': 'attendance_checkout', 'module': 'attendance', 'label': 'Employee checked out', 'admin_only': False},
    {'key': 'attendance_discrepancy', 'module': 'attendance', 'label': 'Missed punch / attendance discrepancy', 'admin_only': True},
    {'key': 'attendance_absentee_summary', 'module': 'attendance', 'label': 'Daily absentee summary (9 PM)', 'admin_only': True},
    {'key': 'attendance_correction_request', 'module': 'attendance', 'label': 'New attendance correction request', 'admin_only': True},
    {'key': 'attendance_leave_request', 'module': 'attendance', 'label': 'New leave request', 'admin_only': True},
    {'key': 'task_overdue', 'module': 'tasks', 'label': 'Task overdue', 'admin_only': True},
    {'key': 'task_comment', 'module': 'tasks', 'label': 'Employee commented on a task', 'admin_only': True},
    {'key': 'payroll_auto_advance', 'module': 'payroll', 'label': 'Auto advance recorded', 'admin_only': True},
    {'key': 'repair_new_order', 'module': 'repairs', 'label': 'New repair order created', 'admin_only': False},
    {'key': 'repair_item_ready', 'module': 'repairs', 'label': 'Repair item ready / back from karigar', 'admin_only': False},
    {'key': 'sample_issued', 'module': 'samples', 'label': 'Sample(s) issued', 'admin_only': False},
    {'key': 'sample_received', 'module': 'samples', 'label': 'Sample received back', 'admin_only': False},
    {'key': 'cashbook_transfer', 'module': 'cash_book', 'label': 'Cash transferred between counters', 'admin_only': True},
    {'key': 'cashbook_entry', 'module': 'cash_book', 'label': 'Employee recorded cash in / out', 'admin_only': True},
    {'key': 'cashbook_edit', 'module': 'cash_book', 'label': 'Employee edited a cash entry', 'admin_only': True},
    {'key': 'document_recorded', 'module': 'documents', 'label': 'Document recorded to Done', 'admin_only': True},
    {'key': 'document_pending_reminder', 'module': 'documents', 'label': 'Document pending more than 1 day (daily reminder)', 'admin_only': False},
    {'key': 'gold_loan_created', 'module': 'gold_loans', 'label': 'New gold loan created', 'admin_only': True},
    {'key': 'gold_loan_interest_posted', 'module': 'gold_loans', 'label': 'Monthly interest posted', 'admin_only': True},
    {'key': 'gold_loan_monthly_interest_reminder', 'module': 'gold_loans', 'label': 'Monthly reminder to collect pending interest', 'admin_only': True},
]
NOTIFICATION_SCRIPTS_BY_MODULE: Dict[str, list] = {}
for _s in NOTIFICATION_SCRIPTS:
    NOTIFICATION_SCRIPTS_BY_MODULE.setdefault(_s['module'], []).append(_s)
NOTIFICATION_SCRIPT_KEYS = {s['key'] for s in NOTIFICATION_SCRIPTS}


def _wants_script(acc: dict, role: str, module: str, script: Optional[str] = None) -> bool:
    """Whether this account should receive this event. Decided per person on
    their People page: the master switch gates everything, then a specific
    notif_prefs[script] override (if that one event has ever been toggled
    individually) wins, else notif_prefs[module] (the whole module's on/off)
    wins if set, else it falls back to the module's default roles. `script`
    and `module` share one flat notif_prefs dict — their key spaces never
    collide (script keys are always more specific than module keys), so no
    separate storage is needed for the fine-grained overrides."""
    if acc.get('notifications_enabled') is False:
        return False
    prefs = acc.get('notif_prefs') or {}
    if script and script in prefs:
        return bool(prefs[script])
    if module in prefs:
        return bool(prefs[module])
    return role in set(NOTIFICATION_MODULE_DEFAULT_ROLES.get(module, ['owner', 'admin']))


async def _notify_module_impl(module: str, title: str, body: str, url: str = '/', script: Optional[str] = None,
                               subject_employee_id: Optional[str] = None, admin_only: bool = False):
    """Broadcast a module event to whichever people opted in for it. Recipients
    are now resolved per account (Settings › People › <person> › Notifications)
    rather than from a single global config — each person controls which module
    alerts they get, gated by their master notification switch. `script` is kept
    for call-site compatibility but is no longer separately silenceable.

    `subject_employee_id`: set this when the event is about one specific
    employee (e.g. "so-and-so checked in") — owners/admins still see every
    such event (that's the point of the broadcast), but among employees only
    the subject themselves is eligible, even if a coworker has this module's
    notifications turned on. Without it, every opted-in employee gets the
    broadcast, same as before — appropriate for shop-wide events with no
    single subject (a new repair order, samples issued, etc.).

    `admin_only`: set this for events that are inherently owner/admin
    business — an approval-queue item (a correction/leave request) or a
    multi-employee daily report (absentee summary) — that no employee should
    ever get, even if they've opted into the module and even if it happens to
    be about them (they already know they filed their own request)."""
    try:
        proj = {'_id': 0, 'id': 1, 'role': 1, 'notifications_enabled': 1, 'notif_prefs': 1}
        async for u in db.users.find({}, proj):
            if _wants_script(u, u.get('role', ''), module, script):
                await notify_user(u['id'], title, body, url)
        if admin_only:
            return
        async for e in db.employees.find({'status': {'$ne': 'inactive'}}, proj):
            if subject_employee_id is not None and e['id'] != subject_employee_id:
                continue
            if _wants_script(e, 'employee', module, script):
                await notify_user(e['id'], title, body, url)
    except Exception as e:
        logger.warning(f'_notify_module failed for {module}: {e}')


async def _notify_module(module: str, title: str, body: str, url: str = '/', script: Optional[str] = None,
                          subject_employee_id: Optional[str] = None, admin_only: bool = False):
    # Same rationale as notify_user/notify_roles above — this is the entry
    # point ~30 write endpoints call synchronously; without backgrounding it,
    # every repair/sample/task/leave save waits on a settings lookup, a
    # per-recipient notification insert loop, and sequential outbound
    # web-push HTTP calls before the client sees "saved".
    asyncio.create_task(_notify_module_impl(module, title, body, url, script, subject_employee_id, admin_only))


MISSED_ATTENDANCE_GRACE_MIN = 30  # keep in sync with attendance.py's NOT_CHECKED_IN_GRACE_MIN (same criteria, UI filter vs push reminder)


async def _check_missed_attendance():
    now_ist = now_utc().astimezone(IST)
    today = now_ist.date().isoformat()
    if now_ist.weekday() == 6:
        return  # Sunday — normally a day off, skip reminders
    if await db.holidays.find_one({'date': today}, {'_id': 0, 'id': 1}):
        return
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    minutes_now = now_ist.hour * 60 + now_ist.minute

    async for emp in db.employees.find({'status': 'active'}, {'_id': 0, 'password_hash': 0}):
        shift = await db.shifts.find_one({'name': emp.get('shift')}, {'_id': 0})
        if shift and shift.get('remote'):
            continue  # work-from-home — no attendance to miss
        start = (shift.get('start') if shift else None) or store.get('work_start', '10:00')
        if minutes_now < _minutes(start) + MISSED_ATTENDANCE_GRACE_MIN:
            continue  # not yet past their shift start + grace period

        if await db.attendance_reminders.find_one({'employee_id': emp['id'], 'date': today}, {'_id': 0}) is not None:
            continue  # already reminded today

        att = await db.attendance.find_one({'employee_id': emp['id'], 'date': today}, {'_id': 0})
        if att and (att.get('check_in') or att.get('status') in ('leave', 'holiday', 'weekly_off', 'absent')):
            continue

        leave = await db.leaves.find_one({
            'employee_id': emp['id'], 'status': 'approved',
            'from_date': {'$lte': today}, 'to_date': {'$gte': today},
        }, {'_id': 0, 'id': 1})
        if leave:
            continue

        await notify_user(emp['id'], 'Missed check-in',
                           "You haven't checked in yet today — don't forget to mark your attendance.", '/')
        await db.attendance_reminders.update_one(
            {'employee_id': emp['id'], 'date': today},
            {'$set': {'employee_id': emp['id'], 'date': today, 'sent_at': now_utc().isoformat()}},
            upsert=True,
        )


MISSED_CHECKOUT_GRACE_MIN = 30  # evening mirror of MISSED_ATTENDANCE_GRACE_MIN — reminds an employee who checked in but never checked out


async def _check_missed_checkout():
    """Evening counterpart to _check_missed_attendance: once past shift end (+
    grace), reminds anyone who checked in today but hasn't checked out yet.
    Personal reminder to the employee themselves — not affected by the owner's
    Notification Settings module toggle, same as the morning missed-check-in
    reminder."""
    now_ist = now_utc().astimezone(IST)
    today = now_ist.date().isoformat()
    if now_ist.weekday() == 6:
        return  # Sunday — normally a day off, skip reminders
    if await db.holidays.find_one({'date': today}, {'_id': 0, 'id': 1}):
        return
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    minutes_now = now_ist.hour * 60 + now_ist.minute

    async for emp in db.employees.find({'status': 'active'}, {'_id': 0, 'password_hash': 0}):
        shift = await db.shifts.find_one({'name': emp.get('shift')}, {'_id': 0})
        if shift and shift.get('remote'):
            continue  # work-from-home — no attendance to miss
        end = (shift.get('end') if shift else None) or store.get('work_end', '19:30')
        if minutes_now < _minutes(end) + MISSED_CHECKOUT_GRACE_MIN:
            continue  # not yet past their shift end + grace period

        if await db.checkout_reminders.find_one({'employee_id': emp['id'], 'date': today}, {'_id': 0}) is not None:
            continue  # already reminded today

        att = await db.attendance.find_one({'employee_id': emp['id'], 'date': today}, {'_id': 0})
        if not att or not att.get('check_in') or att.get('check_out'):
            continue  # never checked in, or already checked out — nothing to remind about

        await notify_user(emp['id'], 'Missed check-out',
                           "You checked in today but haven't checked out yet — don't forget before you leave.", '/')
        # Also flag it to the owner/admin as an attendance discrepancy —
        # unlike the employee's own reminder above, this respects the
        # Notification Settings module toggle since it's a staff-facing
        # broadcast, not a personal nudge.
        await _notify_module('attendance', 'Attendance discrepancy',
                              f"{emp['name']} checked in but hasn't checked out — no punch recorded past shift end.",
                              '/(tabs)/attendance', script='attendance_discrepancy', admin_only=True)
        await db.checkout_reminders.update_one(
            {'employee_id': emp['id'], 'date': today},
            {'$set': {'employee_id': emp['id'], 'date': today, 'sent_at': now_utc().isoformat()}},
            upsert=True,
        )


async def _check_attendance_anomalies():
    """Once per day, flags to the owner/admin any attendance record for
    today that has a check-out but no check-in — a data anomaly that can
    only really arise from a manual edit that only set the check-out time,
    or an odd biometric data gap. Never something the app's own check-in/
    check-out flow can produce (check-out is rejected without a prior
    check-in — see _apply_punch), so this is purely a safety net. Guarded
    per-day via db.attendance_anomaly_reminders so the 15-minute poll
    doesn't re-notify for the same day."""
    now_ist = now_utc().astimezone(IST)
    today = now_ist.date().isoformat()
    if await db.attendance_anomaly_reminders.find_one({'date': today}, {'_id': 0}) is not None:
        return

    names = []
    async for a in db.attendance.find({'date': today, 'check_out': {'$ne': None}, 'check_in': None}, {'_id': 0, 'employee_id': 1}):
        emp = await db.employees.find_one({'id': a['employee_id']}, {'_id': 0, 'name': 1})
        if emp:
            names.append(emp['name'])
    if not names:
        return
    await db.attendance_anomaly_reminders.update_one(
        {'date': today},
        {'$set': {'date': today, 'sent_at': now_utc().isoformat(), 'count': len(names)}},
        upsert=True,
    )
    await _notify_module('attendance', 'Attendance discrepancy',
                          f"Check-out recorded with no check-in for: {_summarize_codes(names)}",
                          '/(tabs)/attendance', script='attendance_discrepancy', admin_only=True)


async def _check_daily_absentee_summary():
    """Once per day, at/after 9:00 PM IST, push the owner/admin a summary of who
    never checked in today (no check-in, and not on approved leave/holiday/paid
    off). Guarded by `db.absentee_summaries` so it only fires once even though
    the loop polls every 15 minutes."""
    now_ist = now_utc().astimezone(IST)
    today = now_ist.date().isoformat()
    minutes_now = now_ist.hour * 60 + now_ist.minute
    if minutes_now < 21 * 60:
        return  # only fire at/after 9:00 PM IST
    if now_ist.weekday() == 6:
        return  # Sunday — normally a day off
    if await db.holidays.find_one({'date': today}, {'_id': 0, 'id': 1}):
        return
    if await db.absentee_summaries.find_one({'date': today}, {'_id': 0}) is not None:
        return  # already sent today

    absent_names = []
    async for emp in db.employees.find({'status': 'active'}, {'_id': 0, 'password_hash': 0}):
        shift = await db.shifts.find_one({'name': emp.get('shift')}, {'_id': 0})
        if shift and shift.get('remote'):
            continue  # work-from-home — no attendance is tracked, so never "absent"
        att = await db.attendance.find_one({'employee_id': emp['id'], 'date': today}, {'_id': 0})
        if att and (att.get('check_in') or att.get('status') in ('leave', 'holiday', 'weekly_off')):
            continue
        leave = await db.leaves.find_one({
            'employee_id': emp['id'], 'status': 'approved',
            'from_date': {'$lte': today}, 'to_date': {'$gte': today},
        }, {'_id': 0, 'id': 1})
        if leave:
            continue
        absent_names.append(emp['name'])

    await db.absentee_summaries.update_one(
        {'date': today},
        {'$set': {'date': today, 'sent_at': now_utc().isoformat(), 'count': len(absent_names)}},
        upsert=True,
    )
    if absent_names:
        shown = ', '.join(absent_names[:10])
        if len(absent_names) > 10:
            shown += f' +{len(absent_names) - 10} more'
        await _notify_module(
            'attendance',
            f"{len(absent_names)} absent today",
            shown, '/(tabs)/attendance', script='attendance_absentee_summary',
            admin_only=True,
        )


def _summarize_codes(codes: list, limit: int = 8) -> str:
    shown = ', '.join(codes[:limit])
    if len(codes) > limit:
        shown += f' +{len(codes) - limit} more'
    return shown


async def _check_repair_sample_followups():
    """Once per day, at/after 12:00 noon IST, personally reminds whoever added
    a repair item (or issued a sample) that it's still sitting in a state that
    needs their action — not yet sent out to a karigar, or sent out and not
    yet received back. Fires again every day the item stays pending (the
    guard is per-day, not per-item), same idea as the morning/evening
    attendance reminders. Personal reminder to the specific person
    responsible, so — like those — it's not gated by the owner's Notification
    Settings module toggle."""
    now_ist = now_utc().astimezone(IST)
    today = now_ist.date().isoformat()
    minutes_now = now_ist.hour * 60 + now_ist.minute
    if minutes_now < 12 * 60:
        return  # only fire at/after 12:00 noon IST
    if await db.followup_reminders.find_one({'date': today}, {'_id': 0}) is not None:
        return  # already sent today

    # Repair items still waiting to be issued to a karigar — remind whoever
    # added them.
    to_issue: dict = {}
    async for it in db.repair_items.find(
        {'status': 'received', 'needs_karigar': True, 'created_by_id': {'$ne': None}}, {'_id': 0},
    ):
        to_issue.setdefault(it['created_by_id'], []).append(it['item_code'])

    # Repair items out with a karigar, still not received back — remind
    # whoever issued them (fall back to the creator if that's missing, e.g.
    # older records from before this tracking existed).
    to_receive_repair: dict = {}
    async for it in db.repair_items.find({'status': 'with_karigar'}, {'_id': 0}):
        uid = it.get('issued_by_id') or it.get('created_by_id')
        if uid:
            to_receive_repair.setdefault(uid, []).append(it['item_code'])

    # Samples out with a karigar, still not received back — remind whoever
    # issued them.
    to_receive_sample: dict = {}
    async for s in db.samples.find({'status': 'with_karigar', 'issued_by_id': {'$ne': None}}, {'_id': 0}):
        to_receive_sample.setdefault(s['issued_by_id'], []).append(s['sample_code'])

    recipients = set(to_issue) | set(to_receive_repair) | set(to_receive_sample)
    for uid in recipients:
        lines = []
        if to_issue.get(uid):
            lines.append(f"Issue to karigar: {_summarize_codes(to_issue[uid])}")
        if to_receive_repair.get(uid):
            lines.append(f"Receive from karigar: {_summarize_codes(to_receive_repair[uid])}")
        if to_receive_sample.get(uid):
            lines.append(f"Receive sample: {_summarize_codes(to_receive_sample[uid])}")
        if not lines:
            continue
        await notify_user(uid, 'Repair/sample follow-up', ' · '.join(lines), '/repairs')

    await db.followup_reminders.update_one(
        {'date': today},
        {'$set': {'date': today, 'sent_at': now_utc().isoformat(), 'recipients': len(recipients)}},
        upsert=True,
    )


async def _check_auto_advances():
    """Fires each employee's recurring monthly advance on their configured
    day. An auto-advance is an early payout against the month that JUST
    ENDED — e.g. a day=1 advance disbursed on 1 March is money against
    February's salary, paid before that month's payroll is finalized, not
    against March's not-yet-worked days. So the resulting timeline entry is
    tagged with for_month = the previous calendar month (relative to the
    disbursement date), and payroll's ledger query matches an entry against
    for_month when present, falling back to created_at's own month for
    older/manual ledger entries that never set for_month — see
    _compute_payroll in routers/payroll.py.

    Idempotent via `db.auto_advances` (keyed by employee + for_month) so the
    15-minute poll can safely re-check without double-crediting. A day
    beyond the current month's length (e.g. 31 in February) clamps to the
    last day."""
    from calendar import monthrange
    now_ist = now_utc().astimezone(IST)
    today = now_ist.date()
    last_day = monthrange(today.year, today.month)[1]
    prev_year, prev_month = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)

    async for emp in db.employees.find(
        {'status': 'active', 'auto_advance_amount': {'$gt': 0}, 'auto_advance_day': {'$ne': None}},
        {'_id': 0, 'password_hash': 0},
    ):
        day = int(emp.get('auto_advance_day') or 0)
        if day <= 0:
            continue
        if today.day != min(day, last_day):
            continue
        # A late-month advance (day 16+) is paying THIS month's salary at
        # month-end ("auto pay for same month salary"); an early-month one is
        # paying the PREVIOUS month's salary in the first week. Tag for_month
        # accordingly so payroll deducts it from the right month.
        if day >= 16:
            for_month = f'{today.year:04d}-{today.month:02d}'
        else:
            for_month = f'{prev_year:04d}-{prev_month:02d}'
        if await db.auto_advances.find_one({'employee_id': emp['id'], 'month': for_month}, {'_id': 0}) is not None:
            continue  # already fired for this month

        amount = float(emp['auto_advance_amount'])
        iso = now_utc().isoformat()
        await db.timeline.insert_one({
            'id': str(uuid.uuid4()), 'employee_id': emp['id'], 'type': 'advance',
            'title': 'Auto Advance', 'description': f'Automatic advance for {for_month} (paid {today.isoformat()})',
            'amount': amount, 'sign': _ledger_sign('advance'), 'created_at': iso, 'for_month': for_month,
        })
        await db.auto_advances.update_one(
            {'employee_id': emp['id'], 'month': for_month},
            {'$set': {'employee_id': emp['id'], 'month': for_month, 'amount': amount, 'created_at': iso}},
            upsert=True,
        )
        await notify_user(emp['id'], 'Advance credited',
                           f"₹{amount:.0f} advance has been recorded for you this month.", '/')
        await _notify_module('payroll', 'Auto advance recorded',
                              f"₹{amount:.0f} auto-advance recorded for {emp['name']}", '/(tabs)/payroll',
                              script='payroll_auto_advance', admin_only=True)


async def _check_recurring_tasks():
    """Spawns task instances from each active recurring template.
    Weekly/monthly/yearly templates recur on the same weekday / day-of-month
    / month+day as the template's `start_date` — no separate weekday picker,
    the start date itself is the anchor (clamped to the month's length for
    monthly, so a 31st-anchored template still fires in a 30-day month).
    Hourly templates get a fresh instance every `interval_hours` hours.
    Idempotent via `db.task_generations` (keyed by template + date, plus an
    hour-bucket for hourly templates) so the 15-minute poll can safely
    re-check. A missed or completed instance never blocks the next one —
    each cycle is its own independent task, not a chain.

    A template stops generating once it hits its `end_date` or
    `max_repetitions` (at most one of those is ever set) — it's flipped to
    inactive at that point rather than silently going quiet, so it reads the
    same as a manually-paused template everywhere it's listed."""
    now_ist = now_utc().astimezone(IST)
    today = now_ist.date()
    today_iso = today.isoformat()

    async for tpl in db.task_templates.find({'active': True}, {'_id': 0}):
        try:
            start = date.fromisoformat(tpl['start_date']) if tpl.get('start_date') else None
        except ValueError:
            start = None
        if start and today < start:
            continue  # scheduled for later, not yet due to start

        if tpl.get('end_date') and today_iso > tpl['end_date']:
            await db.task_templates.update_one({'id': tpl['id']}, {'$set': {'active': False}})
            continue
        if tpl.get('max_repetitions') and (tpl.get('generated_count') or 0) >= tpl['max_repetitions']:
            await db.task_templates.update_one({'id': tpl['id']}, {'$set': {'active': False}})
            continue

        if tpl['freq'] == 'weekly':
            anchor_weekday = start.weekday() if start else tpl.get('weekday')
            if anchor_weekday is not None and today.weekday() != int(anchor_weekday):
                continue
        elif tpl['freq'] == 'monthly' and start:
            from calendar import monthrange
            last_day = monthrange(today.year, today.month)[1]
            if today.day != min(start.day, last_day):
                continue
        elif tpl['freq'] == 'yearly' and start:
            if (today.month, today.day) != (start.month, start.day):
                continue

        if tpl['freq'] == 'hourly':
            interval = max(1, int(tpl.get('interval_hours') or 1))
            hour_bucket = (now_ist.hour // interval) * interval
            gen_key = {'template_id': tpl['id'], 'date': today_iso, 'hour_bucket': hour_bucket}
        else:
            gen_key = {'template_id': tpl['id'], 'date': today_iso, 'hour_bucket': None}

        if await db.task_generations.find_one(gen_key, {'_id': 0}) is not None:
            continue  # already generated for this cycle

        emp = await db.employees.find_one({'id': tpl['assigned_to'], 'status': 'active'}, {'_id': 0})
        await db.task_generations.update_one(
            gen_key, {'$set': {**gen_key, 'created_at': now_utc().isoformat()}}, upsert=True,
        )
        if not emp:
            continue  # employee inactive/removed — mark generated, but skip creating a task for them
        iso = now_utc().isoformat()
        task_id = str(uuid.uuid4())
        title = tpl['title'] if tpl['freq'] != 'hourly' else f"{tpl['title']} ({hour_bucket:02d}:00)"
        await db.tasks.insert_one({
            'id': task_id, 'title': title, 'description': tpl.get('description', ''),
            'assigned_to': tpl['assigned_to'], 'assigned_to_name': emp['name'], 'assigned_by': 'Recurring',
            'priority': tpl.get('priority', 'normal'), 'due_date': today_iso, 'due_time': tpl.get('due_time'), 'status': 'open',
            'points': tpl.get('points') or 0, 'points_awarded': None,
            'repeat_reminder': bool(tpl.get('repeat_reminder')), 'last_reminded_at': None,
            'max_reminders': tpl.get('max_reminders'), 'reminder_count': 0,
            'reminder_interval': tpl.get('reminder_interval') or 'hourly',
            'comments': [], 'recurring_template_id': tpl['id'], 'overdue_notified_at': None,
            'created_at': iso, 'completed_at': None,
        })
        await db.task_templates.update_one({'id': tpl['id']}, {'$inc': {'generated_count': 1}})
        await notify_user(tpl['assigned_to'], 'New task assigned', title, '/(emp)/tasks')


async def _check_overdue_tasks():
    """Pushes owner/admin once per task that's past its due date and still
    open — guarded by `overdue_notified_at` so it fires exactly once, not
    every 15-minute poll cycle."""
    today_iso = now_utc().astimezone(IST).date().isoformat()
    async for t in db.tasks.find(
        {'status': 'open', 'due_date': {'$ne': None, '$lt': today_iso}, 'overdue_notified_at': None},
        {'_id': 0},
    ):
        await db.tasks.update_one({'id': t['id']}, {'$set': {'overdue_notified_at': now_utc().isoformat()}})
        await _notify_module('tasks', 'Task overdue',
                              f"{t.get('assigned_to_name', 'Someone')}: {t['title']} was due {t['due_date']}", '/tasks',
                              script='task_overdue', admin_only=True)


# How often to re-nudge an assignee on a repeat_reminder task — the assigner
# picks one of these two per task/template (TaskIn.reminder_interval),
# default 'hourly'. Cutoffs now vary per task, so the DB query can no longer
# do the "due for another nudge" filtering itself (see below).
REMINDER_INTERVAL_MINUTES = {'hourly': 60, 'daily': 24 * 60}


async def _check_task_repeat_reminders():
    """For tasks created with 'repeat_reminder' on, keep nudging the assignee
    every reminder_interval (hourly/daily) until it's marked done — separate
    from (and in addition to) the one-time owner/admin overdue alert. Stops
    early once `max_reminders` nudges have gone out, if that cap is set —
    unset means keep nudging until done, same as the original behavior."""
    now_iso = now_utc().isoformat()
    async for t in db.tasks.find({'status': 'open', 'repeat_reminder': True}, {'_id': 0}):
        if t.get('max_reminders') and (t.get('reminder_count') or 0) >= t['max_reminders']:
            continue
        interval_min = REMINDER_INTERVAL_MINUTES.get(t.get('reminder_interval'), 60)
        cutoff = (now_utc() - timedelta(minutes=interval_min)).isoformat()
        # Don't start nudging before the task even existed for one interval —
        # avoids an immediate duplicate of the "New task assigned" push.
        reference = t.get('last_reminded_at') or t.get('created_at')
        if reference and reference > cutoff:
            continue
        await db.tasks.update_one({'id': t['id']}, {'$set': {'last_reminded_at': now_iso}, '$inc': {'reminder_count': 1}})
        await notify_user(t['assigned_to'], 'Task reminder', f"Still pending: {t['title']}", '/(emp)/tasks')


async def _attendance_reminder_loop():
    while True:
        try:
            await asyncio.sleep(15 * 60)
            await _check_missed_attendance()
            await _check_missed_checkout()
            await _check_attendance_anomalies()
            await _check_daily_absentee_summary()
            await _check_repair_sample_followups()
            await _check_auto_advances()
            await _check_recurring_tasks()
            await _check_overdue_tasks()
            await _check_task_repeat_reminders()
            from routers.documents import check_pending_reminders
            await check_pending_reminders()
            from routers.gold_loans import check_interest_due, check_monthly_interest_collection_reminder
            await check_interest_due()
            await check_monthly_interest_collection_reminder()
        except Exception as e:
            logger.warning(f'attendance reminder loop error: {e}')


# ---------------- Reports (PDF) ----------------
def _report_pdf(title: str, subtitle: str, columns: list, rows: list) -> bytes:
    from io import BytesIO
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors as rlcolors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=12*mm, rightMargin=12*mm, topMargin=14*mm, bottomMargin=14*mm)
    styles = getSampleStyleSheet()
    gold = rlcolors.HexColor('#D4AF37')
    dark = rlcolors.HexColor('#0D0D0D')
    els = [
        Paragraph(f"<b>{title}</b>",
                  ParagraphStyle('t', parent=styles['Title'], textColor=dark, fontSize=18)),
        Paragraph(subtitle, ParagraphStyle('s', parent=styles['Normal'], textColor=rlcolors.HexColor('#555'), fontSize=9)),
        Spacer(1, 6*mm),
    ]
    data = [columns] + [[str(v) if v is not None else '—' for v in r] for r in rows]
    t = Table(data, repeatRows=1)
    style = TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), gold),
        ('TEXTCOLOR', (0, 0), (-1, 0), dark),
        ('FONT', (0, 0), (-1, 0), 'Helvetica-Bold', 9),
        ('FONT', (0, 1), (-1, -1), 'Helvetica', 8),
        ('GRID', (0, 0), (-1, -1), 0.25, rlcolors.HexColor('#ddd')),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
    ])
    t.setStyle(style)
    els.append(t)
    els.append(Spacer(1, 8*mm))
    els.append(Paragraph(f"Generated {now_utc().strftime('%d %b %Y %H:%M UTC')} · RMJ One",
                          ParagraphStyle('f', parent=styles['Normal'], fontSize=7, textColor=rlcolors.HexColor('#999'))))
    doc.build(els)
    pdf = buf.getvalue(); buf.close()
    return pdf


def _pdf_response(pdf: bytes, filename: str):
    from starlette.responses import Response as SR
    return SR(content=pdf, media_type='application/pdf',
              headers={'Content-Disposition': f'inline; filename="{filename}"'})


# ---------------- Employee photo thumbnails ----------------
# Employee photos (captured at ~720px wide, per PhotoCaptureModal) are shown
# as small avatars in several list screens — Employees, Attendance, Payroll —
# every one of which re-fetches its whole list on every visit. Shipping the
# full-size photo for every row on every one of those loads was the single
# largest remaining payload on those screens. photo_thumb is a ~96px, heavily
# compressed copy generated once (on save, or backfilled for existing
# employees below) and is what every *list* response actually sends; the
# full-size photo is still stored and used on the employee's own detail page.
_PHOTO_THUMB_SIZE = 96


def _make_photo_thumb(photo_data_uri: Optional[str]) -> str:
    if not photo_data_uri or not photo_data_uri.startswith('data:'):
        return ''
    try:
        import base64
        from io import BytesIO
        from PIL import Image
        header, b64 = photo_data_uri.split(',', 1)
        img = Image.open(BytesIO(base64.b64decode(b64)))
        img = img.convert('RGB')
        img.thumbnail((_PHOTO_THUMB_SIZE, _PHOTO_THUMB_SIZE))
        out = BytesIO()
        img.save(out, format='JPEG', quality=55)
        return f"data:image/jpeg;base64,{base64.b64encode(out.getvalue()).decode('ascii')}"
    except Exception as e:
        logger.warning(f'photo thumb generation failed: {e}')
        return ''


# ---------------- Routers (§2.1 split — see backend/routers/) ----------------
# Imported here, at the very bottom, after every shared name above (db, auth
# deps, models, cross-domain helpers) already exists at module scope — each
# router module does `from server import ...` at its own top, which re-enters
# this file, so those names must already be defined by the time this import
# runs.
from routers import (
    auth, employees, settings as settings_router, attendance, tasks, repairs,
    users, payroll, notifications, biometric, reports, assistant, samples,
    cashbook, ledger, documents, backup, record_photos, gold_loans,
)

# ---------------- Mount ----------------
api.include_router(auth.router)
api.include_router(employees.router)
api.include_router(settings_router.router)
api.include_router(attendance.router)
api.include_router(tasks.router)
api.include_router(repairs.router)
api.include_router(users.router)
api.include_router(payroll.router)
api.include_router(notifications.router)
api.include_router(biometric.router)
api.include_router(reports.router)
api.include_router(assistant.router)
api.include_router(samples.router)
api.include_router(cashbook.router)
api.include_router(ledger.router)
api.include_router(documents.router)
api.include_router(record_photos.router)
api.include_router(gold_loans.router)
api.include_router(backup.router)

app.include_router(api)
app.include_router(biometric.iclock_router)  # /iclock/* — real device protocol, no /api prefix

app.add_middleware(
    CORSMiddleware, allow_credentials=True, allow_origins=ALLOWED_ORIGINS,
    allow_methods=['*'], allow_headers=['*'],
)
# Compresses every response over 500 bytes — plain JSON list payloads
# (the bulk of this API's traffic) typically shrink 70-80%, so this is a
# free win on every page load with zero endpoint-level changes.
app.add_middleware(GZipMiddleware, minimum_size=500)
