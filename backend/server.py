from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, Query, Request
from fastapi.responses import PlainTextResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import math
from pathlib import Path
from pydantic import BaseModel
from typing import List, Optional, Literal
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


def today_str() -> str:
    return date.today().isoformat()


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
    {'key': 'repairs', 'label': 'Gold & Diamond Repairs', 'default_roles': ['owner', 'admin']},
]
MODULE_KEYS = {m['key'] for m in MODULE_DEFS}
MODULE_DEFAULT_ROLES = {m['key']: set(m['default_roles']) for m in MODULE_DEFS}


def _default_modules_for_role(role: str) -> list:
    return sorted(k for k, roles in MODULE_DEFAULT_ROLES.items() if role in roles)


def resolve_modules(user: dict) -> list:
    """Owner always has every module. Otherwise an explicit `module_access` list
    (which may be set to []) overrides the role's default set; module_access being
    absent/None means 'use whatever this role normally gets'."""
    if user.get('role') == 'owner':
        return sorted(MODULE_KEYS)
    override = user.get('module_access')
    if override is not None:
        return sorted(set(override) & MODULE_KEYS)
    return _default_modules_for_role(user.get('role', ''))


def require_module(key: str):
    def _check(user=Depends(get_current)):
        if key not in resolve_modules(user):
            raise HTTPException(status_code=403, detail=f'No access to "{key}"')
        return user
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
    role: Literal['admin', 'accountant']


class UserUpdateIn(BaseModel):
    username: Optional[str] = None
    name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[Literal['admin', 'accountant']] = None


class SelfAccountUpdateIn(BaseModel):
    current_password: str
    new_username: Optional[str] = None
    new_password: Optional[str] = None


class ModuleAccessUpdateIn(BaseModel):
    # None = "use this account's role default"; [] = "explicitly no modules";
    # a list = "exactly these modules", regardless of role default.
    module_access: Optional[List[str]] = None


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
    freq: Literal['daily', 'weekly'] = 'daily'
    weekday: Optional[int] = None  # 0=Monday..6=Sunday, required when freq='weekly'
    active: bool = True


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


# ---------------- Auth ----------------
@api.get('/')
async def root(): return {'app': 'RMJ One', 'status': 'ok'}


@api.post('/auth/login')
async def login(body: LoginIn):
    user = await db.users.find_one({'username': body.username.strip().lower()})
    if not user or not verify_secret(body.password, user.get('password_hash', '')):
        raise HTTPException(status_code=401, detail='Invalid username or password')
    tok = create_token({'sub': user['id'], 'role': user.get('role', 'owner'), 'username': user['username']})
    return {
        'access_token': tok, 'token_type': 'bearer',
        'user': {
            'id': user['id'], 'username': user['username'], 'name': user['name'], 'role': user.get('role', 'owner'),
            'modules': resolve_modules(user),
        },
    }


@api.post('/auth/employee-login')
async def employee_login(body: EmployeeLoginIn):
    uname = body.username.strip().lower()
    emp = await db.employees.find_one({'username': uname})
    if not emp or not emp.get('password_hash') or not verify_secret(body.password, emp['password_hash']):
        raise HTTPException(status_code=401, detail='Invalid username or password')
    if emp.get('status') == 'inactive':
        raise HTTPException(status_code=403, detail='This employee account is inactive')
    code = emp.get('employee_code')
    tok = create_token({'sub': emp['id'], 'role': 'employee', 'employee_code': code})
    return {
        'access_token': tok, 'token_type': 'bearer',
        'user': {
            'id': emp['id'], 'username': emp.get('username', uname), 'name': emp['name'], 'role': 'employee',
            'employee_code': code, 'designation': emp.get('designation'),
            'department': emp.get('department'), 'photo': emp.get('photo', ''),
            'modules': resolve_modules({**emp, 'role': 'employee'}),
        },
    }


@api.get('/auth/me')
async def me(user=Depends(get_current)):
    if user['role'] in ('owner', 'admin', 'accountant'):
        return {
            'id': user['id'], 'username': user['username'], 'name': user['name'], 'role': user['role'],
            'modules': resolve_modules(user),
        }
    return {
        'id': user['id'], 'username': user.get('username') or user.get('employee_code'), 'name': user['name'], 'role': 'employee',
        'employee_code': user['employee_code'], 'designation': user.get('designation'),
        'department': user.get('department'), 'photo': user.get('photo', ''),
        'modules': resolve_modules(user),
    }


# ---------------- Employees ----------------
@api.get('/employees')
async def list_employees(
    q: Optional[str] = None,
    department: Optional[str] = None,
    status_: Optional[str] = Query(default=None, alias='status'),
    _: dict = Depends(get_current),
):
    query: dict = {}
    if q:
        query['$or'] = [
            {'name': {'$regex': q, '$options': 'i'}},
            {'employee_code': {'$regex': q, '$options': 'i'}},
            {'designation': {'$regex': q, '$options': 'i'}},
            {'department': {'$regex': q, '$options': 'i'}},
        ]
    if department: query['department'] = department
    if status_: query['status'] = status_
    docs = await db.employees.find(query, {'_id': 0, 'password_hash': 0, 'id_proofs': 0}).sort('name', 1).to_list(1000)
    return docs


@api.get('/employees/{emp_id}')
async def get_employee(emp_id: str, _: dict = Depends(get_current)):
    doc = await db.employees.find_one({'id': emp_id}, {'_id': 0, 'password_hash': 0})
    if not doc: raise HTTPException(status_code=404, detail='Employee not found')
    timeline = await db.timeline.find({'employee_id': emp_id}, {'_id': 0}).sort('created_at', -1).to_list(1000)
    return {'employee': doc, 'timeline': timeline}


@api.post('/employees')
async def create_employee(body: EmployeeIn, user: dict = Depends(require_admin)):
    iso = now_utc().isoformat()
    eid = str(uuid.uuid4())
    data = body.model_dump()
    if not data.get('employee_code'):
        count = await db.employees.count_documents({})
        data['employee_code'] = f'RMJ{(count + 1):03d}'
    else:
        data['employee_code'] = data['employee_code'].upper()
    # default login username = employee_code (lowercased); default password = last 4
    # digits of employee_code, else 0000 — same pattern as the old default-PIN scheme.
    default_username = data['employee_code'].lower()
    default_password = (''.join(ch for ch in data['employee_code'] if ch.isdigit())[-4:] or '0000').zfill(4)
    doc = {'id': eid, 'created_at': iso, 'updated_at': iso,
           'username': default_username, 'password_hash': hash_secret(default_password), **data}
    await db.employees.insert_one(dict(doc))
    await db.timeline.insert_one({
        'id': str(uuid.uuid4()), 'employee_id': eid, 'type': 'joined',
        'title': 'Joined RMJ', 'description': f"Joined as {data.get('designation') or 'Employee'}",
        'amount': 0, 'created_at': data.get('joining_date') or iso,
    })
    out = {k: v for k, v in doc.items() if k not in ('_id', 'password_hash')}
    out['default_username'] = default_username
    out['default_password'] = default_password
    await log_audit(user, 'employee.create', 'employee', eid, data.get('employee_code', ''), {'name': data.get('name')})
    return out


@api.put('/employees/{emp_id}')
async def update_employee(emp_id: str, body: EmployeeIn, user: dict = Depends(require_admin)):
    iso = now_utc().isoformat()
    existing = await db.employees.find_one({'id': emp_id}, {'_id': 0})
    if not existing: raise HTTPException(status_code=404, detail='Employee not found')
    data = body.model_dump()
    if data.get('employee_code'): data['employee_code'] = data['employee_code'].upper()
    await db.employees.update_one({'id': emp_id}, {'$set': {**data, 'updated_at': iso}})
    if float(existing.get('salary') or 0) != float(data.get('salary') or 0):
        await db.timeline.insert_one({
            'id': str(uuid.uuid4()), 'employee_id': emp_id, 'type': 'salary_revised',
            'title': 'Salary Revised',
            'description': f"From ₹{existing.get('salary', 0):.0f} to ₹{data.get('salary', 0):.0f}",
            'amount': float(data.get('salary') or 0) - float(existing.get('salary') or 0),
            'created_at': iso,
        })
    await log_audit(user, 'employee.update', 'employee', emp_id, data.get('employee_code', existing.get('employee_code', '')))
    return await db.employees.find_one({'id': emp_id}, {'_id': 0, 'password_hash': 0})


@api.delete('/employees/{emp_id}')
async def delete_employee(emp_id: str, user: dict = Depends(require_owner)):
    existing = await db.employees.find_one({'id': emp_id}, {'_id': 0})
    r = await db.employees.delete_one({'id': emp_id})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail='Employee not found')
    await db.timeline.delete_many({'employee_id': emp_id})
    await log_audit(user, 'employee.delete', 'employee', emp_id, (existing or {}).get('employee_code', ''), {'name': (existing or {}).get('name')})
    return {'ok': True}


@api.post('/employees/{emp_id}/id-proofs')
async def add_id_proof(emp_id: str, body: IdProofIn, user=Depends(require_admin)):
    existing = await db.employees.find_one({'id': emp_id}, {'_id': 0})
    if not existing: raise HTTPException(status_code=404, detail='Employee not found')
    proof = {
        'id': str(uuid.uuid4()), 'name': (body.name or 'Document').strip()[:200],
        'data_uri': body.data_uri, 'uploaded_at': now_utc().isoformat(),
    }
    await db.employees.update_one({'id': emp_id}, {'$push': {'id_proofs': proof}})
    await log_audit(user, 'employee.id_proof.add', 'employee', emp_id, existing.get('employee_code', ''), {'name': proof['name']})
    return proof


@api.delete('/employees/{emp_id}/id-proofs/{proof_id}')
async def delete_id_proof(emp_id: str, proof_id: str, user=Depends(require_admin)):
    await db.employees.update_one({'id': emp_id}, {'$pull': {'id_proofs': {'id': proof_id}}})
    await log_audit(user, 'employee.id_proof.delete', 'employee', emp_id, '', {'proof_id': proof_id})
    return {'ok': True}


