"""Staff accounts (Admin/Accountant) + User Roles / module access

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends, HTTPException
import uuid
from server import (
    db,
    hash_secret,
    verify_secret,
    now_utc,
    create_token,
    get_current,
    require_owner,
    MODULE_DEFS,
    MODULE_KEYS,
    EMPLOYEE_ASSIGNABLE_MODULES,
    resolve_modules,
    require_module,
    UserCreateIn,
    UserUpdateIn,
    SelfAccountUpdateIn,
    ModuleAccessUpdateIn,
    log_audit,
)

router = APIRouter()

# ---------------- Users (Admin/Accountant) ----------------
@router.get('/users')
async def list_users(_: dict = Depends(require_owner), _mod=Depends(require_module('users'))):
    return await db.users.find({}, {'_id': 0, 'password_hash': 0}).sort('created_at', 1).to_list(200)


@router.post('/users')
async def create_user(body: UserCreateIn, user: dict = Depends(require_owner), _mod=Depends(require_module('users'))):
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


@router.put('/users/{uid}')
async def update_user(uid: str, body: UserUpdateIn, user: dict = Depends(require_owner), _mod=Depends(require_module('users'))):
    u = await db.users.find_one({'id': uid}, {'_id': 0})
    if not u: raise HTTPException(status_code=404, detail='User not found')
    if u.get('role') == 'owner' and body.role and body.role != 'owner':
        owner_count = await db.users.count_documents({'role': 'owner'})
        if owner_count <= 1:
            raise HTTPException(status_code=400, detail='Cannot demote the last remaining owner')
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


@router.put('/auth/me')
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
    if body.new_name and body.new_name.strip():
        upd['name'] = body.new_name.strip()
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
            'modules': resolve_modules({**updated, 'role': 'employee'}), 'module_rights': updated.get('module_rights') or {},
        }
    else:
        tok = create_token({'sub': updated['id'], 'role': updated.get('role', 'owner'), 'username': updated['username']})
        user_out = {**updated, 'modules': resolve_modules(updated)}
    await log_audit(user, 'account.self_update', 'user' if not is_employee else 'employee', user['id'], updated.get('name', ''))
    return {'access_token': tok, 'token_type': 'bearer', 'user': user_out}


@router.delete('/users/{uid}')
async def delete_user(uid: str, user=Depends(require_owner), _mod=Depends(require_module('users'))):
    u = await db.users.find_one({'id': uid}, {'_id': 0})
    if not u: raise HTTPException(status_code=404, detail='User not found')
    if u.get('role') == 'owner':
        owner_count = await db.users.count_documents({'role': 'owner'})
        if owner_count <= 1:
            raise HTTPException(status_code=400, detail='Cannot delete the last remaining owner')
    if uid == user['id']:
        raise HTTPException(status_code=400, detail='You cannot delete your own account while logged in as it')
    await db.users.delete_one({'id': uid})
    await log_audit(user, 'user.delete', 'user', uid, u.get('username', ''))
    return {'ok': True}


# ---------------- User Roles / Module Access ----------------
@router.get('/access/modules')
async def list_modules(_: dict = Depends(require_owner), _mod=Depends(require_module('user_roles'))):
    return MODULE_DEFS


@router.get('/access/accounts')
async def list_access_accounts(_: dict = Depends(require_owner), _mod=Depends(require_module('user_roles'))):
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
            'module_access': e.get('module_access'), 'module_rights': e.get('module_rights') or {},
            'cashbook_counter_ids': e.get('cashbook_counter_ids') or [],
            'resolved_modules': resolve_modules({'role': 'employee', 'module_access': e.get('module_access')}),
        })
    return out


@router.put('/access/accounts/{account_id}')
async def update_access(account_id: str, body: ModuleAccessUpdateIn, user=Depends(require_owner), _mod=Depends(require_module('user_roles'))):
    bad = set(body.module_access or []) - MODULE_KEYS
    if bad:
        raise HTTPException(status_code=400, detail=f'Unknown module(s): {", ".join(sorted(bad))}')
    bad_rights = set((body.module_rights or {}).keys()) - EMPLOYEE_ASSIGNABLE_MODULES
    if bad_rights:
        raise HTTPException(status_code=400, detail=f'Not an employee-assignable module: {", ".join(sorted(bad_rights))}')
    u = await db.users.find_one({'id': account_id}, {'_id': 0})
    if u:
        if u.get('role') == 'owner':
            raise HTTPException(status_code=400, detail='Owner always has full access')
        await db.users.update_one({'id': account_id}, {'$set': {'module_access': body.module_access}})
        await log_audit(user, 'access.update', 'user', account_id, u.get('username', ''), {'module_access': body.module_access})
        return {'ok': True}
    e = await db.employees.find_one({'id': account_id}, {'_id': 0})
    if e:
        # Employees can only ever be granted the employee-assignable subset —
        # enforced here too (not just hidden in the UI), so this can't be
        # bypassed by calling the API directly.
        bad_access = set(body.module_access or []) - EMPLOYEE_ASSIGNABLE_MODULES
        if bad_access:
            raise HTTPException(status_code=400, detail=f'Not an employee-assignable module: {", ".join(sorted(bad_access))}')
        await db.employees.update_one({'id': account_id}, {'$set': {
            'module_access': body.module_access, 'module_rights': body.module_rights or {},
            'cashbook_counter_ids': body.cashbook_counter_ids or [],
        }})
        await log_audit(user, 'access.update', 'employee', account_id, e.get('name', ''),
                         {'module_access': body.module_access, 'module_rights': body.module_rights, 'cashbook_counter_ids': body.cashbook_counter_ids})
        return {'ok': True}
    raise HTTPException(status_code=404, detail='Account not found')
