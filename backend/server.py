from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, Query
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
    if role == 'owner':
        u = await db.users.find_one({'id': payload.get('sub')}, {'_id': 0, 'password_hash': 0})
    else:
        u = await db.employees.find_one({'id': payload.get('sub')}, {'_id': 0, 'pin_hash': 0})
    if not u:
        raise HTTPException(status_code=401, detail='User not found')
    u['role'] = role
    return u


def require_owner(user=Depends(get_current)):
    if user.get('role') != 'owner':
        raise HTTPException(status_code=403, detail='Owner access required')
    return user


def require_employee(user=Depends(get_current)):
    if user.get('role') != 'employee':
        raise HTTPException(status_code=403, detail='Employee access required')
    return user


# ---------------- Models ----------------
class LoginIn(BaseModel):
    username: str
    password: str


class EmployeeLoginIn(BaseModel):
    employee_code: str
    pin: str


class SetPinIn(BaseModel):
    pin: str  # 4-digit


class EmployeeIn(BaseModel):
    name: str
    employee_code: Optional[str] = None
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


class StoreSettingsIn(BaseModel):
    name: str = 'Ram Murti Jewellers'
    latitude: float
    longitude: float
    radius_m: int = 150
    work_start: str = '10:00'  # HH:MM
    work_end: str = '19:30'
    grace_min: int = 15


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


# ---------------- Seed ----------------
async def seed():
    await db.users.create_index('username', unique=True)
    await db.employees.create_index('employee_code')
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
                'notes': '', 'pin_hash': hash_secret(pin),
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
        logger.info(f'Seeded {len(docs)} employees. PINs: RMJ001=1234, RMJ002=2345, RMJ003=3456, RMJ004=4567, RMJ005=5678')

    # Backfill: ensure every employee has a pin_hash
    async for emp in db.employees.find({}, {'_id': 0, 'id': 1, 'employee_code': 1, 'pin_hash': 1}):
        if not emp.get('pin_hash'):
            code = emp.get('employee_code') or ''
            digits = ''.join(ch for ch in code if ch.isdigit())[-4:]
            default_pin = digits.zfill(4) if digits else '0000'
            await db.employees.update_one({'id': emp['id']}, {'$set': {'pin_hash': hash_secret(default_pin)}})
            logger.info(f"Backfilled PIN for {code} → {default_pin}")


@app.on_event('startup')
async def on_startup():
    await seed()


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
    tok = create_token({'sub': user['id'], 'role': 'owner', 'username': user['username']})
    return {
        'access_token': tok, 'token_type': 'bearer',
        'user': {'id': user['id'], 'username': user['username'], 'name': user['name'], 'role': 'owner'},
    }


@api.post('/auth/employee-login')
async def employee_login(body: EmployeeLoginIn):
    code = body.employee_code.strip().upper()
    emp = await db.employees.find_one({'employee_code': code})
    if not emp or not emp.get('pin_hash') or not verify_secret(body.pin, emp['pin_hash']):
        raise HTTPException(status_code=401, detail='Invalid employee code or PIN')
    if emp.get('status') == 'inactive':
        raise HTTPException(status_code=403, detail='This employee account is inactive')
    tok = create_token({'sub': emp['id'], 'role': 'employee', 'employee_code': code})
    return {
        'access_token': tok, 'token_type': 'bearer',
        'user': {
            'id': emp['id'], 'username': code, 'name': emp['name'], 'role': 'employee',
            'employee_code': code, 'designation': emp.get('designation'),
            'department': emp.get('department'), 'photo': emp.get('photo', ''),
        },
    }


@api.get('/auth/me')
async def me(user=Depends(get_current)):
    if user['role'] == 'owner':
        return {'id': user['id'], 'username': user['username'], 'name': user['name'], 'role': 'owner'}
    return {
        'id': user['id'], 'username': user['employee_code'], 'name': user['name'], 'role': 'employee',
        'employee_code': user['employee_code'], 'designation': user.get('designation'),
        'department': user.get('department'), 'photo': user.get('photo', ''),
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
    docs = await db.employees.find(query, {'_id': 0, 'pin_hash': 0}).sort('name', 1).to_list(1000)
    return docs


@api.get('/employees/{emp_id}')
async def get_employee(emp_id: str, _: dict = Depends(get_current)):
    doc = await db.employees.find_one({'id': emp_id}, {'_id': 0, 'pin_hash': 0})
    if not doc: raise HTTPException(status_code=404, detail='Employee not found')
    timeline = await db.timeline.find({'employee_id': emp_id}, {'_id': 0}).sort('created_at', -1).to_list(1000)
    return {'employee': doc, 'timeline': timeline}


@api.post('/employees')
async def create_employee(body: EmployeeIn, _: dict = Depends(require_owner)):
    iso = now_utc().isoformat()
    eid = str(uuid.uuid4())
    data = body.model_dump()
    if not data.get('employee_code'):
        count = await db.employees.count_documents({})
        data['employee_code'] = f'RMJ{(count + 1):03d}'
    else:
        data['employee_code'] = data['employee_code'].upper()
    # default PIN = last 4 of employee_code, else 0000
    default_pin = (''.join(ch for ch in data['employee_code'] if ch.isdigit())[-4:] or '0000').zfill(4)
    doc = {'id': eid, 'created_at': iso, 'updated_at': iso,
           'pin_hash': hash_secret(default_pin), **data}
    await db.employees.insert_one(dict(doc))
    await db.timeline.insert_one({
        'id': str(uuid.uuid4()), 'employee_id': eid, 'type': 'joined',
        'title': 'Joined RMJ', 'description': f"Joined as {data.get('designation') or 'Employee'}",
        'amount': 0, 'created_at': data.get('joining_date') or iso,
    })
    out = {k: v for k, v in doc.items() if k not in ('_id', 'pin_hash')}
    out['default_pin'] = default_pin
    return out


@api.put('/employees/{emp_id}')
async def update_employee(emp_id: str, body: EmployeeIn, _: dict = Depends(require_owner)):
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
    return await db.employees.find_one({'id': emp_id}, {'_id': 0, 'pin_hash': 0})


@api.delete('/employees/{emp_id}')
async def delete_employee(emp_id: str, _: dict = Depends(require_owner)):
    r = await db.employees.delete_one({'id': emp_id})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail='Employee not found')
    await db.timeline.delete_many({'employee_id': emp_id})
    return {'ok': True}