@api.post('/employees/{emp_id}/set-credentials')
async def set_employee_credentials(emp_id: str, body: SetEmployeeCredentialsIn, user=Depends(require_admin)):
    uname = body.username.strip().lower()
    if not uname:
        raise HTTPException(status_code=400, detail='Username is required')
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail='Password must be 4+ characters')
    emp = await db.employees.find_one({'id': emp_id}, {'_id': 0})
    if not emp: raise HTTPException(status_code=404, detail='Employee not found')
    if uname != emp.get('username'):
        if await db.employees.find_one({'username': uname, 'id': {'$ne': emp_id}}):
            raise HTTPException(status_code=400, detail='Username already in use')
    await db.employees.update_one(
        {'id': emp_id},
        {'$set': {'username': uname, 'password_hash': hash_secret(body.password), 'updated_at': now_utc().isoformat()}},
    )
    await log_audit(user, 'employee.credentials.set', 'employee', emp_id, emp.get('name', ''), {})
    return {'ok': True}


# ---------------- Settings ----------------
@api.get('/settings/store')
async def get_store(_: dict = Depends(get_current)):
    doc = await db.settings.find_one({'id': 'store'}, {'_id': 0})
    return doc or {}


@api.put('/settings/store')
async def update_store(body: StoreSettingsIn, user: dict = Depends(require_owner)):
    payload = body.model_dump()
    payload['id'] = 'store'
    payload['updated_at'] = now_utc().isoformat()
    await db.settings.update_one({'id': 'store'}, {'$set': payload}, upsert=True)
    await log_audit(user, 'settings.store.update', 'settings', 'store', body.name)
    return await db.settings.find_one({'id': 'store'}, {'_id': 0})


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


@api.post('/attendance/check-in')
async def check_in(body: PunchIn, user=Depends(require_employee)):
    store = await _get_store()
    dist = haversine_m(body.latitude, body.longitude, store['latitude'], store['longitude'])
    if dist > float(store.get('radius_m', 150)):
        raise HTTPException(status_code=400, detail=f'Outside store area ({int(dist)}m away, allowed {int(store["radius_m"])}m).')
    if not body.selfie or len(body.selfie) < 100:
        raise HTTPException(status_code=400, detail='Selfie is required')

    d = today_str()
    existing = await db.attendance.find_one({'employee_id': user['id'], 'date': d}, {'_id': 0})
    if existing and existing.get('check_in'):
        raise HTTPException(status_code=400, detail='Already checked in today')

    now = now_utc()
    now_local = now.astimezone(timezone(timedelta(hours=5, minutes=30)))
    minutes_now = now_local.hour * 60 + now_local.minute
    shift = await db.shifts.find_one({'name': user.get('shift')}, {'_id': 0})
    work_start = _minutes(shift['start']) if shift and shift.get('start') else _minutes(store.get('work_start', '10:00'))
    grace = int(shift.get('grace_min', 15)) if shift else int(store.get('grace_min', 15))
    late_by_min = minutes_now - (work_start + grace)
    is_late = late_by_min > 0

    check_in_doc = {
        'timestamp': now.isoformat(), 'latitude': body.latitude, 'longitude': body.longitude,
        'selfie': body.selfie, 'distance_m': round(dist, 1), 'is_late': is_late,
        'late_by_min': max(late_by_min, 0),
    }
    if existing:
        await db.attendance.update_one({'id': existing['id']}, {'$set': {'check_in': check_in_doc, 'is_late': is_late, 'status': 'present'}})
        att_id = existing['id']
    else:
        att_id = str(uuid.uuid4())
        await db.attendance.insert_one({
            'id': att_id, 'employee_id': user['id'], 'date': d,
            'check_in': check_in_doc, 'check_out': None, 'is_late': is_late,
            'working_hours': 0, 'status': 'present', 'created_at': now.isoformat(),
        })

    await db.attendance_events.insert_one({
        'id': str(uuid.uuid4()), 'employee_id': user['id'], 'employee_name': user['name'],
        'type': 'check_in', 'timestamp': now.isoformat(), 'is_late': is_late,
        'created_at': now.isoformat(),
    })
    await notify_roles(['owner', 'admin'], f"{user['name']} checked in",
                        f"{now_local.strftime('%I:%M %p')}{' · Late' if is_late else ''}", '/(tabs)/attendance')

    return {'ok': True, 'attendance_id': att_id, 'is_late': is_late, 'timestamp': now.isoformat()}


@api.post('/attendance/check-out')
async def check_out(body: PunchIn, user=Depends(require_employee)):
    store = await _get_store()
    dist = haversine_m(body.latitude, body.longitude, store['latitude'], store['longitude'])
    if dist > float(store.get('radius_m', 150)):
        raise HTTPException(status_code=400, detail=f'Outside store area ({int(dist)}m away, allowed {int(store["radius_m"])}m).')
    if not body.selfie or len(body.selfie) < 100:
        raise HTTPException(status_code=400, detail='Selfie is required')

    d = today_str()
    existing = await db.attendance.find_one({'employee_id': user['id'], 'date': d}, {'_id': 0})
    if not existing or not existing.get('check_in'):
        raise HTTPException(status_code=400, detail='You must check in before checking out')
    if existing.get('check_out'):
        raise HTTPException(status_code=400, detail='Already checked out today')

    now = now_utc()
    check_in_ts = datetime.fromisoformat(existing['check_in']['timestamp'])
    hours = round((now - check_in_ts).total_seconds() / 3600.0, 2)

    shift = await db.shifts.find_one({'name': user.get('shift')}, {'_id': 0})
    late_half_day_after = int(shift.get('late_half_day_after_min') or 0) if shift else 0
    late_by_min = int(existing['check_in'].get('late_by_min') or 0)
    half_day_for_lateness = bool(late_half_day_after) and late_by_min >= late_half_day_after
    status = 'half_day' if (hours < 4 or half_day_for_lateness) else 'present'
    half_day_reason = None
    if status == 'half_day':
        half_day_reason = 'short_hours' if hours < 4 else 'late'

    check_out_doc = {
        'timestamp': now.isoformat(), 'latitude': body.latitude, 'longitude': body.longitude,
        'selfie': body.selfie, 'distance_m': round(dist, 1),
    }
    await db.attendance.update_one(
        {'id': existing['id']},
        {'$set': {'check_out': check_out_doc, 'working_hours': hours, 'status': status, 'half_day_reason': half_day_reason}},
    )
    await db.attendance_events.insert_one({
        'id': str(uuid.uuid4()), 'employee_id': user['id'], 'employee_name': user['name'],
        'type': 'check_out', 'timestamp': now.isoformat(), 'working_hours': hours,
        'created_at': now.isoformat(),
    })
    await notify_roles(['owner', 'admin'], f"{user['name']} checked out",
                        f"Worked {hours}h today" + (' · Half day' if status == 'half_day' else ''), '/(tabs)/attendance')
    return {'ok': True, 'working_hours': hours, 'timestamp': now.isoformat()}


@api.get('/attendance/me/today')
async def my_today(user=Depends(require_employee)):
    doc = await db.attendance.find_one({'employee_id': user['id'], 'date': today_str()}, {'_id': 0})
    return doc or {}


@api.get('/attendance/today')
async def attendance_today(_: dict = Depends(require_staff)):
    d = today_str()
    employees = await db.employees.find({}, {'_id': 0, 'password_hash': 0, 'photo': 0}).sort('name', 1).to_list(1000)
    att_map = {}
    async for a in db.attendance.find({'date': d}, {'_id': 0, 'check_in.selfie': 0, 'check_out.selfie': 0}):
        att_map[a['employee_id']] = a
    rows = []
    for e in employees:
        a = att_map.get(e['id'])
        row = {
            'employee_id': e['id'], 'employee_code': e.get('employee_code'), 'name': e['name'],
            'department': e.get('department', ''), 'designation': e.get('designation', ''),
            'shift': e.get('shift', ''), 'employee_status': e.get('status', 'active'),
        }
        if e.get('status') == 'on_leave':
            row.update({'status': 'on_leave', 'check_in': None, 'check_out': None, 'is_late': False, 'working_hours': 0})
        elif a:
            row.update({
                'status': a.get('status') or ('present' if a.get('check_in') else 'absent'),
                'check_in': a.get('check_in', {}).get('timestamp') if a.get('check_in') else None,
                'check_out': a.get('check_out', {}).get('timestamp') if a.get('check_out') else None,
                'is_late': a.get('is_late', False),
                'working_hours': a.get('working_hours', 0),
                'missing_punch': bool(a.get('check_in') and not a.get('check_out')),
            })
        else:
            row.update({'status': 'absent', 'check_in': None, 'check_out': None, 'is_late': False, 'working_hours': 0})
        rows.append(row)
    return rows


@api.get('/attendance/live')
async def attendance_live(_: dict = Depends(require_staff)):
    events = await db.attendance_events.find({}, {'_id': 0}).sort('created_at', -1).limit(30).to_list(30)
    return events


# ---- Calendar view + edit ----
def _iter_month_dates(year: int, month: int):
    from calendar import monthrange
    days = monthrange(year, month)[1]
    for d in range(1, days + 1):
        yield date(year, month, d)


