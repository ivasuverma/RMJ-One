from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
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
    {'key': 'store_settings', 'label': 'Store Settings', 'default_roles': ['owner']},
    {'key': 'users', 'label': 'Staff Accounts', 'default_roles': ['owner']},
    {'key': 'tasks', 'label': 'Tasks', 'default_roles': ['owner', 'admin']},
    # The modules an employee can be granted, matching the tiles they're ever
    # shown: Transactions > Repair, Repair Bill, Sample Issue/Receive;
    # Reports > Customer Ledger, Karigar Ledger. "Repair" access also covers
    # browsing repair items (read) so a Repair Bill-only employee can still
    # pick an item to bill — see the ['repairs', 'repair_bill'] any-of checks
    # on the relevant endpoints.
    {'key': 'repairs', 'label': 'Repair', 'default_roles': ['owner', 'admin'], 'employee_assignable': True},
    {'key': 'repair_bill', 'label': 'Repair Bill', 'default_roles': ['owner', 'admin'], 'employee_assignable': True},
    {'key': 'customer_ledger', 'label': 'Customer Ledger', 'default_roles': ['owner', 'admin', 'accountant'], 'employee_assignable': True},
    {'key': 'karigar_ledger', 'label': 'Karigar Ledger', 'default_roles': ['owner', 'admin', 'accountant'], 'employee_assignable': True},
    {'key': 'samples', 'label': 'Sample Issue/Receive', 'default_roles': ['owner', 'admin'], 'employee_assignable': True},
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


def require_admin_or_module(key):
    def _check(user=Depends(get_current)):
        role = user.get('role')
        if role in ('owner', 'admin'):
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
    department: Optional[str] = ''
    designation: Optional[str] = ''
    shift: Optional[str] = 'General'
    salary: float = 0
    joining_date: Optional[str] = None
    mobile: Optional[str] = ''
    address: Optional[str] = ''
    aadhaar: Optional[str] = ''
    pan: Optional[str] = ''
    bank_account: Optional[str] = ''
    bank_ifsc: Optional[str] = ''
    bank_name: Optional[str] = ''
    photo: Optional[str] = ''
    status: Literal['active', 'inactive', 'on_leave'] = 'active'
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


class NotificationModuleSettingsIn(BaseModel):
    enabled: bool = True
    # Broad recipients by role. `None` (the default, when a module hasn't
    # been touched yet) means "use that module's built-in default roles" —
    # an explicit [] means the owner deliberately cleared all roles (e.g.
    # relying on user_ids alone, or just muting it for everyone but keeping
    # it enabled=false would achieve the same thing more simply).
    roles: Optional[List[Literal['owner', 'admin', 'accountant', 'employee']]] = None
    # Specific staff/employee ids to notify in addition to the role-matched
    # set above — lets an owner say "always also ping Rahul" without having
    # to make Rahul an admin.
    user_ids: List[str] = []


class NotificationSettingsIn(BaseModel):
    modules: Dict[str, NotificationModuleSettingsIn] = {}


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


class ShiftIn(BaseModel):
    name: str
    start: str  # HH:MM
    end: str    # HH:MM
    grace_min: int = 15
    # "Late master": if set (>0), a check-in this many minutes past start+grace turns
    # the whole day into a half-day for payroll, even if full hours were later worked.
    late_half_day_after_min: Optional[int] = None
    is_active: bool = True


class HolidayIn(BaseModel):
    date: str  # YYYY-MM-DD
    name: str
    type: Literal['public', 'festival', 'store_closed'] = 'public'


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