@api.post('/employees/{emp_id}/set-pin')
async def set_pin(emp_id: str, body: SetPinIn, _: dict = Depends(require_owner)):
    pin = body.pin.strip()
    if not (pin.isdigit() and len(pin) == 4):
        raise HTTPException(status_code=400, detail='PIN must be exactly 4 digits')
    emp = await db.employees.find_one({'id': emp_id}, {'_id': 0})
    if not emp: raise HTTPException(status_code=404, detail='Employee not found')
    await db.employees.update_one({'id': emp_id}, {'$set': {'pin_hash': hash_secret(pin), 'updated_at': now_utc().isoformat()}})
    return {'ok': True}


# ---------------- Settings ----------------
@api.get('/settings/store')
async def get_store(_: dict = Depends(get_current)):
    doc = await db.settings.find_one({'id': 'store'}, {'_id': 0})
    return doc or {}


@api.put('/settings/store')
async def update_store(body: StoreSettingsIn, _: dict = Depends(require_owner)):
    payload = body.model_dump()
    payload['id'] = 'store'
    payload['updated_at'] = now_utc().isoformat()
    await db.settings.update_one({'id': 'store'}, {'$set': payload}, upsert=True)
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
    work_start = _minutes(store.get('work_start', '10:00'))
    grace = int(store.get('grace_min', 15))
    is_late = minutes_now > (work_start + grace)

    check_in_doc = {
        'timestamp': now.isoformat(), 'latitude': body.latitude, 'longitude': body.longitude,
        'selfie': body.selfie, 'distance_m': round(dist, 1), 'is_late': is_late,
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
    status = 'half_day' if hours < 4 else 'present'
    check_out_doc = {
        'timestamp': now.isoformat(), 'latitude': body.latitude, 'longitude': body.longitude,
        'selfie': body.selfie, 'distance_m': round(dist, 1),
    }
    await db.attendance.update_one(
        {'id': existing['id']},
        {'$set': {'check_out': check_out_doc, 'working_hours': hours, 'status': status}},
    )
    await db.attendance_events.insert_one({
        'id': str(uuid.uuid4()), 'employee_id': user['id'], 'employee_name': user['name'],
        'type': 'check_out', 'timestamp': now.isoformat(), 'working_hours': hours,
        'created_at': now.isoformat(),
    })
    return {'ok': True, 'working_hours': hours, 'timestamp': now.isoformat()}


@api.get('/attendance/me/today')
async def my_today(user=Depends(require_employee)):
    doc = await db.attendance.find_one({'employee_id': user['id'], 'date': today_str()}, {'_id': 0})
    return doc or {}


@api.get('/attendance/today')
async def attendance_today(_: dict = Depends(require_owner)):
    d = today_str()
    employees = await db.employees.find({}, {'_id': 0, 'pin_hash': 0, 'photo': 0}).sort('name', 1).to_list(1000)
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
async def attendance_live(_: dict = Depends(require_owner)):
    events = await db.attendance_events.find({}, {'_id': 0}).sort('created_at', -1).limit(30).to_list(30)
    return events


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
async def decide_correction(cid: str, body: DecisionIn, user=Depends(require_owner)):
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
        if not existing:
            await db.attendance.insert_one({
                'id': str(uuid.uuid4()), 'employee_id': r['employee_id'], 'date': r['date'],
                'check_in': None, 'check_out': None, 'is_late': False, 'working_hours': 8,
                'status': 'present', 'created_at': now_utc().isoformat(), 'via_correction': True,
            })
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
async def decide_leave(lid: str, body: DecisionIn, user=Depends(require_owner)):
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
    return await db.leaves.find_one({'id': lid}, {'_id': 0})


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


# ---------------- Mount ----------------
app.include_router(api)
app.add_middleware(
    CORSMiddleware, allow_credentials=True, allow_origins=['*'],
    allow_methods=['*'], allow_headers=['*'],
)