@api.get('/attendance/calendar/{emp_id}')
async def attendance_calendar(emp_id: str, year: int, month: int, user=Depends(get_current)):
    if user['role'] == 'employee' and user['id'] != emp_id:
        raise HTTPException(status_code=403, detail='Employees can view only their own calendar')
    if not await db.employees.find_one({'id': emp_id}, {'_id': 0, 'id': 1}):
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

    days_out = []
    for d in _iter_month_dates(year, month):
        ds = d.isoformat()
        a = att_map.get(ds)
        # Determine effective status
        on_leave = any(l['from_date'] <= ds <= l['to_date'] for l in leaves)
        holiday = holidays.get(ds)
        status = 'absent'
        if holiday: status = 'holiday'
        if on_leave: status = 'leave'
        if not holiday and not on_leave and not a and d.weekday() == 6:
            status = 'weekly_off'  # default paid weekly off (Sunday) when nothing else recorded
        if a:
            if a.get('status') == 'present' and a.get('check_in'): status = 'present'
            elif a.get('status') == 'half_day': status = 'half_day'
            elif a.get('status') == 'weekly_off': status = 'weekly_off'
            elif a.get('status') == 'absent': status = 'absent'
            elif a.get('check_in') and not a.get('check_out'): status = 'missing_punch'
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
        dt = datetime(d.year, d.month, d.day, int(h), int(m), tzinfo=timezone(timedelta(hours=5, minutes=30)))
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return None


@api.put('/attendance/day/{emp_id}/{d}')
async def edit_day(emp_id: str, d: str, body: AttendanceDayIn, user=Depends(require_admin)):
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
            in_local = datetime.fromisoformat(check_in_ts).astimezone(timezone(timedelta(hours=5, minutes=30)))
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


@api.delete('/attendance/day/{emp_id}/{d}')
async def delete_day(emp_id: str, d: str, user=Depends(require_admin)):
    existing = await db.attendance.find_one({'employee_id': emp_id, 'date': d}, {'_id': 0})
    if not existing:
        raise HTTPException(status_code=404, detail='No attendance record for this day')
    await db.attendance.delete_one({'id': existing['id']})
    # Also clear any raw punch events logged for this employee within that IST day,
    # so a deleted entry doesn't linger in the "Live" feed.
    try:
        day_start_ist = datetime.fromisoformat(d).replace(tzinfo=timezone(timedelta(hours=5, minutes=30)))
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
@api.post('/attendance/corrections/calendar')
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
@api.post('/attendance/corrections')
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
    await notify_roles(['owner', 'admin'], 'New attendance correction request',
                        f"{user['name']} requested a correction for {doc['date']}", '/approvals')
    return {k: v for k, v in doc.items() if k != '_id'}


@api.get('/attendance/corrections')
async def list_corrections(
    status_: Optional[str] = Query(default=None, alias='status'),
    user=Depends(get_current),
):
    query: dict = {}
    if status_: query['status'] = status_
    if user['role'] == 'employee': query['employee_id'] = user['id']
    return await db.corrections.find(query, {'_id': 0}).sort('created_at', -1).to_list(500)


@api.post('/attendance/corrections/{cid}/decide')
async def decide_correction(cid: str, body: DecisionIn, user=Depends(require_admin)):
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
@api.post('/leaves')
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
    await notify_roles(['owner', 'admin'], 'New leave request',
                        f"{user['name']} requested leave {doc['from_date']} to {doc['to_date']}", '/approvals')
    return {k: v for k, v in doc.items() if k != '_id'}


@api.get('/leaves')
async def list_leaves(
    status_: Optional[str] = Query(default=None, alias='status'),
    user=Depends(get_current),
):
    query: dict = {}
    if status_: query['status'] = status_
    if user['role'] == 'employee': query['employee_id'] = user['id']
    return await db.leaves.find(query, {'_id': 0}).sort('created_at', -1).to_list(500)


@api.post('/leaves/{lid}/decide')
async def decide_leave(lid: str, body: DecisionIn, user=Depends(require_admin)):
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


# ---------------- Tasks ----------------
@api.post('/tasks')
async def create_task(body: TaskIn, user=Depends(require_admin)):
    emp = await db.employees.find_one({'id': body.assigned_to}, {'_id': 0})
    if not emp: raise HTTPException(status_code=404, detail='Employee not found')
    iso = now_utc().isoformat()
    doc = {
        'id': str(uuid.uuid4()), 'title': body.title.strip(), 'description': body.description or '',
        'assigned_to': body.assigned_to, 'assigned_to_name': emp['name'], 'assigned_by': user['name'],
        'priority': body.priority, 'due_date': body.due_date, 'status': 'open',
        'comments': [], 'recurring_template_id': None, 'overdue_notified_at': None,
        'created_at': iso, 'completed_at': None,
    }
    await db.tasks.insert_one(dict(doc))
    await log_audit(user, 'task.create', 'task', doc['id'], body.title, {'assigned_to': emp['name']})
    await notify_user(body.assigned_to, 'New task assigned', body.title, '/(emp)/tasks')
    return {k: v for k, v in doc.items() if k != '_id'}


@api.get('/tasks')
async def list_tasks(
    employee_id: Optional[str] = None, status_: Optional[str] = Query(default=None, alias='status'),
    user=Depends(get_current),
):
    query: dict = {}
    if user.get('role') == 'employee':
        query['assigned_to'] = user['id']
    elif employee_id:
        query['assigned_to'] = employee_id
    if status_: query['status'] = status_
    return await db.tasks.find(query, {'_id': 0}).sort('created_at', -1).to_list(1000)


@api.get('/tasks/{task_id}')
async def get_task(task_id: str, user=Depends(get_current)):
    t = await db.tasks.find_one({'id': task_id}, {'_id': 0})
    if not t: raise HTTPException(status_code=404, detail='Task not found')
    if user.get('role') == 'employee' and t['assigned_to'] != user['id']:
        raise HTTPException(status_code=403, detail='Not your task')
    return t


@api.put('/tasks/{task_id}')
async def update_task(task_id: str, body: TaskUpdateIn, user=Depends(require_admin)):
    t = await db.tasks.find_one({'id': task_id}, {'_id': 0})
    if not t: raise HTTPException(status_code=404, detail='Task not found')
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if 'assigned_to' in upd:
        emp = await db.employees.find_one({'id': upd['assigned_to']}, {'_id': 0})
        if not emp: raise HTTPException(status_code=404, detail='Employee not found')
        upd['assigned_to_name'] = emp['name']
        if upd['assigned_to'] != t['assigned_to']:
            await notify_user(upd['assigned_to'], 'Task assigned to you', t['title'], '/(emp)/tasks')
    if upd:
        await db.tasks.update_one({'id': task_id}, {'$set': upd})
        await log_audit(user, 'task.update', 'task', task_id, upd.get('title', t.get('title', '')))
    return await db.tasks.find_one({'id': task_id}, {'_id': 0})


@api.delete('/tasks/{task_id}')
async def delete_task(task_id: str, user=Depends(require_admin)):
    t = await db.tasks.find_one({'id': task_id}, {'_id': 0})
    r = await db.tasks.delete_one({'id': task_id})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail='Task not found')
    await log_audit(user, 'task.delete', 'task', task_id, (t or {}).get('title', ''))
    return {'ok': True}


@api.post('/tasks/{task_id}/complete')
async def complete_task(task_id: str, user=Depends(get_current)):
    t = await db.tasks.find_one({'id': task_id}, {'_id': 0})
    if not t: raise HTTPException(status_code=404, detail='Task not found')
    if user.get('role') == 'employee' and t['assigned_to'] != user['id']:
        raise HTTPException(status_code=403, detail='Not your task')
    if t['status'] == 'done':
        return t
    iso = now_utc().isoformat()
    await db.tasks.update_one({'id': task_id}, {'$set': {'status': 'done', 'completed_at': iso}})
    await log_audit(user, 'task.complete', 'task', task_id, t.get('title', ''))
    return await db.tasks.find_one({'id': task_id}, {'_id': 0})


@api.post('/tasks/{task_id}/reopen')
async def reopen_task(task_id: str, user=Depends(require_admin)):
    t = await db.tasks.find_one({'id': task_id}, {'_id': 0})
    if not t: raise HTTPException(status_code=404, detail='Task not found')
    await db.tasks.update_one({'id': task_id}, {'$set': {'status': 'open', 'completed_at': None, 'overdue_notified_at': None}})
    await log_audit(user, 'task.reopen', 'task', task_id, t.get('title', ''))
    return await db.tasks.find_one({'id': task_id}, {'_id': 0})


@api.post('/tasks/{task_id}/comments')
async def add_task_comment(task_id: str, body: TaskCommentIn, user=Depends(get_current)):
    t = await db.tasks.find_one({'id': task_id}, {'_id': 0})
    if not t: raise HTTPException(status_code=404, detail='Task not found')
    if user.get('role') == 'employee' and t['assigned_to'] != user['id']:
        raise HTTPException(status_code=403, detail='Not your task')
    comment = {
        'id': str(uuid.uuid4()), 'author_name': user['name'], 'author_role': user.get('role', ''),
        'text': body.text.strip(), 'created_at': now_utc().isoformat(),
    }
    await db.tasks.update_one({'id': task_id}, {'$push': {'comments': comment}})
    # Notify the other side of the conversation, not the commenter themselves.
    if user.get('role') == 'employee':
        await notify_roles(['owner', 'admin'], f"Comment on: {t['title']}", f"{user['name']}: {comment['text']}", '/tasks')
    else:
        await notify_user(t['assigned_to'], f"Comment on: {t['title']}", f"{user['name']}: {comment['text']}", '/(emp)/tasks')
    return comment


# ---------------- Task Templates (recurring) ----------------
@api.post('/tasks/templates')
async def create_task_template(body: TaskTemplateIn, user=Depends(require_admin)):
    emp = await db.employees.find_one({'id': body.assigned_to}, {'_id': 0})
    if not emp: raise HTTPException(status_code=404, detail='Employee not found')
    if body.freq == 'weekly' and body.weekday is None:
        raise HTTPException(status_code=400, detail='weekday is required for a weekly template')
    doc = {'id': str(uuid.uuid4()), **body.model_dump(), 'assigned_to_name': emp['name'], 'created_at': now_utc().isoformat()}
    await db.task_templates.insert_one(dict(doc))
    await log_audit(user, 'task_template.create', 'task_template', doc['id'], body.title)
    return {k: v for k, v in doc.items() if k != '_id'}


@api.get('/tasks/templates')
async def list_task_templates(_: dict = Depends(require_admin)):
    return await db.task_templates.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)


