"""Auth: login, session, forced password change

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Dict
from collections import defaultdict
import time as _time
from server import (
    db,
    hash_secret,
    verify_secret,
    create_token,
    get_current,
    require_employee,
    resolve_modules,
    LoginIn,
    EmployeeLoginIn,
)

router = APIRouter()

# ---------------- Auth ----------------
# Login rate limiting — in-memory only (resets on restart; won't coordinate
# across multiple backend instances behind a load balancer). Fine for the
# current single-store/single-instance deployment.
_LOGIN_ATTEMPTS: Dict[str, list] = defaultdict(list)
_LOGIN_MAX_ATTEMPTS = 5
_LOGIN_WINDOW_SEC = 5 * 60


def _login_rate_key(request: Request, username: str) -> str:
    ip = request.client.host if request.client else 'unknown'
    return f'{ip}:{(username or "").strip().lower()}'


def _check_login_rate_limit(request: Request, username: str):
    key = _login_rate_key(request, username)
    now = _time.monotonic()
    attempts = _LOGIN_ATTEMPTS[key]
    attempts[:] = [t for t in attempts if now - t < _LOGIN_WINDOW_SEC]
    if len(attempts) >= _LOGIN_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail='Too many login attempts. Please wait a few minutes and try again.')


def _record_failed_login(request: Request, username: str):
    _LOGIN_ATTEMPTS[_login_rate_key(request, username)].append(_time.monotonic())


def _clear_login_attempts(request: Request, username: str):
    _LOGIN_ATTEMPTS.pop(_login_rate_key(request, username), None)


@router.get('/')
async def root(): return {'app': 'RMJ One', 'status': 'ok'}


@router.post('/auth/login')
async def login(body: LoginIn, request: Request):
    _check_login_rate_limit(request, body.username)
    user = await db.users.find_one({'username': body.username.strip().lower()})
    if not user or not verify_secret(body.password, user.get('password_hash', '')):
        _record_failed_login(request, body.username)
        raise HTTPException(status_code=401, detail='Invalid username or password')
    _clear_login_attempts(request, body.username)
    tok = create_token({'sub': user['id'], 'role': user.get('role', 'owner'), 'username': user['username']})
    return {
        'access_token': tok, 'token_type': 'bearer',
        'user': {
            'id': user['id'], 'username': user['username'], 'name': user['name'], 'role': user.get('role', 'owner'),
            'modules': resolve_modules(user),
        },
    }


@router.post('/auth/employee-login')
async def employee_login(body: EmployeeLoginIn, request: Request):
    _check_login_rate_limit(request, body.username)
    uname = body.username.strip().lower()
    emp = await db.employees.find_one({'username': uname})
    if not emp or not emp.get('password_hash') or not verify_secret(body.password, emp['password_hash']):
        _record_failed_login(request, body.username)
        raise HTTPException(status_code=401, detail='Invalid username or password')
    if emp.get('status') == 'inactive':
        raise HTTPException(status_code=403, detail='This employee account is inactive')
    _clear_login_attempts(request, body.username)
    code = emp.get('employee_code')
    tok = create_token({'sub': emp['id'], 'role': 'employee', 'employee_code': code})
    return {
        'access_token': tok, 'token_type': 'bearer',
        'user': {
            'id': emp['id'], 'username': emp.get('username', uname), 'name': emp['name'], 'role': 'employee',
            'employee_code': code, 'designation': emp.get('designation'),
            'department': emp.get('department'), 'photo': emp.get('photo', ''),
            'modules': resolve_modules({**emp, 'role': 'employee'}), 'module_rights': emp.get('module_rights') or {},
            'must_change_password': bool(emp.get('must_change_password')),
        },
    }


@router.post('/auth/login-unified')
async def login_unified(body: LoginIn, request: Request):
    # Single sign-in for the whole business — owner/admin/accountant accounts
    # live in db.users, employees live in db.employees. Try both silently so
    # the app never has to ask "which kind of user are you?"
    _check_login_rate_limit(request, body.username)
    uname = body.username.strip().lower()
    user = await db.users.find_one({'username': uname})
    if user and verify_secret(body.password, user.get('password_hash', '')):
        _clear_login_attempts(request, body.username)
        tok = create_token({'sub': user['id'], 'role': user.get('role', 'owner'), 'username': user['username']})
        return {
            'access_token': tok, 'token_type': 'bearer',
            'user': {
                'id': user['id'], 'username': user['username'], 'name': user['name'], 'role': user.get('role', 'owner'),
                'modules': resolve_modules(user),
            },
        }
    emp = await db.employees.find_one({'username': uname})
    if emp and emp.get('password_hash') and verify_secret(body.password, emp['password_hash']):
        if emp.get('status') == 'inactive':
            raise HTTPException(status_code=403, detail='This employee account is inactive')
        _clear_login_attempts(request, body.username)
        code = emp.get('employee_code')
        tok = create_token({'sub': emp['id'], 'role': 'employee', 'employee_code': code})
        return {
            'access_token': tok, 'token_type': 'bearer',
            'user': {
                'id': emp['id'], 'username': emp.get('username', uname), 'name': emp['name'], 'role': 'employee',
                'employee_code': code, 'designation': emp.get('designation'),
                'department': emp.get('department'), 'photo': emp.get('photo', ''),
                'modules': resolve_modules({**emp, 'role': 'employee'}), 'module_rights': emp.get('module_rights') or {},
                'must_change_password': bool(emp.get('must_change_password')),
            },
        }
    _record_failed_login(request, body.username)
    raise HTTPException(status_code=401, detail='Invalid username or password')


@router.get('/auth/me')
async def me(user=Depends(get_current)):
    if user['role'] in ('owner', 'admin', 'accountant'):
        return {
            'id': user['id'], 'username': user['username'], 'name': user['name'], 'role': user['role'],
            'modules': resolve_modules(user),
        }
    # Work-from-home employees don't record attendance, so the app hides the
    # check-in card and attendance tiles for them.
    shift_doc = await db.shifts.find_one({'name': user.get('shift')}, {'_id': 0, 'remote': 1})
    return {
        'id': user['id'], 'username': user.get('username') or user.get('employee_code'), 'name': user['name'], 'role': 'employee',
        'employee_code': user['employee_code'], 'designation': user.get('designation'),
        'department': user.get('department'), 'photo': user.get('photo', ''),
        'shift': user.get('shift'), 'remote': bool(shift_doc and shift_doc.get('remote')),
        'modules': resolve_modules(user), 'module_rights': user.get('module_rights') or {},
        'must_change_password': bool(user.get('must_change_password')),
    }


class SetEmployeePasswordIn(BaseModel):
    new_password: str


@router.post('/auth/employee/set-password')
async def employee_set_password(body: SetEmployeePasswordIn, user=Depends(require_employee)):
    # Used both for the forced first-login password change (must_change_password)
    # and for an employee voluntarily changing their password later — either way
    # this clears the flag, since a real password is now in place. No current-
    # password check on this path deliberately: if must_change_password is set,
    # the "current" password is still the predictable default, so requiring it
    # back would add friction without adding security.
    if len(body.new_password) < 4:
        raise HTTPException(status_code=400, detail='Password must be at least 4 characters')
    await db.employees.update_one(
        {'id': user['id']},
        {'$set': {'password_hash': hash_secret(body.new_password), 'must_change_password': False}},
    )
    tok = create_token({'sub': user['id'], 'role': 'employee', 'employee_code': user.get('employee_code')})
    return {'ok': True, 'access_token': tok}