class TaskUpdateIn(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    assigned_to: Optional[str] = None
    priority: Optional[Literal['low', 'normal', 'urgent']] = None
    due_date: Optional[str] = None


class TaskCommentIn(BaseModel):
    text: str


class TaskTemplateIn(BaseModel):
    title: str
    description: Optional[str] = ''
    assigned_to: str
    priority: Literal['low', 'normal', 'urgent'] = 'normal'
    freq: Literal['daily', 'weekly', 'hourly'] = 'daily'
    weekday: Optional[int] = None  # 0=Monday..6=Sunday, required when freq='weekly'
    interval_hours: Optional[int] = 1  # required when freq='hourly' — spawn a fresh instance every N hours
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
    karigar_id: str
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
    photo: Optional[str] = ''


class SampleIn(BaseModel):
    karigar_id: str
    note: Optional[str] = ''
    items: List[SampleItemSpec]


class SampleUpdateIn(BaseModel):
    description: Optional[str] = None
    tag_number: Optional[str] = None
    note: Optional[str] = None


class SampleReceiveIn(BaseModel):
    received_weight: float
    note: Optional[str] = ''


# ---------------- Seed ----------------
async def seed():
    await db.users.create_index('username', unique=True)
    await db.employees.create_index('employee_code')
    await db.employees.create_index('biometric_id')
    await db.attendance.create_index([('employee_id', 1), ('date', 1)], unique=True)
    await db.attendance_events.create_index('created_at')

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
        docs, events = [], []
        for name, code, dept, desig, shift, sal, jd, mob, pin in samples:
            eid = str(uuid.uuid4())
            docs.append({
                'id': eid, 'name': name, 'employee_code': code, 'department': dept,
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
    async for e in db.timeline.find(
        {'employee_id': emp_id, 'created_at': {'$lt': up_to_date_exclusive}}, {'_id': 0}
    ).sort('created_at', 1):
        t = e.get('type')
        if t in ('advance', 'bonus', 'fine', 'deduction', 'salary'):
            amt = float(e.get('amount') or 0)
            sign = e.get('sign', _ledger_sign(t))
            delta = sign * abs(amt) if t != 'salary' else amt
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


async def _send_push_to_subs(subs: list, title: str, body: str, url: str = '/'):
    if not WEBPUSH_AVAILABLE or not VAPID_PRIVATE_KEY:
        return
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
            if status in (404, 410):
                await db.push_subscriptions.delete_one({'id': sub['id']})
            else:
                logger.warning(f'push send failed: {e}')
        except Exception as e:
            logger.warning(f'push send failed: {e}')


async def _store_notification(user_id: str, title: str, body: str, url: str):
    await db.notifications.insert_one({
        'id': str(uuid.uuid4()), 'user_id': user_id, 'title': title, 'body': body,
        'url': url or '/', 'read': False, 'created_at': now_utc().isoformat(),
    })


async def notify_user(user_id: str, title: str, body: str, url: str = '/'):
    try:
        await _store_notification(user_id, title, body, url)
        subs = await db.push_subscriptions.find({'user_id': user_id}, {'_id': 0}).to_list(20)
        await _send_push_to_subs(subs, title, body, url)
    except Exception as e:
        logger.warning(f'notify_user failed: {e}')


async def notify_roles(roles: list, title: str, body: str, url: str = '/'):
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
    {'key': 'samples', 'label': 'Sample Issue/Receive', 'default_roles': ['owner', 'admin']},
]
NOTIFICATION_MODULE_KEYS = {m['key'] for m in NOTIFICATION_MODULES}
NOTIFICATION_MODULE_DEFAULT_ROLES = {m['key']: m['default_roles'] for m in NOTIFICATION_MODULES}


async def _notify_module(module: str, title: str, body: str, url: str = '/'):
    """Broadcast a module event to whichever staff/employees are configured to
    receive it, honoring the admin's Notification Settings (Settings >
    Notifications). Falls back to the module's default roles if unconfigured."""
    try:
        settings = await db.settings.find_one({'id': 'notifications'}, {'_id': 0})
        cfg = ((settings or {}).get('modules') or {}).get(module) or {}
        if not cfg.get('enabled', True):
            return
        roles = cfg.get('roles')
        if roles is None:
            roles = NOTIFICATION_MODULE_DEFAULT_ROLES.get(module, ['owner', 'admin'])
        role_recipient_ids = set()
        if roles:
            async for u in db.users.find({'role': {'$in': roles}}, {'_id': 0, 'id': 1}):
                role_recipient_ids.add(u['id'])
            if 'employee' in roles:
                async for e in db.employees.find({'status': {'$ne': 'inactive'}}, {'_id': 0, 'id': 1}):
                    role_recipient_ids.add(e['id'])
            await notify_roles(roles, title, body, url)
        # Specific individuals picked in addition to (or instead of) roles —
        # skip anyone already covered by the role broadcast above to avoid a
        # duplicate notification.
        for uid in (cfg.get('user_ids') or []):
            if uid not in role_recipient_ids:
                await notify_user(uid, title, body, url)
    except Exception as e:
        logger.warning(f'_notify_module failed for {module}: {e}')


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
        await db.checkout_reminders.update_one(
            {'employee_id': emp['id'], 'date': today},
            {'$set': {'employee_id': emp['id'], 'date': today, 'sent_at': now_utc().isoformat()}},
            upsert=True,
        )


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
            shown, '/(tabs)/attendance',
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
    for_month = f'{prev_year:04d}-{prev_month:02d}'

    async for emp in db.employees.find(
        {'status': 'active', 'auto_advance_amount': {'$gt': 0}, 'auto_advance_day': {'$ne': None}},
        {'_id': 0, 'password_hash': 0},
    ):
        day = int(emp.get('auto_advance_day') or 0)
        if day <= 0:
            continue
        if today.day != min(day, last_day):
            continue
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
                              f"₹{amount:.0f} auto-advance recorded for {emp['name']}", '/(tabs)/payroll')


async def _check_recurring_tasks():
    """Spawns task instances from each active recurring template. Daily/weekly
    templates get one instance per day (or matching weekday); hourly templates
    get a fresh instance every `interval_hours` hours. Idempotent via
    `db.task_generations` (keyed by template + date, plus an hour-bucket for
    hourly templates) so the 15-minute poll can safely re-check. A missed or
    completed instance never blocks the next one — each cycle is its own
    independent task, not a chain."""
    now_ist = now_utc().astimezone(IST)
    today = now_ist.date()
    today_iso = today.isoformat()

    async for tpl in db.task_templates.find({'active': True}, {'_id': 0}):
        if tpl['freq'] == 'weekly' and tpl.get('weekday') is not None and today.weekday() != int(tpl['weekday']):
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
            'priority': tpl.get('priority', 'normal'), 'due_date': today_iso, 'status': 'open',
            'comments': [], 'recurring_template_id': tpl['id'], 'overdue_notified_at': None,
            'created_at': iso, 'completed_at': None,
        })
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
                              f"{t.get('assigned_to_name', 'Someone')}: {t['title']} was due {t['due_date']}", '/tasks')


async def _attendance_reminder_loop():
    while True:
        try:
            await asyncio.sleep(15 * 60)
            await _check_missed_attendance()
            await _check_missed_checkout()
            await _check_daily_absentee_summary()
            await _check_auto_advances()
            await _check_recurring_tasks()
            await _check_overdue_tasks()
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


# ---------------- Routers (§2.1 split — see backend/routers/) ----------------
# Imported here, at the very bottom, after every shared name above (db, auth
# deps, models, cross-domain helpers) already exists at module scope — each
# router module does `from server import ...` at its own top, which re-enters
# this file, so those names must already be defined by the time this import
# runs.
from routers import (
    auth, employees, settings as settings_router, attendance, tasks, repairs,
    users, payroll, notifications, biometric, reports, assistant, samples,
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

app.include_router(api)
app.include_router(biometric.iclock_router)  # /iclock/* — real device protocol, no /api prefix

app.add_middleware(
    CORSMiddleware, allow_credentials=True, allow_origins=ALLOWED_ORIGINS,
    allow_methods=['*'], allow_headers=['*'],
)