@api.put('/tasks/templates/{template_id}')
async def update_task_template(template_id: str, body: TaskTemplateIn, user=Depends(require_admin)):
    if not await db.task_templates.find_one({'id': template_id}):
        raise HTTPException(status_code=404, detail='Template not found')
    emp = await db.employees.find_one({'id': body.assigned_to}, {'_id': 0})
    if not emp: raise HTTPException(status_code=404, detail='Employee not found')
    await db.task_templates.update_one({'id': template_id}, {'$set': {**body.model_dump(), 'assigned_to_name': emp['name']}})
    await log_audit(user, 'task_template.update', 'task_template', template_id, body.title)
    return await db.task_templates.find_one({'id': template_id}, {'_id': 0})


@api.delete('/tasks/templates/{template_id}')
async def delete_task_template(template_id: str, user=Depends(require_admin)):
    t = await db.task_templates.find_one({'id': template_id}, {'_id': 0})
    r = await db.task_templates.delete_one({'id': template_id})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail='Template not found')
    await log_audit(user, 'task_template.delete', 'task_template', template_id, (t or {}).get('title', ''))
    return {'ok': True}


# ---------------- Dashboard ----------------
@api.get('/dashboard')
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

    total_salary = 0.0
    async for e in db.employees.find({'status': 'active'}, {'_id': 0, 'salary': 1}):
        total_salary += float(e.get('salary') or 0)
    adv_total = 0.0
    bonus_total = 0.0
    async for t in db.timeline.find({'type': 'advance'}, {'_id': 0, 'amount': 1}):
        adv_total += float(t.get('amount') or 0)
    async for t in db.timeline.find({'type': 'bonus'}, {'_id': 0, 'amount': 1}):
        bonus_total += float(t.get('amount') or 0)

    return {
        'todays_attendance': {
            'present': present, 'absent': absent, 'late': late, 'half_day': half_day,
            'missing_punch': missing_punch, 'leave': on_leave_status, 'working': working,
            'total': total,
        },
        'pending_approvals': {
            'attendance_corrections': pending_corrections,
            'leave_requests': pending_leaves,
            'salary_advances': 0,
            'payroll_approval': 0,
        },
        'payroll_summary': {
            'current_month_payroll': total_salary,
            'pending_salary': total_salary,
            'advances_outstanding': adv_total,
            'loans_outstanding': 0,
            'bonuses': bonus_total,
        },
    }


# ---------------- Users (Admin/Accountant) ----------------
@api.get('/users')
async def list_users(_: dict = Depends(require_owner)):
    return await db.users.find({}, {'_id': 0, 'password_hash': 0}).sort('created_at', 1).to_list(200)


@api.post('/users')
async def create_user(body: UserCreateIn, user: dict = Depends(require_owner)):
    uname = body.username.strip().lower()
    if await db.users.find_one({'username': uname}):
        raise HTTPException(status_code=400, detail='Username already exists')
    uid = str(uuid.uuid4())
    doc = {
        'id': uid, 'username': uname, 'name': body.name.strip(), 'role': body.role,
        'password_hash': hash_secret(body.password), 'created_at': now_utc().isoformat(),
    }
    await db.users.insert_one(dict(doc))
    await log_audit(user, 'user.create', 'user', uid, uname, {'role': body.role})
    return {k: v for k, v in doc.items() if k not in ('_id', 'password_hash')}


@api.put('/users/{uid}')
async def update_user(uid: str, body: UserUpdateIn, user: dict = Depends(require_owner)):
    u = await db.users.find_one({'id': uid}, {'_id': 0})
    if not u: raise HTTPException(status_code=404, detail='User not found')
    if u.get('role') == 'owner': raise HTTPException(status_code=400, detail='Cannot modify the owner')
    upd: dict = {}
    if body.username:
        uname = body.username.strip().lower()
        if uname != u.get('username'):
            if await db.users.find_one({'username': uname, 'id': {'$ne': uid}}):
                raise HTTPException(status_code=400, detail='Username already exists')
            upd['username'] = uname
    if body.name: upd['name'] = body.name.strip()
    if body.password:
        if len(body.password) < 4: raise HTTPException(status_code=400, detail='Password must be 4+ characters')
        upd['password_hash'] = hash_secret(body.password)
    if body.role: upd['role'] = body.role
    if upd:
        await db.users.update_one({'id': uid}, {'$set': upd})
        await log_audit(user, 'user.update', 'user', uid, upd.get('username', u.get('username', '')), {k: v for k, v in upd.items() if k != 'password_hash'})
    return await db.users.find_one({'id': uid}, {'_id': 0, 'password_hash': 0})


@api.put('/auth/me')
async def update_my_account(body: SelfAccountUpdateIn, user=Depends(get_current)):
    """Self-service username/password change — requires the current password so a
    logged-in-but-unattended session can't be hijacked into a full account takeover.
    Works for owner/admin/accountant (db.users) and, since employees got their own
    username+password login, for employees too (db.employees)."""
    is_employee = user.get('role') == 'employee'
    coll = db.employees if is_employee else db.users
    full = await coll.find_one({'id': user['id']}, {'_id': 0})
    if not full: raise HTTPException(status_code=404, detail='User not found')
    if not verify_secret(body.current_password, full.get('password_hash', '')):
        raise HTTPException(status_code=401, detail='Current password is incorrect')
    upd: dict = {}
    if body.new_username:
        uname = body.new_username.strip().lower()
        if uname != full.get('username'):
            if await coll.find_one({'username': uname, 'id': {'$ne': user['id']}}):
                raise HTTPException(status_code=400, detail='Username already exists')
            upd['username'] = uname
    if body.new_password:
        if len(body.new_password) < 4: raise HTTPException(status_code=400, detail='Password must be 4+ characters')
        upd['password_hash'] = hash_secret(body.new_password)
    if not upd:
        raise HTTPException(status_code=400, detail='Nothing to update')
    upd['updated_at'] = now_utc().isoformat()
    await coll.update_one({'id': user['id']}, {'$set': upd})
    updated = await coll.find_one({'id': user['id']}, {'_id': 0, 'password_hash': 0})
    # Issue a fresh token since the username embedded in the old token may now be stale
    if is_employee:
        tok = create_token({'sub': updated['id'], 'role': 'employee', 'employee_code': updated.get('employee_code')})
        user_out = {
            'id': updated['id'], 'username': updated.get('username'), 'name': updated['name'], 'role': 'employee',
            'employee_code': updated.get('employee_code'), 'designation': updated.get('designation'),
            'department': updated.get('department'), 'photo': updated.get('photo', ''),
            'modules': resolve_modules({**updated, 'role': 'employee'}),
        }
    else:
        tok = create_token({'sub': updated['id'], 'role': updated.get('role', 'owner'), 'username': updated['username']})
        user_out = {**updated, 'modules': resolve_modules(updated)}
    await log_audit(user, 'account.self_update', 'user' if not is_employee else 'employee', user['id'], updated.get('name', ''))
    return {'access_token': tok, 'token_type': 'bearer', 'user': user_out}


@api.delete('/users/{uid}')
async def delete_user(uid: str, user=Depends(require_owner)):
    u = await db.users.find_one({'id': uid}, {'_id': 0})
    if not u: raise HTTPException(status_code=404, detail='User not found')
    if u.get('role') == 'owner': raise HTTPException(status_code=400, detail='Cannot delete the owner')
    await db.users.delete_one({'id': uid})
    await log_audit(user, 'user.delete', 'user', uid, u.get('username', ''))
    return {'ok': True}


# ---------------- User Roles / Module Access ----------------
@api.get('/access/modules')
async def list_modules(_: dict = Depends(require_owner)):
    return MODULE_DEFS


@api.get('/access/accounts')
async def list_access_accounts(_: dict = Depends(require_owner)):
    out = []
    async for u in db.users.find({}, {'_id': 0, 'password_hash': 0}):
        out.append({
            'id': u['id'], 'name': u['name'], 'username': u.get('username'), 'role': u.get('role'),
            'account_type': 'user', 'module_access': u.get('module_access'),
            'resolved_modules': resolve_modules(u),
        })
    async for e in db.employees.find({}, {'_id': 0, 'password_hash': 0}):
        out.append({
            'id': e['id'], 'name': e['name'], 'username': e.get('username'), 'role': 'employee',
            'account_type': 'employee', 'designation': e.get('designation'), 'status': e.get('status'),
            'module_access': e.get('module_access'),
            'resolved_modules': resolve_modules({'role': 'employee', 'module_access': e.get('module_access')}),
        })
    return out


@api.put('/access/accounts/{account_id}')
async def update_access(account_id: str, body: ModuleAccessUpdateIn, user=Depends(require_owner)):
    bad = set(body.module_access or []) - MODULE_KEYS
    if bad:
        raise HTTPException(status_code=400, detail=f'Unknown module(s): {", ".join(sorted(bad))}')
    u = await db.users.find_one({'id': account_id}, {'_id': 0})
    if u:
        if u.get('role') == 'owner':
            raise HTTPException(status_code=400, detail='Owner always has full access')
        await db.users.update_one({'id': account_id}, {'$set': {'module_access': body.module_access}})
        await log_audit(user, 'access.update', 'user', account_id, u.get('username', ''), {'module_access': body.module_access})
        return {'ok': True}
    e = await db.employees.find_one({'id': account_id}, {'_id': 0})
    if e:
        await db.employees.update_one({'id': account_id}, {'$set': {'module_access': body.module_access}})
        await log_audit(user, 'access.update', 'employee', account_id, e.get('name', ''), {'module_access': body.module_access})
        return {'ok': True}
    raise HTTPException(status_code=404, detail='Account not found')


# ---------------- Shifts ----------------
@api.get('/shifts')
async def list_shifts(_: dict = Depends(get_current)):
    return await db.shifts.find({}, {'_id': 0}).sort('start', 1).to_list(50)


