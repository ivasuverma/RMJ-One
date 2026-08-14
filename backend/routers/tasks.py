"""Tasks: assignment, templates, comments

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
import uuid
from server import (
    db,
    now_utc,
    get_current,
    require_admin,
    require_module,
    require_admin_or_module,
    require_admin_or_module_right,
    TaskIn,
    TaskUpdateIn,
    TaskCommentIn,
    TaskTemplateIn,
    log_audit,
    notify_user,
    notify_roles,
)

router = APIRouter()

# ---------------- Tasks ----------------
@router.post('/tasks')
async def create_task(body: TaskIn, user=Depends(require_admin_or_module('tasks'))):
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


@router.get('/tasks')
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


@router.get('/tasks/{task_id}')
async def get_task(task_id: str, user=Depends(get_current)):
    t = await db.tasks.find_one({'id': task_id}, {'_id': 0})
    if not t: raise HTTPException(status_code=404, detail='Task not found')
    if user.get('role') == 'employee' and t['assigned_to'] != user['id']:
        raise HTTPException(status_code=403, detail='Not your task')
    return t


@router.put('/tasks/{task_id}')
async def update_task(task_id: str, body: TaskUpdateIn, user=Depends(require_admin_or_module_right('tasks', 'edit'))):
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


@router.delete('/tasks/{task_id}')
async def delete_task(task_id: str, user=Depends(require_admin_or_module_right('tasks', 'delete'))):
    t = await db.tasks.find_one({'id': task_id}, {'_id': 0})
    r = await db.tasks.delete_one({'id': task_id})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail='Task not found')
    await log_audit(user, 'task.delete', 'task', task_id, (t or {}).get('title', ''))
    return {'ok': True}


@router.post('/tasks/{task_id}/complete')
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


@router.post('/tasks/{task_id}/reopen')
async def reopen_task(task_id: str, user=Depends(require_admin_or_module_right('tasks', 'edit'))):
    t = await db.tasks.find_one({'id': task_id}, {'_id': 0})
    if not t: raise HTTPException(status_code=404, detail='Task not found')
    await db.tasks.update_one({'id': task_id}, {'$set': {'status': 'open', 'completed_at': None, 'overdue_notified_at': None}})
    await log_audit(user, 'task.reopen', 'task', task_id, t.get('title', ''))
    return await db.tasks.find_one({'id': task_id}, {'_id': 0})


@router.post('/tasks/{task_id}/comments')
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
@router.post('/tasks/templates')
async def create_task_template(body: TaskTemplateIn, user=Depends(require_admin), _mod=Depends(require_module('tasks'))):
    emp = await db.employees.find_one({'id': body.assigned_to}, {'_id': 0})
    if not emp: raise HTTPException(status_code=404, detail='Employee not found')
    if body.freq == 'weekly' and body.weekday is None:
        raise HTTPException(status_code=400, detail='weekday is required for a weekly template')
    doc = {'id': str(uuid.uuid4()), **body.model_dump(), 'assigned_to_name': emp['name'], 'created_at': now_utc().isoformat()}
    await db.task_templates.insert_one(dict(doc))
    await log_audit(user, 'task_template.create', 'task_template', doc['id'], body.title)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.get('/tasks/templates')
async def list_task_templates(_: dict = Depends(require_admin), _mod=Depends(require_module('tasks'))):
    return await db.task_templates.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)


@router.put('/tasks/templates/{template_id}')
async def update_task_template(template_id: str, body: TaskTemplateIn, user=Depends(require_admin), _mod=Depends(require_module('tasks'))):
    if not await db.task_templates.find_one({'id': template_id}):
        raise HTTPException(status_code=404, detail='Template not found')
    emp = await db.employees.find_one({'id': body.assigned_to}, {'_id': 0})
    if not emp: raise HTTPException(status_code=404, detail='Employee not found')
    await db.task_templates.update_one({'id': template_id}, {'$set': {**body.model_dump(), 'assigned_to_name': emp['name']}})
    await log_audit(user, 'task_template.update', 'task_template', template_id, body.title)
    return await db.task_templates.find_one({'id': template_id}, {'_id': 0})


@router.delete('/tasks/templates/{template_id}')
async def delete_task_template(template_id: str, user=Depends(require_admin), _mod=Depends(require_module('tasks'))):
    t = await db.task_templates.find_one({'id': template_id}, {'_id': 0})
    r = await db.task_templates.delete_one({'id': template_id})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail='Template not found')
    await log_audit(user, 'task_template.delete', 'task_template', template_id, (t or {}).get('title', ''))
    return {'ok': True}
