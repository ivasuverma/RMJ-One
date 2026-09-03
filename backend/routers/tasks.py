"""Tasks: assignment, templates, comments

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import datetime
import uuid
from server import (
    db,
    now_utc,
    IST,
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
    _notify_module,
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
        'priority': body.priority, 'due_date': body.due_date, 'due_time': body.due_time, 'status': 'open',
        'points': max(0, body.points or 0), 'points_awarded': None,
        'repeat_reminder': body.repeat_reminder, 'last_reminded_at': None,
        'max_reminders': body.max_reminders, 'reminder_count': 0, 'reminder_interval': body.reminder_interval,
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


@router.get('/tasks/my-performance')
async def my_task_performance(user=Depends(get_current)):
    """Points earned + a quick performance overview for the logged-in
    employee's own Tasks tab — total points, on-time vs late completions,
    and what's still open."""
    emp_id = user['id']
    total_points = 0
    completed = 0
    on_time = 0
    late = 0
    async for t in db.tasks.find({'assigned_to': emp_id, 'status': 'done'}, {'_id': 0}):
        completed += 1
        awarded = t.get('points_awarded') or 0
        total_points += awarded
        if (t.get('points') or 0) > 0:
            if awarded > 0: on_time += 1
            else: late += 1
    open_count = await db.tasks.count_documents({'assigned_to': emp_id, 'status': 'open'})
    today_iso = now_utc().astimezone(IST).date().isoformat()
    overdue_open = await db.tasks.count_documents({
        'assigned_to': emp_id, 'status': 'open', 'due_date': {'$ne': None, '$lt': today_iso},
    })
    return {
        'total_points': total_points, 'completed': completed,
        'on_time': on_time, 'late': late, 'open': open_count, 'overdue_open': overdue_open,
    }


@router.get('/tasks/templates')
async def list_task_templates(_: dict = Depends(require_admin), _mod=Depends(require_module('tasks'))):
    # Registered ahead of the /tasks/{task_id} catch-all below — Starlette
    # matches routes in registration order, and a static "templates" segment
    # would otherwise always be swallowed as if it were a task_id.
    return await db.task_templates.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)


@router.get('/tasks/templates/{template_id}')
async def get_task_template(template_id: str, _: dict = Depends(require_admin), _mod=Depends(require_module('tasks'))):
    t = await db.task_templates.find_one({'id': template_id}, {'_id': 0})
    if not t:
        raise HTTPException(status_code=404, detail='Template not found')
    return t


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


def _points_for_completion(t: dict, completed_at_iso: str) -> int:
    """Full points only if the task is completed on or before its due
    date/time (if one was set); no due date means no deadline to miss, so it
    still counts. Not on time — or no points configured — earns nothing."""
    points = t.get('points') or 0
    if points <= 0:
        return 0
    due_date = t.get('due_date')
    if not due_date:
        return points
    due_time = t.get('due_time') or '23:59'
    try:
        deadline = datetime.fromisoformat(f'{due_date}T{due_time}:00').replace(tzinfo=IST)
    except ValueError:
        return points
    completed_at = datetime.fromisoformat(completed_at_iso).astimezone(IST)
    return points if completed_at <= deadline else 0


@router.post('/tasks/{task_id}/complete')
async def complete_task(task_id: str, user=Depends(get_current)):
    t = await db.tasks.find_one({'id': task_id}, {'_id': 0})
    if not t: raise HTTPException(status_code=404, detail='Task not found')
    if user.get('role') == 'employee' and t['assigned_to'] != user['id']:
        raise HTTPException(status_code=403, detail='Not your task')
    if t['status'] == 'done':
        return t
    iso = now_utc().isoformat()
    points_awarded = _points_for_completion(t, iso)
    await db.tasks.update_one({'id': task_id}, {'$set': {'status': 'done', 'completed_at': iso, 'points_awarded': points_awarded}})
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
        await _notify_module('tasks', f"Comment on: {t['title']}", f"{user['name']}: {comment['text']}", '/tasks',
                              script='task_comment', admin_only=True)
    else:
        await notify_user(t['assigned_to'], f"Comment on: {t['title']}", f"{user['name']}: {comment['text']}", '/(emp)/tasks')
    return comment


# ---------------- Task Templates (recurring) ----------------
def _validate_template(body: TaskTemplateIn):
    if body.freq == 'hourly' and (not body.interval_hours or body.interval_hours < 1):
        raise HTTPException(status_code=400, detail='Enter an interval of at least 1 hour')
    # monthly/yearly have no legacy anchor to fall back on (unlike weekly's
    # old standalone `weekday`) — a start_date is the only way they know
    # which day to recur on, so it's mandatory for those two.
    if body.freq in ('monthly', 'yearly') and not body.start_date:
        raise HTTPException(status_code=400, detail='A start date is required for monthly/yearly templates')
    if body.max_repetitions is not None and body.end_date is not None:
        raise HTTPException(status_code=400, detail='Choose either a number of repetitions or an end date, not both')
    if body.max_repetitions is not None and not (1 <= body.max_repetitions <= 120):
        raise HTTPException(status_code=400, detail='Number of repetitions must be between 1 and 120')
    if body.end_date is not None and body.end_date < body.start_date:
        raise HTTPException(status_code=400, detail='End date must be on or after the start date')


@router.post('/tasks/templates')
async def create_task_template(body: TaskTemplateIn, user=Depends(require_admin), _mod=Depends(require_module('tasks'))):
    emp = await db.employees.find_one({'id': body.assigned_to}, {'_id': 0})
    if not emp: raise HTTPException(status_code=404, detail='Employee not found')
    _validate_template(body)
    doc = {
        'id': str(uuid.uuid4()), **body.model_dump(), 'assigned_to_name': emp['name'],
        'generated_count': 0, 'created_at': now_utc().isoformat(),
    }
    await db.task_templates.insert_one(dict(doc))
    await log_audit(user, 'task_template.create', 'task_template', doc['id'], body.title)
    return {k: v for k, v in doc.items() if k != '_id'}


@router.put('/tasks/templates/{template_id}')
async def update_task_template(template_id: str, body: TaskTemplateIn, user=Depends(require_admin), _mod=Depends(require_module('tasks'))):
    if not await db.task_templates.find_one({'id': template_id}):
        raise HTTPException(status_code=404, detail='Template not found')
    emp = await db.employees.find_one({'id': body.assigned_to}, {'_id': 0})
    if not emp: raise HTTPException(status_code=404, detail='Employee not found')
    _validate_template(body)
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