@api.post('/shifts')
async def create_shift(body: ShiftIn, user: dict = Depends(require_owner)):
    doc = {'id': str(uuid.uuid4()), **body.model_dump(), 'created_at': now_utc().isoformat()}
    await db.shifts.insert_one(dict(doc))
    await log_audit(user, 'shift.create', 'shift', doc['id'], body.name)
    return {k: v for k, v in doc.items() if k != '_id'}


@api.put('/shifts/{sid}')
async def update_shift(sid: str, body: ShiftIn, user: dict = Depends(require_owner)):
    if not await db.shifts.find_one({'id': sid}):
        raise HTTPException(status_code=404, detail='Shift not found')
    await db.shifts.update_one({'id': sid}, {'$set': body.model_dump()})
    await log_audit(user, 'shift.update', 'shift', sid, body.name)
    return await db.shifts.find_one({'id': sid}, {'_id': 0})


@api.delete('/shifts/{sid}')
async def delete_shift(sid: str, user: dict = Depends(require_owner)):
    existing = await db.shifts.find_one({'id': sid}, {'_id': 0})
    r = await db.shifts.delete_one({'id': sid})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail='Shift not found')
    await log_audit(user, 'shift.delete', 'shift', sid, (existing or {}).get('name', ''))
    return {'ok': True}


# ---------------- Holidays ----------------
@api.get('/holidays')
async def list_holidays(_: dict = Depends(get_current)):
    return await db.holidays.find({}, {'_id': 0}).sort('date', 1).to_list(500)


@api.post('/holidays')
async def create_holiday(body: HolidayIn, user: dict = Depends(require_owner)):
    doc = {'id': str(uuid.uuid4()), **body.model_dump(), 'created_at': now_utc().isoformat()}
    await db.holidays.insert_one(dict(doc))
    await log_audit(user, 'holiday.create', 'holiday', doc['id'], body.name)
    return {k: v for k, v in doc.items() if k != '_id'}


@api.delete('/holidays/{hid}')
async def delete_holiday(hid: str, user: dict = Depends(require_owner)):
    existing = await db.holidays.find_one({'id': hid}, {'_id': 0})
    r = await db.holidays.delete_one({'id': hid})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail='Holiday not found')
    await log_audit(user, 'holiday.delete', 'holiday', hid, (existing or {}).get('name', ''))
    return {'ok': True}


# ---------------- Ledger ----------------
def _ledger_sign(entry_type: str) -> int:
    # Positive = employer pays / employee receives; Negative = deductions.
    return -1 if entry_type in ('advance', 'fine', 'deduction') else 1


@api.post('/ledger/entries')
async def add_ledger_entry(body: LedgerEntryIn, user=Depends(require_staff)):
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
    await log_audit(user, 'ledger.create', 'ledger', doc['id'], emp.get('employee_code', ''),
                     {'type': body.entry_type, 'amount': body.amount})
    return {k: v for k, v in doc.items() if k != '_id'}


@api.get('/ledger/{emp_id}')
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
        sign = e.get('sign', _ledger_sign(e.get('type', 'other')))
        # Only monetary events affect balance
        if e.get('type') in ('advance', 'bonus', 'fine', 'deduction', 'salary'):
            delta = sign * abs(amount) if e.get('type') != 'salary' else amount
            running += delta
            entries.append({**e, 'delta': delta, 'balance': round(running, 2)})
        else:
            entries.append({**e, 'delta': 0, 'balance': round(running, 2)})
    # Newest first for display
    entries.sort(key=lambda x: x.get('created_at') or '', reverse=True)
    return {'entries': entries, 'closing_balance': round(running, 2)}


@api.get('/ledger/{emp_id}/month/{year}/{month}')
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


@api.put('/ledger/entries/{entry_id}')
async def edit_ledger_entry(entry_id: str, body: LedgerEntryEdit, user=Depends(require_admin)):
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
    await log_audit(user, 'ledger.edit', 'ledger', entry_id,
                     f"{existing.get('employee_id')} · {update['title']} · {update['amount']}", {})
    return {**existing, **update}


@api.delete('/ledger/entries/{entry_id}')
async def delete_ledger_entry(entry_id: str, user=Depends(require_admin)):
    existing = await db.timeline.find_one({'id': entry_id}, {'_id': 0})
    if not existing:
        raise HTTPException(status_code=404, detail='Ledger entry not found')
    if existing.get('type') not in _LEDGER_EDITABLE_TYPES:
        raise HTTPException(status_code=400, detail='This entry cannot be deleted')
    await db.timeline.delete_one({'id': entry_id})
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


async def _compute_payroll(year: int, month: int) -> list:
    start, end, total_days = _month_bounds(year, month)
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    round_nearest_10 = bool(store.get('round_net_salary'))
    # Attendance in month
    att_by_emp: dict = {}
    async for a in db.attendance.find({'date': {'$gte': start, '$lte': end}}, {'_id': 0, 'check_in.selfie': 0, 'check_out.selfie': 0}):
        att_by_emp.setdefault(a['employee_id'], []).append(a)
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
    # Ledger entries in month (advance/bonus/fine/deduction)
    ledger_by_emp: dict = {}
    async for t in db.timeline.find(
        {'type': {'$in': ['advance', 'bonus', 'fine', 'deduction']}, 'created_at': {'$gte': start, '$lte': f'{end}T23:59:59'}},
        {'_id': 0},
    ):
        ledger_by_emp.setdefault(t['employee_id'], []).append(t)

    rows = []
    async for e in db.employees.find({}, {'_id': 0, 'password_hash': 0}):
        atts = att_by_emp.get(e['id'], [])
        present = sum(1 for a in atts if a.get('status') == 'present')
        half = sum(1 for a in atts if a.get('status') == 'half_day')
        manual_off = sum(1 for a in atts if a.get('status') == 'weekly_off')
        # Sunday work
        sunday_work = 0
        for a in atts:
            if a.get('check_in') and a.get('date'):
                try:
                    d = date.fromisoformat(a['date'])
                    if d.weekday() == 6: sunday_work += 1
                except Exception: pass

        # Approved leaves count of days in month
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

        # Paid days off with no attendance record: store holidays and the weekly Sunday
        # off are paid automatically, same as an approved leave, so staff aren't marked
        # absent for days the store itself is closed / not scheduled to work.
        att_dates = {a['date'] for a in atts}
        holiday_days = 0
        weekly_off_auto = 0
        for ds in all_month_dates:
            if ds in att_dates or ds in leave_dates:
                continue
            if ds in holidays:
                holiday_days += 1
            else:
                try:
                    if date.fromisoformat(ds).weekday() == 6:
                        weekly_off_auto += 1
                except Exception:
                    pass
        weekly_off_days = weekly_off_auto + manual_off

        base = float(e.get('salary') or 0)
        per_day = base / total_days if total_days > 0 else 0
        # Effective days paid: present + 0.5*half + paid leaves/holidays/weekly-offs.
        # A normal (shop-closed) Sunday is still a paid weekly-off, same as before — full
        # monthly salary isn't reduced just because the shop doesn't open on a Sunday.
        # If an employee actually clocks in on a Sunday (shop opened that day), they get
        # a half-day bonus on top of their normal pay for that day — not a full extra day.
        effective = present + 0.5 * half + leave_days + holiday_days + weekly_off_days
        earned = round(per_day * min(effective, total_days) + per_day * 0.5 * sunday_work, 2)

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
            'designation': e.get('designation'), 'department': e.get('department'),
            'base_salary': base, 'present_days': present, 'half_days': half,
            'sunday_work': sunday_work, 'leave_days': leave_days,
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


@api.post('/payroll/compute')
async def payroll_compute(body: PayrollGenerateIn, _: dict = Depends(require_payroll_writer)):
    rows = await _compute_payroll(body.year, body.month)
    lock = await db.payroll_locks.find_one({'year': body.year, 'month': body.month}, {'_id': 0})
    return {
        'year': body.year, 'month': body.month, 'rows': rows,
        'total_net': round(sum(r['net_salary'] for r in rows), 2),
        'locked': bool(lock and lock.get('locked')),
        'generated_at': lock.get('generated_at') if lock else None,
    }


@api.post('/payroll/save')
async def payroll_save(body: PayrollGenerateIn, user=Depends(require_payroll_writer)):
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
        # Preserve any manual adjustments the owner/accountant already made on this
        # (unpaid) entry; only the attendance-derived figures get refreshed.
        bonus = prior.get('bonus', r['bonus']) if prior else r['bonus']
        fine = prior.get('fine', r['fine']) if prior else r['fine']
        manual_deduction = prior.get('manual_deduction', r['manual_deduction']) if prior else r['manual_deduction']
        note = prior.get('note', '') if prior else ''
        payment_mode = prior.get('payment_mode') if prior else None
        net_exact = round(r['earned'] + bonus - r['advance'] - fine - manual_deduction + r['opening_balance'], 2)
        net_salary = round(net_exact / 10) * 10 if round_nearest_10 else net_exact
        doc = {
            'id': entry_id, 'year': body.year, 'month': body.month, **r,
            'bonus': bonus, 'fine': fine, 'manual_deduction': manual_deduction,
            'net_salary_exact': net_exact, 'net_salary': net_salary, 'note': note, 'payment_mode': payment_mode,
            'paid': False, 'generated_at': iso, 'generated_by': user['name'],
        }
        await db.payroll_entries.update_one({'id': entry_id}, {'$set': doc}, upsert=True)
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


@api.get('/payroll/{year}/{month}')
async def payroll_get(year: int, month: int, _: dict = Depends(require_staff)):
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


@api.post('/payroll/{year}/{month}/lock')
async def payroll_lock(year: int, month: int, user=Depends(require_payroll_writer)):
    lock = await db.payroll_locks.find_one({'year': year, 'month': month}, {'_id': 0})
    if not lock: raise HTTPException(status_code=400, detail='Save payroll before locking')
    await db.payroll_locks.update_one(
        {'year': year, 'month': month},
        {'$set': {'locked': True, 'locked_by': user['name'], 'locked_at': now_utc().isoformat()}},
    )
    await log_audit(user, 'payroll.lock', 'payroll', f'{year}-{month:02d}')
    return {'ok': True}


