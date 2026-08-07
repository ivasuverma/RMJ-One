from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt

# ---- Setup ----
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ.get('JWT_SECRET', 'rmj-one-dev-secret-change-in-prod')
JWT_ALGO = 'HS256'
JWT_EXPIRE_MIN = 60 * 24 * 7  # 7 days

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="RMJ One API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rmj-one")


# ---- Models ----
class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: str
    username: str
    name: str
    role: Literal['owner', 'employee']


class LoginOut(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user: UserOut


class EmployeeIn(BaseModel):
    name: str
    employee_code: Optional[str] = None
    department: Optional[str] = ''
    designation: Optional[str] = ''
    shift: Optional[str] = 'General'
    salary: float = 0
    joining_date: Optional[str] = None  # ISO date
    mobile: Optional[str] = ''
    address: Optional[str] = ''
    aadhaar: Optional[str] = ''
    pan: Optional[str] = ''
    bank_account: Optional[str] = ''
    bank_ifsc: Optional[str] = ''
    bank_name: Optional[str] = ''
    photo: Optional[str] = ''  # base64 or URL
    status: Literal['active', 'inactive', 'on_leave'] = 'active'
    notes: Optional[str] = ''


class Employee(EmployeeIn):
    id: str
    created_at: str
    updated_at: str


class TimelineEvent(BaseModel):
    id: str
    employee_id: str
    type: str  # joined, salary_revised, advance, bonus, penalty, leave, correction
    title: str
    description: Optional[str] = ''
    amount: Optional[float] = 0
    created_at: str


class DashboardOut(BaseModel):
    todays_attendance: dict
    pending_approvals: dict
    payroll_summary: dict


# ---- Auth utils ----
def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_token(user_doc: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        'sub': user_doc['id'],
        'username': user_doc['username'],
        'role': user_doc['role'],
        'iat': now,
        'exp': now + timedelta(minutes=JWT_EXPIRE_MIN),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


async def current_user(authorization: Optional[str] = None) -> dict:
    """Extract user from Authorization header via FastAPI Header dep below."""
    raise HTTPException(status_code=401, detail='not authorized')


from fastapi import Header


async def get_current_user(authorization: str = Header(default='')) -> dict:
    if not authorization.lower().startswith('bearer '):
        raise HTTPException(status_code=401, detail='Missing bearer token')
    token = authorization.split(' ', 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail='Token expired')
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail='Invalid token')
    user = await db.users.find_one({'id': payload.get('sub')}, {'_id': 0, 'password_hash': 0})
    if not user:
        raise HTTPException(status_code=401, detail='User not found')
    return user


def require_owner(user: dict = Depends(get_current_user)) -> dict:
    if user.get('role') != 'owner':
        raise HTTPException(status_code=403, detail='Owner access required')
    return user


# ---- Seed ----
async def seed():
    await db.users.create_index('username', unique=True)
    await db.employees.create_index('employee_code')
    existing = await db.users.find_one({'username': 'owner'})
    if not existing:
        uid = str(uuid.uuid4())
        await db.users.insert_one({
            'id': uid,
            'username': 'owner',
            'name': 'Ram Murti (Owner)',
            'role': 'owner',
            'password_hash': hash_pw('Owner@123'),
            'created_at': datetime.now(timezone.utc).isoformat(),
        })
        logger.info('Seeded owner user: owner / Owner@123')

    count = await db.employees.count_documents({})
    if count == 0:
        now_iso = datetime.now(timezone.utc).isoformat()
        samples = [
            {
                'name': 'Rahul Sharma', 'employee_code': 'RMJ001', 'department': 'Sales',
                'designation': 'Senior Sales Associate', 'shift': 'General', 'salary': 32000,
                'joining_date': '2023-06-15', 'mobile': '+91 98765 43210', 'address': 'Sector 12, Delhi',
                'aadhaar': 'XXXX-XXXX-1234', 'pan': 'ABCDE1234F', 'bank_account': '1234567890',
                'bank_ifsc': 'HDFC0001234', 'bank_name': 'HDFC Bank', 'status': 'active',
                'notes': 'Top performer', 'photo': '',
            },
            {
                'name': 'Aman Verma', 'employee_code': 'RMJ002', 'department': 'Workshop',
                'designation': 'Goldsmith', 'shift': 'General', 'salary': 28000,
                'joining_date': '2022-11-01', 'mobile': '+91 98111 22233', 'address': 'Karol Bagh, Delhi',
                'aadhaar': 'XXXX-XXXX-5678', 'pan': 'BCDEF2345G', 'bank_account': '2345678901',
                'bank_ifsc': 'ICIC0002345', 'bank_name': 'ICICI Bank', 'status': 'active',
                'notes': '', 'photo': '',
            },
            {
                'name': 'Priya Singh', 'employee_code': 'RMJ003', 'department': 'Accounts',
                'designation': 'Accountant', 'shift': 'General', 'salary': 35000,
                'joining_date': '2024-01-20', 'mobile': '+91 90000 12345', 'address': 'Dwarka, Delhi',
                'aadhaar': 'XXXX-XXXX-9012', 'pan': 'CDEFG3456H', 'bank_account': '3456789012',
                'bank_ifsc': 'SBIN0003456', 'bank_name': 'SBI', 'status': 'active',
                'notes': '', 'photo': '',
            },
            {
                'name': 'Ramesh Kumar', 'employee_code': 'RMJ004', 'department': 'Security',
                'designation': 'Security Head', 'shift': 'Night', 'salary': 22000,
                'joining_date': '2021-03-10', 'mobile': '+91 99887 76655', 'address': 'Rohini, Delhi',
                'aadhaar': 'XXXX-XXXX-3456', 'pan': 'DEFGH4567I', 'bank_account': '4567890123',
                'bank_ifsc': 'PUNB0004567', 'bank_name': 'PNB', 'status': 'on_leave',
                'notes': 'On sick leave', 'photo': '',
            },
            {
                'name': 'Neha Gupta', 'employee_code': 'RMJ005', 'department': 'Sales',
                'designation': 'Sales Associate', 'shift': 'General', 'salary': 26000,
                'joining_date': '2024-08-05', 'mobile': '+91 98765 00001', 'address': 'Lajpat Nagar, Delhi',
                'aadhaar': 'XXXX-XXXX-7890', 'pan': 'EFGHI5678J', 'bank_account': '5678901234',
                'bank_ifsc': 'AXIS0005678', 'bank_name': 'Axis Bank', 'status': 'active',
                'notes': '', 'photo': '',
            },
        ]
        docs = []
        events = []
        for s in samples:
            eid = str(uuid.uuid4())
            doc = {'id': eid, 'created_at': now_iso, 'updated_at': now_iso, **s}
            docs.append(doc)
            events.append({
                'id': str(uuid.uuid4()), 'employee_id': eid, 'type': 'joined',
                'title': 'Joined RMJ', 'description': f"Joined as {s['designation']}",
                'amount': 0, 'created_at': s.get('joining_date') or now_iso,
            })
        await db.employees.insert_many(docs)
        await db.timeline.insert_many(events)
        # Add a couple of sample timeline events for realism
        await db.timeline.insert_one({
            'id': str(uuid.uuid4()), 'employee_id': docs[0]['id'], 'type': 'bonus',
            'title': 'Diwali Bonus', 'description': 'Festive bonus', 'amount': 5000,
            'created_at': now_iso,
        })
        await db.timeline.insert_one({
            'id': str(uuid.uuid4()), 'employee_id': docs[1]['id'], 'type': 'advance',
            'title': 'Salary Advance', 'description': 'Approved advance', 'amount': 3000,
            'created_at': now_iso,
        })
        logger.info(f'Seeded {len(docs)} sample employees.')


@app.on_event('startup')
async def on_startup():
    await seed()


# ---- Routes ----
@api.get('/')
async def root():
    return {'app': 'RMJ One', 'status': 'ok'}


@api.post('/auth/login', response_model=LoginOut)
async def login(body: LoginIn):
    user = await db.users.find_one({'username': body.username.strip().lower()})
    if not user or not verify_pw(body.password, user.get('password_hash', '')):
        raise HTTPException(status_code=401, detail='Invalid username or password')
    token = create_token(user)
    return LoginOut(
        access_token=token,
        user=UserOut(id=user['id'], username=user['username'], name=user['name'], role=user['role']),
    )


@api.get('/auth/me', response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    return UserOut(id=user['id'], username=user['username'], name=user['name'], role=user['role'])


# ---- Employees ----
def _emp_out(doc: dict) -> dict:
    doc = {k: v for k, v in doc.items() if k not in ('_id', )}
    return doc


@api.get('/employees')
async def list_employees(
    q: Optional[str] = Query(default=None),
    department: Optional[str] = None,
    status_: Optional[str] = Query(default=None, alias='status'),
    _: dict = Depends(get_current_user),
):
    query: dict = {}
    if q:
        query['$or'] = [
            {'name': {'$regex': q, '$options': 'i'}},
            {'employee_code': {'$regex': q, '$options': 'i'}},
            {'designation': {'$regex': q, '$options': 'i'}},
            {'department': {'$regex': q, '$options': 'i'}},
        ]
    if department:
        query['department'] = department
    if status_:
        query['status'] = status_
    docs = await db.employees.find(query, {'_id': 0}).sort('name', 1).to_list(1000)
    return docs


@api.get('/employees/{emp_id}')
async def get_employee(emp_id: str, _: dict = Depends(get_current_user)):
    doc = await db.employees.find_one({'id': emp_id}, {'_id': 0})
    if not doc:
        raise HTTPException(status_code=404, detail='Employee not found')
    timeline = await db.timeline.find({'employee_id': emp_id}, {'_id': 0}).sort('created_at', -1).to_list(1000)
    return {'employee': doc, 'timeline': timeline}


@api.post('/employees')
async def create_employee(body: EmployeeIn, _: dict = Depends(require_owner)):
    now_iso = datetime.now(timezone.utc).isoformat()
    eid = str(uuid.uuid4())
    data = body.model_dump()
    # auto-generate employee_code if not provided
    if not data.get('employee_code'):
        count = await db.employees.count_documents({})
        data['employee_code'] = f'RMJ{(count + 1):03d}'
    doc = {'id': eid, 'created_at': now_iso, 'updated_at': now_iso, **data}
    await db.employees.insert_one(dict(doc))
    await db.timeline.insert_one({
        'id': str(uuid.uuid4()), 'employee_id': eid, 'type': 'joined',
        'title': 'Joined RMJ', 'description': f"Joined as {data.get('designation') or 'Employee'}",
        'amount': 0, 'created_at': data.get('joining_date') or now_iso,
    })
    return {k: v for k, v in doc.items() if k != '_id'}


@api.put('/employees/{emp_id}')
async def update_employee(emp_id: str, body: EmployeeIn, _: dict = Depends(require_owner)):
    now_iso = datetime.now(timezone.utc).isoformat()
    existing = await db.employees.find_one({'id': emp_id}, {'_id': 0})
    if not existing:
        raise HTTPException(status_code=404, detail='Employee not found')
    data = body.model_dump()
    update_doc = {**data, 'updated_at': now_iso}
    await db.employees.update_one({'id': emp_id}, {'$set': update_doc})
    # Timeline events for salary revision
    if float(existing.get('salary') or 0) != float(data.get('salary') or 0):
        await db.timeline.insert_one({
            'id': str(uuid.uuid4()), 'employee_id': emp_id, 'type': 'salary_revised',
            'title': 'Salary Revised',
            'description': f"From ₹{existing.get('salary', 0):.0f} to ₹{data.get('salary', 0):.0f}",
            'amount': float(data.get('salary') or 0) - float(existing.get('salary') or 0),
            'created_at': now_iso,
        })
    doc = await db.employees.find_one({'id': emp_id}, {'_id': 0})
    return doc


@api.delete('/employees/{emp_id}')
async def delete_employee(emp_id: str, _: dict = Depends(require_owner)):
    res = await db.employees.delete_one({'id': emp_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail='Employee not found')
    await db.timeline.delete_many({'employee_id': emp_id})
    return {'ok': True}


# ---- Dashboard ----
@api.get('/dashboard')
async def dashboard(_: dict = Depends(get_current_user)):
    total_active = await db.employees.count_documents({'status': 'active'})
    on_leave = await db.employees.count_documents({'status': 'on_leave'})
    total = await db.employees.count_documents({})

    # Since attendance module is out of MVP scope, we compute reasonable placeholders
    # based on employee data so the UI feels alive.
    present = max(total_active - 2, 0)
    absent = max(total - total_active - on_leave, 0)
    late = 1 if total_active >= 3 else 0
    half_day = 1 if total_active >= 5 else 0
    missing_punch = 1 if total_active >= 4 else 0
    working = present

    total_salary = 0.0
    async for e in db.employees.find({'status': 'active'}, {'_id': 0, 'salary': 1}):
        total_salary += float(e.get('salary') or 0)

    # Aggregate advances/bonuses from timeline
    adv_total = 0.0
    bonus_total = 0.0
    async for t in db.timeline.find({'type': 'advance'}, {'_id': 0, 'amount': 1}):
        adv_total += float(t.get('amount') or 0)
    async for t in db.timeline.find({'type': 'bonus'}, {'_id': 0, 'amount': 1}):
        bonus_total += float(t.get('amount') or 0)

    return {
        'todays_attendance': {
            'present': present, 'absent': absent, 'late': late, 'half_day': half_day,
            'missing_punch': missing_punch, 'leave': on_leave, 'working': working,
            'total': total,
        },
        'pending_approvals': {
            'attendance_corrections': missing_punch,
            'leave_requests': 0,
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


# ---- Mount ----
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.on_event('shutdown')
async def on_shutdown():
    client.close()
