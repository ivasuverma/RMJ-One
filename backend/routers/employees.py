"""Employees: CRUD, ID proofs, credentials

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
import uuid
import re
import secrets
from server import (
    db,
    hash_secret,
    now_utc,
    get_current,
    require_owner,
    require_admin,
    require_module,
    SetEmployeeCredentialsIn,
    EmployeeIn,
    IdProofIn,
    log_audit,
    _ledger_sign,
    _make_photo_thumb,
)

router = APIRouter()


async def _sync_department_name(data: dict) -> None:
    """`department` (free text) is a derived display cache of `department_id`
    (the real master-backed FK) — kept in sync here on every write so the
    other places that still read the free-text field (payroll receipts, auth
    responses, the AI assistant, attendance display) keep working unchanged."""
    did = data.get('department_id')
    if did:
        dept = await db.departments.find_one({'id': did}, {'_id': 0, 'name': 1})
        data['department'] = dept['name'] if dept else ''
    else:
        data['department'] = ''


# ---------------- Employee self-service (own profile) ----------------
# Registered BEFORE /employees/{emp_id} so "me" isn't captured as an id.
class EmployeeSelfUpdateIn(BaseModel):
    name: Optional[str] = None
    mobile: Optional[str] = None
    address: Optional[str] = None
    aadhaar: Optional[str] = None
    pan: Optional[str] = None
    bank_account: Optional[str] = None
    bank_ifsc: Optional[str] = None
    bank_name: Optional[str] = None
    photo: Optional[str] = None


@router.get('/employees/me')
async def get_my_profile(user=Depends(get_current)):
    if user.get('role') != 'employee':
        raise HTTPException(status_code=403, detail='Employees only')
    emp = await db.employees.find_one({'id': user['id']}, {'_id': 0, 'password_hash': 0})
    if not emp:
        raise HTTPException(status_code=404, detail='Profile not found')
    return emp


@router.put('/employees/me')
async def update_my_profile(body: EmployeeSelfUpdateIn, user=Depends(get_current)):
    # An employee may update their own personal details only — never salary,
    # designation, department, status or access (those stay admin-controlled).
    if user.get('role') != 'employee':
        raise HTTPException(status_code=403, detail='Employees only')
    emp = await db.employees.find_one({'id': user['id']}, {'_id': 0})
    if not emp:
        raise HTTPException(status_code=404, detail='Profile not found')
    upd: dict = {}
    for f in ('name', 'mobile', 'address', 'aadhaar', 'pan', 'bank_account', 'bank_ifsc', 'bank_name'):
        v = getattr(body, f)
        if v is not None:
            upd[f] = v.strip()
    if 'name' in upd and not upd['name']:
        raise HTTPException(status_code=400, detail='Name cannot be empty')
    if body.photo is not None:
        upd['photo'] = body.photo
        upd['photo_thumb'] = _make_photo_thumb(body.photo)
    if upd:
        upd['updated_at'] = now_utc().isoformat()
        await db.employees.update_one({'id': user['id']}, {'$set': upd})
        await log_audit(user, 'employee.self_update', 'employee', user['id'], emp.get('name', ''), {'fields': list(upd.keys())})
    return await db.employees.find_one({'id': user['id']}, {'_id': 0, 'password_hash': 0})


# ---------------- Employees ----------------
@router.get('/employees')
async def list_employees(
    q: Optional[str] = None,
    department: Optional[str] = None,
    department_id: Optional[str] = None,
    location_id: Optional[str] = None,
    status_: Optional[str] = Query(default=None, alias='status'),
    _: dict = Depends(get_current),
):
    query: dict = {}
    if q:
        # re.escape() so special regex chars in free-text search (., *, (, etc.)
        # are matched literally instead of as regex syntax — avoids malformed
        # or pathologically slow queries from arbitrary user input.
        q_esc = re.escape(q)
        query['$or'] = [
            {'name': {'$regex': q_esc, '$options': 'i'}},
            {'employee_code': {'$regex': q_esc, '$options': 'i'}},
            {'designation': {'$regex': q_esc, '$options': 'i'}},
            {'department': {'$regex': q_esc, '$options': 'i'}},
        ]
    # `department` (free-text) kept for older callers; `department_id` is the
    # real master-backed filter going forward — see _sync_department_name.
    if department: query['department'] = department
    if department_id: query['department_id'] = department_id
    if location_id: query['location_id'] = location_id
    if status_: query['status'] = status_
    # 'photo' excluded — this list only ever shows a small avatar, so it gets
    # photo_thumb (~5-10KB) swapped in as `photo` below instead of the full
    # ~50-150KB capture. The employee's own detail page still fetches the
    # full photo via GET /employees/{id}, which is untouched.
    docs = await db.employees.find(query, {'_id': 0, 'password_hash': 0, 'id_proofs': 0, 'photo': 0}).sort('name', 1).to_list(1000)
    for d in docs:
        d['photo'] = d.pop('photo_thumb', '') or ''
    events = await db.timeline.find(
        {'type': {'$in': ['advance', 'bonus', 'fine', 'deduction', 'salary', 'salary_earned', 'salary_paid']}},
        {'_id': 0, 'employee_id': 1, 'type': 1, 'amount': 1, 'sign': 1},
    ).to_list(20000)
    balances: dict = {}
    for e in events:
        eid = e.get('employee_id')
        if not eid: continue
        amount = float(e.get('amount') or 0)
        t = e.get('type', 'other')
        if t in ('salary', 'salary_earned'):
            delta = abs(amount)          # credit — owed to employee
        elif t == 'salary_paid':
            delta = -abs(amount)         # debit — cash paid out
        else:
            delta = e.get('sign', _ledger_sign(t)) * abs(amount)
        balances[eid] = balances.get(eid, 0) + delta
    for d in docs:
        d['closing_balance'] = round(balances.get(d['id'], 0), 2)
    return docs


@router.get('/employees/{emp_id}')
async def get_employee(emp_id: str, _: dict = Depends(get_current)):
    # Exclude the heavy bits from the default profile payload: each ID proof's
    # base64 data_uri (fetched on demand when viewed — see the endpoint below)
    # and the timeline (the profile screen no longer shows it). This keeps the
    # profile page snappy even for employees with several multi-MB documents.
    doc = await db.employees.find_one(
        {'id': emp_id},
        {'_id': 0, 'password_hash': 0, 'id_proofs.data_uri': 0},
    )
    if not doc: raise HTTPException(status_code=404, detail='Employee not found')
    return {'employee': doc, 'timeline': []}


@router.get('/employees/{emp_id}/id-proofs/{proof_id}')
async def get_id_proof(emp_id: str, proof_id: str, _: dict = Depends(get_current)):
    """Fetch one ID proof's base64 data on demand — kept out of the main
    profile payload so the page loads fast."""
    doc = await db.employees.find_one(
        {'id': emp_id, 'id_proofs.id': proof_id},
        {'_id': 0, 'id_proofs.$': 1},
    )
    proofs = (doc or {}).get('id_proofs') or []
    if not proofs:
        raise HTTPException(status_code=404, detail='ID proof not found')
    return {'id': proof_id, 'data_uri': proofs[0].get('data_uri', '')}


@router.post('/employees')
async def create_employee(body: EmployeeIn, user: dict = Depends(require_admin), _mod=Depends(require_module('team'))):
    iso = now_utc().isoformat()
    eid = str(uuid.uuid4())
    data = body.model_dump()
    await _sync_department_name(data)
    if not data.get('employee_code'):
        count = await db.employees.count_documents({})
        data['employee_code'] = f'RMJ{(count + 1):03d}'
    else:
        data['employee_code'] = data['employee_code'].upper()
    # default login username = employee_code (lowercased); default password = last 4
    # digits of employee_code, else 0000 — same pattern as the old default-PIN scheme.
    default_username = data['employee_code'].lower()
    default_password = (''.join(ch for ch in data['employee_code'] if ch.isdigit())[-4:] or '0000').zfill(4)
    # The default password is predictable (last 4 digits of a sequential
    # employee code — 10,000 possible combinations), so force a real
    # password to be set on first login rather than relying on the employee
    # to think to change it themselves.
    doc = {'id': eid, 'created_at': iso, 'updated_at': iso,
           'username': default_username, 'password_hash': hash_secret(default_password),
           'must_change_password': True, 'photo_thumb': _make_photo_thumb(data.get('photo')), **data}
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


@router.put('/employees/{emp_id}')
async def update_employee(emp_id: str, body: EmployeeIn, user: dict = Depends(require_admin), _mod=Depends(require_module('team'))):
    iso = now_utc().isoformat()
    existing = await db.employees.find_one({'id': emp_id}, {'_id': 0})
    if not existing: raise HTTPException(status_code=404, detail='Employee not found')
    data = body.model_dump()
    await _sync_department_name(data)
    if data.get('employee_code'): data['employee_code'] = data['employee_code'].upper()
    # Regenerate the thumbnail whenever the photo actually changed — cheap
    # (a few ms), and avoids ever serving a stale avatar in list screens.
    photo_thumb = existing.get('photo_thumb', '')
    if data.get('photo') != existing.get('photo'):
        photo_thumb = _make_photo_thumb(data.get('photo'))
    set_fields = {**data, 'photo_thumb': photo_thumb, 'updated_at': iso}
    # Stamp when an employee is deactivated (and clear it if reactivated) — used
    # to hide long-gone, fully-settled staff from payroll after a grace month.
    if data.get('status') == 'inactive' and existing.get('status') != 'inactive':
        set_fields['deactivated_at'] = iso
    elif data.get('status') != 'inactive' and existing.get('status') == 'inactive':
        set_fields['deactivated_at'] = None
    await db.employees.update_one({'id': emp_id}, {'$set': set_fields})
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


@router.delete('/employees/{emp_id}')
async def delete_employee(emp_id: str, user: dict = Depends(require_owner), _mod=Depends(require_module('team'))):
    existing = await db.employees.find_one({'id': emp_id}, {'_id': 0})
    r = await db.employees.delete_one({'id': emp_id})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail='Employee not found')
    await db.timeline.delete_many({'employee_id': emp_id})
    await log_audit(user, 'employee.delete', 'employee', emp_id, (existing or {}).get('employee_code', ''), {'name': (existing or {}).get('name')})
    return {'ok': True}


@router.post('/employees/{emp_id}/id-proofs')
async def add_id_proof(emp_id: str, body: IdProofIn, user=Depends(require_admin), _mod=Depends(require_module('team'))):
    existing = await db.employees.find_one({'id': emp_id}, {'_id': 0})
    if not existing: raise HTTPException(status_code=404, detail='Employee not found')
    proof = {
        'id': str(uuid.uuid4()), 'name': (body.name or 'Document').strip()[:200],
        'data_uri': body.data_uri, 'uploaded_at': now_utc().isoformat(),
    }
    await db.employees.update_one({'id': emp_id}, {'$push': {'id_proofs': proof}})
    await log_audit(user, 'employee.id_proof.add', 'employee', emp_id, existing.get('employee_code', ''), {'name': proof['name']})
    return proof


@router.delete('/employees/{emp_id}/id-proofs/{proof_id}')
async def delete_id_proof(emp_id: str, proof_id: str, user=Depends(require_admin), _mod=Depends(require_module('team'))):
    await db.employees.update_one({'id': emp_id}, {'$pull': {'id_proofs': {'id': proof_id}}})
    await log_audit(user, 'employee.id_proof.delete', 'employee', emp_id, '', {'proof_id': proof_id})
    return {'ok': True}


@router.post('/employees/{emp_id}/set-credentials')
async def set_employee_credentials(emp_id: str, body: SetEmployeeCredentialsIn, user=Depends(require_admin), _mod=Depends(require_module('team'))):
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
        {'$set': {
            'username': uname, 'password_hash': hash_secret(body.password),
            # Same reasoning as a brand-new employee's default password: this
            # was just typed in by an admin and shared out, not chosen by the
            # employee themselves, so force a real password on next login.
            'must_change_password': True, 'updated_at': now_utc().isoformat(),
        }},
    )
    await log_audit(user, 'employee.credentials.set', 'employee', emp_id, emp.get('name', ''), {})
    return {'ok': True}


@router.post('/employees/{emp_id}/reset-credentials')
async def reset_employee_credentials(emp_id: str, user=Depends(require_admin), _mod=Depends(require_module('team'))):
    """One-tap alternative to /set-credentials: generates a fresh random
    temporary password (keeping the employee's existing username, or falling
    back to the employee_code-based default if they somehow don't have one
    yet), saves it, and hands the plaintext back so the caller can share it
    immediately — no typing required. Forces a real password on next login,
    same as a brand-new employee."""
    emp = await db.employees.find_one({'id': emp_id}, {'_id': 0})
    if not emp: raise HTTPException(status_code=404, detail='Employee not found')
    username = emp.get('username') or (emp.get('employee_code') or '').lower()
    if not username:
        raise HTTPException(status_code=400, detail='This employee has no username or employee code to base one on')
    password = f'{secrets.randbelow(1000000):06d}'
    await db.employees.update_one(
        {'id': emp_id},
        {'$set': {
            'username': username, 'password_hash': hash_secret(password),
            'must_change_password': True, 'updated_at': now_utc().isoformat(),
        }},
    )
    await log_audit(user, 'employee.credentials.reset', 'employee', emp_id, emp.get('name', ''), {})
    return {'username': username, 'password': password}