@api.post('/payroll/{year}/{month}/unlock')
async def payroll_unlock(year: int, month: int, user=Depends(require_owner)):
    await db.payroll_locks.update_one({'year': year, 'month': month},
                                       {'$set': {'locked': False}})
    await log_audit(user, 'payroll.unlock', 'payroll', f'{year}-{month:02d}')
    return {'ok': True}


@api.put('/payroll/entry/{entry_id}')
async def payroll_entry_update(entry_id: str, body: PayrollEntryUpdateIn, user=Depends(require_payroll_writer)):
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


@api.get('/payroll/entry/{entry_id}/payments')
async def list_payroll_payments(entry_id: str, _: dict = Depends(require_staff)):
    return await db.payroll_payments.find({'entry_id': entry_id}, {'_id': 0}).sort('paid_at', 1).to_list(50)


@api.post('/payroll/entry/{entry_id}/payments')
async def add_payroll_payment(entry_id: str, body: PayrollPaymentIn, user=Depends(require_payroll_writer)):
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
        await db.timeline.insert_one({
            'id': str(uuid.uuid4()), 'employee_id': entry['employee_id'], 'type': 'salary',
            'title': f"Salary {entry['year']}-{entry['month']:02d}",
            'description': f"Net paid ₹{net:.0f}", 'amount': net, 'sign': 1, 'created_at': iso,
        })
        await notify_user(entry['employee_id'], 'Salary paid',
                           f"Your salary for {entry['year']}-{entry['month']:02d} (₹{net:.0f}) has been paid", '/profile')
    await log_audit(user, 'payroll.payment.add', 'payroll_entry', entry_id, entry.get('employee_code', ''),
                     {'mode': body.payment_mode, 'amount': body.amount, 'fully_paid': fully_paid})
    return {'ok': True, 'fully_paid': fully_paid, 'amount_paid': new_total, 'remaining': round(net - new_total, 2)}


@api.delete('/payroll/entry/{entry_id}/payments/{payment_id}')
async def delete_payroll_payment(entry_id: str, payment_id: str, user=Depends(require_payroll_writer)):
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
    modes_used = {x['payment_mode'] for x in remaining}
    upd = {'amount_paid': total, 'paid': fully_paid, 'payment_mode': _payroll_modes_label(modes_used)}
    if not fully_paid:
        upd['paid_at'] = None
        upd['paid_by'] = None
    await db.payroll_entries.update_one({'id': entry_id}, {'$set': upd})
    await log_audit(user, 'payroll.payment.delete', 'payroll_entry', entry_id, (entry or {}).get('employee_code', ''),
                     {'mode': p['payment_mode'], 'amount': p['amount']})
    return {'ok': True, 'fully_paid': fully_paid, 'amount_paid': total, 'remaining': round(net - total, 2)}


@api.get('/payroll/entry/{entry_id}/pdf')
async def payroll_pdf(entry_id: str, _: dict = Depends(require_staff)):
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
    val_style = ParagraphStyle('v', parent=styles['Normal'], fontSize=11, textColor=dark)

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


# ---------------- Audit ----------------
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


@api.get('/audit/logs')
async def audit_list(
    actor: Optional[str] = None, entity_type: Optional[str] = None,
    from_date: Optional[str] = None, to_date: Optional[str] = None,
    limit: int = 200, _: dict = Depends(require_owner),
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


async def notify_user(user_id: str, title: str, body: str, url: str = '/'):
    try:
        subs = await db.push_subscriptions.find({'user_id': user_id}, {'_id': 0}).to_list(20)
        await _send_push_to_subs(subs, title, body, url)
    except Exception as e:
        logger.warning(f'notify_user failed: {e}')


async def notify_roles(roles: list, title: str, body: str, url: str = '/'):
    try:
        subs = await db.push_subscriptions.find({'role': {'$in': roles}}, {'_id': 0}).to_list(200)
        await _send_push_to_subs(subs, title, body, url)
    except Exception as e:
        logger.warning(f'notify_roles failed: {e}')


async def _check_missed_attendance():
    now_ist = now_utc().astimezone(timezone(timedelta(hours=5, minutes=30)))
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
        if minutes_now < _minutes(start) + 60:
            continue  # not yet an hour past their shift start

        if await db.attendance_reminders.find_one({'employee_id': emp['id'], 'date': today}, {'_id': 0, 'id': 1}):
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


async def _check_daily_absentee_summary():
    """Once per day, at/after 9:00 PM IST, push the owner/admin a summary of who
    never checked in today (no check-in, and not on approved leave/holiday/paid
    off). Guarded by `db.absentee_summaries` so it only fires once even though
    the loop polls every 15 minutes."""
    now_ist = now_utc().astimezone(timezone(timedelta(hours=5, minutes=30)))
    today = now_ist.date().isoformat()
    minutes_now = now_ist.hour * 60 + now_ist.minute
    if minutes_now < 21 * 60:
        return  # only fire at/after 9:00 PM IST
    if now_ist.weekday() == 6:
        return  # Sunday — normally a day off
    if await db.holidays.find_one({'date': today}, {'_id': 0, 'id': 1}):
        return
    if await db.absentee_summaries.find_one({'date': today}, {'_id': 0, 'id': 1}):
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
        await notify_roles(
            ['owner', 'admin'],
            f"{len(absent_names)} absent today",
            shown, '/(tabs)/attendance',
        )


async def _check_auto_advances():
    """Fires each employee's recurring monthly advance on their configured day.
    Idempotent via `db.auto_advances` (keyed by employee + year-month) so the
    15-minute poll can safely re-check without double-crediting. A day beyond
    the current month's length (e.g. 31 in February) clamps to the last day."""
    from calendar import monthrange
    now_ist = now_utc().astimezone(timezone(timedelta(hours=5, minutes=30)))
    today = now_ist.date()
    ym = f'{today.year:04d}-{today.month:02d}'
    last_day = monthrange(today.year, today.month)[1]

    async for emp in db.employees.find(
        {'status': 'active', 'auto_advance_amount': {'$gt': 0}, 'auto_advance_day': {'$ne': None}},
        {'_id': 0, 'password_hash': 0},
    ):
        day = int(emp.get('auto_advance_day') or 0)
        if day <= 0:
            continue
        if today.day != min(day, last_day):
            continue
        if await db.auto_advances.find_one({'employee_id': emp['id'], 'month': ym}, {'_id': 0, 'id': 1}):
            continue  # already fired this month

        amount = float(emp['auto_advance_amount'])
        iso = now_utc().isoformat()
        await db.timeline.insert_one({
            'id': str(uuid.uuid4()), 'employee_id': emp['id'], 'type': 'advance',
            'title': 'Auto Advance', 'description': f'Automatic monthly advance ({ym})',
            'amount': amount, 'sign': _ledger_sign('advance'), 'created_at': iso,
        })
        await db.auto_advances.update_one(
            {'employee_id': emp['id'], 'month': ym},
            {'$set': {'employee_id': emp['id'], 'month': ym, 'amount': amount, 'created_at': iso}},
            upsert=True,
        )
        await notify_user(emp['id'], 'Advance credited',
                           f"₹{amount:.0f} advance has been recorded for you this month.", '/')
        await notify_roles(['owner', 'admin'], 'Auto advance recorded',
                            f"₹{amount:.0f} auto-advance recorded for {emp['name']}", '/(tabs)/payroll')


async def _check_recurring_tasks():
    """Once per day, spawns today's (or this week's) task instance from each
    active recurring template. Idempotent via `db.task_generations` (keyed by
    template + date) so the 15-minute poll can safely re-check. A missed or
    completed instance never blocks the next one — each day/week is its own
    independent task, not a chain."""
    now_ist = now_utc().astimezone(timezone(timedelta(hours=5, minutes=30)))
    today = now_ist.date()
    today_iso = today.isoformat()

    async for tpl in db.task_templates.find({'active': True}, {'_id': 0}):
        if tpl['freq'] == 'weekly' and tpl.get('weekday') is not None and today.weekday() != int(tpl['weekday']):
            continue
        if await db.task_generations.find_one({'template_id': tpl['id'], 'date': today_iso}, {'_id': 0, 'id': 1}):
            continue  # already generated for this day

        emp = await db.employees.find_one({'id': tpl['assigned_to'], 'status': 'active'}, {'_id': 0})
        await db.task_generations.update_one(
            {'template_id': tpl['id'], 'date': today_iso},
            {'$set': {'template_id': tpl['id'], 'date': today_iso, 'created_at': now_utc().isoformat()}},
            upsert=True,
        )
        if not emp:
            continue  # employee inactive/removed — mark generated, but skip creating a task for them
        iso = now_utc().isoformat()
        task_id = str(uuid.uuid4())
        await db.tasks.insert_one({
            'id': task_id, 'title': tpl['title'], 'description': tpl.get('description', ''),
            'assigned_to': tpl['assigned_to'], 'assigned_to_name': emp['name'], 'assigned_by': 'Recurring',
            'priority': tpl.get('priority', 'normal'), 'due_date': today_iso, 'status': 'open',
            'comments': [], 'recurring_template_id': tpl['id'], 'overdue_notified_at': None,
            'created_at': iso, 'completed_at': None,
        })
        await notify_user(tpl['assigned_to'], 'New task assigned', tpl['title'], '/(emp)/tasks')


async def _check_overdue_tasks():
    """Pushes owner/admin once per task that's past its due date and still
    open — guarded by `overdue_notified_at` so it fires exactly once, not
    every 15-minute poll cycle."""
    today_iso = now_utc().astimezone(timezone(timedelta(hours=5, minutes=30))).date().isoformat()
    async for t in db.tasks.find(
        {'status': 'open', 'due_date': {'$ne': None, '$lt': today_iso}, 'overdue_notified_at': None},
        {'_id': 0},
    ):
        await db.tasks.update_one({'id': t['id']}, {'$set': {'overdue_notified_at': now_utc().isoformat()}})
        await notify_roles(['owner', 'admin'], 'Task overdue',
                            f"{t.get('assigned_to_name', 'Someone')}: {t['title']} was due {t['due_date']}", '/tasks')


async def _attendance_reminder_loop():
    while True:
        try:
            await asyncio.sleep(15 * 60)
            await _check_missed_attendance()
            await _check_daily_absentee_summary()
            await _check_auto_advances()
            await _check_recurring_tasks()
            await _check_overdue_tasks()
        except Exception as e:
            logger.warning(f'attendance reminder loop error: {e}')


@api.get('/notifications/vapid-public-key')
async def notifications_vapid_key():
    return {'publicKey': VAPID_PUBLIC_KEY, 'enabled': bool(WEBPUSH_AVAILABLE and VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)}


@api.post('/notifications/subscribe')
async def notifications_subscribe(body: PushSubscriptionIn, user=Depends(get_current)):
    existing = await db.push_subscriptions.find_one({'endpoint': body.endpoint}, {'_id': 0})
    doc = {
        'id': existing['id'] if existing else str(uuid.uuid4()),
        'user_id': user['id'], 'role': user.get('role'), 'endpoint': body.endpoint,
        'keys': body.keys, 'created_at': now_utc().isoformat(),
    }
    await db.push_subscriptions.update_one({'endpoint': body.endpoint}, {'$set': doc}, upsert=True)
    return {'ok': True}


@api.post('/notifications/unsubscribe')
async def notifications_unsubscribe(body: dict, user=Depends(get_current)):
    endpoint = body.get('endpoint')
    if endpoint:
        await db.push_subscriptions.delete_one({'endpoint': endpoint, 'user_id': user['id']})
    return {'ok': True}


@api.get('/notifications/status')
async def notifications_status(user=Depends(get_current)):
    count = await db.push_subscriptions.count_documents({'user_id': user['id']})
    return {'subscribed': count > 0}


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


@api.get('/reports/{kind}/pdf')
async def report_pdf(
    kind: str,
    from_date: Optional[str] = None, to_date: Optional[str] = None,
    year: Optional[int] = None, month: Optional[int] = None,
    employee_id: Optional[str] = None,
    user=Depends(require_staff),
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

    raise HTTPException(status_code=400, detail=f'Unknown report kind: {kind}')


# ---------------- Biometric (eSSL Cloud Push) ----------------
class DeviceIn(BaseModel):
    serial: str
    label: str
    secret: str


class BiometricPushIn(BaseModel):
    serial: str
    secret: str
    user_id: str  # employee_code (as configured in eSSL device)
    timestamp: Optional[str] = None  # ISO; defaults to now
    event_type: Optional[Literal['check_in', 'check_out', 'auto']] = 'auto'
    verify_mode: Optional[str] = ''  # 'face', 'fingerprint', etc.


@api.get('/biometric/devices')
async def list_devices(_: dict = Depends(require_staff)):
    docs = await db.biometric_devices.find({}, {'_id': 0, 'secret': 0}).sort('created_at', 1).to_list(100)
    return docs


@api.post('/biometric/devices')
async def create_device(body: DeviceIn, user=Depends(require_owner)):
    if await db.biometric_devices.find_one({'serial': body.serial}):
        raise HTTPException(status_code=400, detail='Device serial already registered')
    doc = {
        'id': str(uuid.uuid4()), 'serial': body.serial.strip(), 'label': body.label.strip(),
        'secret': body.secret, 'created_at': now_utc().isoformat(),
        'last_seen': None, 'status': 'idle',
    }
    await db.biometric_devices.insert_one(dict(doc))
    await log_audit(user, 'biometric.device.create', 'device', doc['id'], body.serial)
    return {k: v for k, v in doc.items() if k not in ('_id', 'secret')}


@api.delete('/biometric/devices/{did}')
async def delete_device(did: str, user=Depends(require_owner)):
    d = await db.biometric_devices.find_one({'id': did}, {'_id': 0})
    if not d: raise HTTPException(status_code=404, detail='Device not found')
    await db.biometric_devices.delete_one({'id': did})
    await log_audit(user, 'biometric.device.delete', 'device', did, d.get('serial', ''))
    return {'ok': True}


@api.get('/biometric/logs')
async def biometric_logs(limit: int = 100, _: dict = Depends(require_staff)):
    return await db.biometric_logs.find({}, {'_id': 0}).sort('created_at', -1).limit(limit).to_list(limit)


async def _ingest_biometric_punch(serial: str, user_id: str, ts: datetime, event_type: str = 'auto', verify_mode: str = '') -> dict:
    """Shared logic: turn one (serial, user_id, timestamp) punch into an attendance
    check-in/check-out, however it arrived (custom JSON push or real ADMS/iClock
    upload). Returns a dict describing what happened; also writes a biometric_logs row."""
    log_doc = {
        'id': str(uuid.uuid4()), 'serial': serial, 'user_id': user_id,
        'timestamp': ts.isoformat(), 'event_type': event_type or 'auto',
        'verify_mode': verify_mode or '', 'created_at': now_utc().isoformat(),
    }

    # Match by biometric_id first (the device's own numeric/short ID, set per-employee
    # in the app when it doesn't line up with employee_code), then fall back to
    # employee_code directly (for setups where they were deliberately enrolled to match).
    emp = await db.employees.find_one({'biometric_id': user_id}, {'_id': 0, 'password_hash': 0})
    if not emp:
        emp = await db.employees.find_one({'employee_code': user_id.upper()}, {'_id': 0, 'password_hash': 0})
    if not emp:
        log_doc['result'] = 'rejected'; log_doc['reason'] = 'unknown_employee'
        await db.biometric_logs.insert_one(dict(log_doc))
        return {'ok': False, 'reason': 'unknown_employee', 'user_id': user_id}

    ist = ts.astimezone(timezone(timedelta(hours=5, minutes=30)))
    d = ist.date().isoformat()

    existing = await db.attendance.find_one({'employee_id': emp['id'], 'date': d}, {'_id': 0})
    kind = event_type
    if kind == 'auto':
        kind = 'check_out' if (existing and existing.get('check_in') and not existing.get('check_out')) else 'check_in'

    iso = ts.astimezone(timezone.utc).isoformat()
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    # Use the employee's assigned shift (falling back to store defaults) — same
    # source of truth the app's own check-in/check-out endpoints use — so a
    # biometric-device punch and an app punch produce identical late/half-day
    # results instead of the device path silently ignoring Shift Master.
    shift = await db.shifts.find_one({'name': emp.get('shift')}, {'_id': 0})
    work_start_str = (shift.get('start') if shift else None) or store.get('work_start', '10:00')
    grace = int(shift.get('grace_min', 15)) if shift else int(store.get('grace_min', 15))
    late_half_day_after = int(shift.get('late_half_day_after_min') or 0) if shift else 0
    is_late = False
    if kind == 'check_in':
        late_by_min = 0
        try:
            wsh, wsm = work_start_str.split(':')
            work_start_min = int(wsh) * 60 + int(wsm)
            minutes_now = ist.hour * 60 + ist.minute
            late_by_min = minutes_now - (work_start_min + grace)
            is_late = late_by_min > 0
        except Exception: is_late = False
        payload = {
            'timestamp': iso, 'latitude': 0, 'longitude': 0, 'selfie': '',
            'distance_m': 0, 'is_late': is_late, 'late_by_min': max(late_by_min, 0),
            'source': 'biometric', 'device_serial': serial,
        }
        if existing and existing.get('check_in'):
            log_doc['result'] = 'skipped'; log_doc['reason'] = 'already_checked_in'
            await db.biometric_logs.insert_one(dict(log_doc))
            return {'ok': True, 'skipped': True, 'reason': 'already_checked_in'}
        if existing:
            await db.attendance.update_one({'id': existing['id']}, {'$set': {'check_in': payload, 'is_late': is_late, 'status': 'present'}})
            att_id = existing['id']
        else:
            att_id = str(uuid.uuid4())
            await db.attendance.insert_one({
                'id': att_id, 'employee_id': emp['id'], 'date': d,
                'check_in': payload, 'check_out': None, 'is_late': is_late, 'working_hours': 0,
                'status': 'present', 'created_at': iso, 'source': 'biometric',
            })
    else:  # check_out
        if not existing or not existing.get('check_in'):
            log_doc['result'] = 'rejected'; log_doc['reason'] = 'no_check_in'
            await db.biometric_logs.insert_one(dict(log_doc))
            return {'ok': False, 'reason': 'no_check_in', 'user_id': user_id}
        if existing.get('check_out'):
            log_doc['result'] = 'skipped'; log_doc['reason'] = 'already_checked_out'
            await db.biometric_logs.insert_one(dict(log_doc))
            return {'ok': True, 'skipped': True, 'reason': 'already_checked_out'}
        try:
            ci_ts = datetime.fromisoformat(existing['check_in']['timestamp'])
            hours = round((ts - ci_ts).total_seconds() / 3600, 2)
        except Exception:
            hours = 0
        late_by_min = int(existing['check_in'].get('late_by_min') or 0)
        half_day_for_lateness = bool(late_half_day_after) and late_by_min >= late_half_day_after
        status = 'half_day' if (hours < 4 or half_day_for_lateness) else 'present'
        half_day_reason = None
        if status == 'half_day':
            half_day_reason = 'short_hours' if hours < 4 else 'late'
        payload = {'timestamp': iso, 'latitude': 0, 'longitude': 0, 'selfie': '',
                   'distance_m': 0, 'source': 'biometric', 'device_serial': serial}
        await db.attendance.update_one(
            {'id': existing['id']},
            {'$set': {'check_out': payload, 'working_hours': hours, 'status': status, 'half_day_reason': half_day_reason}},
        )
        att_id = existing['id']

    # Update device last_seen
    await db.biometric_devices.update_one({'serial': serial},
                                          {'$set': {'last_seen': iso, 'status': 'online'}})
    # Attendance event feed
    await db.attendance_events.insert_one({
        'id': str(uuid.uuid4()), 'employee_id': emp['id'], 'employee_name': emp['name'],
        'type': kind, 'timestamp': iso, 'is_late': is_late if kind == 'check_in' else False,
        'created_at': iso, 'source': 'biometric', 'device_serial': serial,
    })
    log_doc['result'] = 'accepted'; log_doc['action'] = kind; log_doc['attendance_id'] = att_id
    log_doc['employee_id'] = emp['id']; log_doc['employee_name'] = emp['name']
    await db.biometric_logs.insert_one(dict(log_doc))
    return {'ok': True, 'action': kind, 'employee': emp['name'], 'attendance_id': att_id}


@api.post('/biometric/push')
async def biometric_push(body: BiometricPushIn):
    # Called by a bridge script (e.g. biometric_bridge.py) — no bearer JWT;
    # validated via device serial + secret since it's not an ADMS-capable flow.
    device = await db.biometric_devices.find_one({'serial': body.serial}, {'_id': 0})
    if not device or device.get('secret') != body.secret:
        await db.biometric_logs.insert_one({
            'id': str(uuid.uuid4()), 'serial': body.serial, 'user_id': body.user_id,
            'timestamp': body.timestamp or now_utc().isoformat(), 'event_type': body.event_type or 'auto',
            'verify_mode': body.verify_mode or '', 'created_at': now_utc().isoformat(),
            'result': 'rejected', 'reason': 'invalid_device_credentials',
        })
        raise HTTPException(status_code=401, detail='Invalid device credentials')

    try:
        ts = datetime.fromisoformat(body.timestamp) if body.timestamp else now_utc()
    except Exception:
        ts = now_utc()
    result = await _ingest_biometric_punch(body.serial, body.user_id, ts, body.event_type or 'auto', body.verify_mode or '')
    if not result['ok'] and result.get('reason') == 'unknown_employee':
        raise HTTPException(status_code=404, detail=f'Unknown employee {body.user_id}')
    if not result['ok'] and result.get('reason') == 'no_check_in':
        raise HTTPException(status_code=400, detail='No check-in yet today')
    return result


# ---------------- Biometric (real eSSL/ZKTeco ADMS / iClock push protocol) ----------------
# This is the protocol the device itself speaks natively when you set
# Comm > Cloud Server Settings > Server Address/Port to point at this backend
# (Server Mode stays "ADMS" — that field usually can't be changed, and doesn't
# need to be). These routes are intentionally at the app root (not under /api)
# because the device hard-codes the /iclock/... paths — they're not configurable.
# No shared secret is used here (the protocol has no field for one); trust is
# "the device is on your LAN and its serial is registered" — same as any other
# local network appliance.

@app.get('/iclock/cdata')
async def iclock_handshake(SN: str = Query(...)):
    """Device 'hello' on boot / periodic re-handshake. Tells it how often to
    push and what tables we want. A plain 200 with this shape is enough for
    it to start sending ATTLOG data."""
    await db.biometric_devices.update_one(
        {'serial': SN}, {'$set': {'last_seen': now_utc().isoformat(), 'status': 'online'}}
    )
    body = (
        "GET OPTION FROM: {sn}\r\n"
        "Stamp=9999\r\n"
        "OpStamp=9999\r\n"
        "ErrorDelay=30\r\n"
        "Delay=10\r\n"
        "TransFlag=TransData AttLog\r\n"
        "TransInterval=1\r\n"
        "Realtime=1\r\n"
        "Encrypt=None\r\n"
    ).format(sn=SN)
    return PlainTextResponse(body)


@app.post('/iclock/cdata')
async def iclock_upload(request: Request, SN: str = Query(...), table: str = Query('ATTLOG')):
    """Device pushes punch data here. Body is plain text, one record per line,
    tab-separated: PIN<TAB>Time<TAB>Status<TAB>Verify<TAB>WorkCode..."""
    device = await db.biometric_devices.find_one({'serial': SN}, {'_id': 0})
    raw = (await request.body()).decode('utf-8', errors='ignore')
    if not device:
        # Log it anyway so it shows up in Settings > Biometric > Logs — makes it
        # obvious the device is reachable but just isn't registered yet.
        await db.biometric_logs.insert_one({
            'id': str(uuid.uuid4()), 'serial': SN, 'user_id': '', 'timestamp': now_utc().isoformat(),
            'event_type': 'auto', 'verify_mode': '', 'created_at': now_utc().isoformat(),
            'result': 'rejected', 'reason': 'unregistered_device',
        })
        return PlainTextResponse('OK')  # ack anyway — device will just keep retrying otherwise

    n = 0
    if table.upper() == 'ATTLOG':
        for line in raw.splitlines():
            parts = line.strip().split('\t')
            if len(parts) < 2:
                continue
            pin, time_str = parts[0].strip(), parts[1].strip()
            if not pin or not time_str:
                continue
            try:
                ts = datetime.strptime(time_str, '%Y-%m-%d %H:%M:%S').replace(
                    tzinfo=timezone(timedelta(hours=5, minutes=30))
                )
            except Exception:
                continue
            await _ingest_biometric_punch(SN, pin, ts, 'auto')
            n += 1
    return PlainTextResponse(f'OK: {n}')


@app.get('/iclock/getrequest')
async def iclock_getrequest(SN: str = Query(...)):
    """Device polls this periodically asking 'any commands for me?'. We never
    queue commands, so always say no."""
    return PlainTextResponse('OK')


@app.post('/iclock/devicecmd')
async def iclock_devicecmd(request: Request):
    """Device posts the result of a command we supposedly sent. We don't send
    any, but must still 200 or the device logs errors."""
    await request.body()
    return PlainTextResponse('OK')


# ---------------- AI Assistant (Gemini 3 Flash) ----------------
class AssistantAskIn(BaseModel):
    question: str


async def _build_context() -> str:
    """Compact snapshot for the assistant prompt (read-only)."""
    d = today_str()
    lines: list = []
    employees = await db.employees.find({}, {'_id': 0, 'password_hash': 0, 'photo': 0}).to_list(500)
    lines.append(f"TODAY: {d}")
    lines.append(f"TOTAL EMPLOYEES: {len(employees)}")
    lines.append("EMPLOYEES:")
    for e in employees:
        lines.append(f"- {e.get('employee_code')} · {e.get('name')} · {e.get('designation') or '—'} · {e.get('department') or '—'} · ₹{e.get('salary', 0):.0f} · status={e.get('status')}")
    # Today's attendance
    lines.append("\nTODAY ATTENDANCE:")
    att_map = {}
    async for a in db.attendance.find({'date': d}, {'_id': 0, 'check_in.selfie': 0, 'check_out.selfie': 0}):
        att_map[a['employee_id']] = a
    for e in employees:
        a = att_map.get(e['id'])
        if a:
            ci = (a.get('check_in') or {}).get('timestamp', '')
            co = (a.get('check_out') or {}).get('timestamp', '')
            lines.append(f"- {e['employee_code']} · {e['name']}: status={a.get('status')} in={ci or '—'} out={co or '—'} late={a.get('is_late', False)} hours={a.get('working_hours', 0)}")
        else:
            lines.append(f"- {e['employee_code']} · {e['name']}: no punch today")
    # Pending items
    p_corr = await db.corrections.count_documents({'status': 'pending'})
    p_leaves = await db.leaves.count_documents({'status': 'pending'})
    lines.append(f"\nPENDING: corrections={p_corr}, leave_requests={p_leaves}")
    # Ledger balances
    lines.append("\nLEDGER (closing balances):")
    for e in employees:
        bal = await _opening_balance(e['id'], (now_utc() + timedelta(days=1)).isoformat())
        lines.append(f"- {e['employee_code']} · {e['name']}: ₹{bal:.0f}")
    return "\n".join(lines)


SYSTEM_PROMPT = (
    "You are RMJ AI, the built-in assistant for RMJ One, an employee management app "
    "for a jewellery business. You have read-only access to a snapshot of today's data. "
    "Answer questions concisely and factually using ONLY the snapshot below. "
    "If the answer isn't in the snapshot, say you don't have that data. "
    "Use INR (₹) for money. Format lists with bullets when helpful. "
    "Never invent employees, numbers, or actions. Never suggest destructive actions."
)


@api.post('/assistant/ask')
async def assistant_ask(body: AssistantAskIn, user=Depends(require_staff)):
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as ex:
        raise HTTPException(status_code=500, detail=f'AI library unavailable: {ex}')
    key = os.environ.get('EMERGENT_LLM_KEY')
    if not key:
        raise HTTPException(status_code=500, detail='EMERGENT_LLM_KEY not configured')
    context = await _build_context()
    session_id = f"assistant-{user['id']}-{uuid.uuid4()}"
    chat = LlmChat(
        api_key=key, session_id=session_id,
        system_message=f"{SYSTEM_PROMPT}\n\nDATA SNAPSHOT:\n{context}",
    ).with_model("gemini", "gemini-3-flash-preview")
    try:
        resp = await chat.send_message(UserMessage(text=body.question))
        text = resp if isinstance(resp, str) else str(resp)
    except Exception as ex:
        raise HTTPException(status_code=502, detail=f'AI service error: {ex}')
    # Store transcript
    await db.assistant_history.insert_one({
        'id': str(uuid.uuid4()), 'user_id': user['id'], 'user_name': user.get('name', ''),
        'question': body.question, 'answer': text, 'created_at': now_utc().isoformat(),
    })
    return {'answer': text}


@api.get('/assistant/history')
async def assistant_history(user=Depends(require_staff), limit: int = 50):
    return await db.assistant_history.find(
        {'user_id': user['id']}, {'_id': 0}
    ).sort('created_at', -1).limit(limit).to_list(limit)


# ---------------- Mount ----------------
app.include_router(api)
app.add_middleware(
    CORSMiddleware, allow_credentials=True, allow_origins=['*'],
    allow_methods=['*'], allow_headers=['*'],
)
