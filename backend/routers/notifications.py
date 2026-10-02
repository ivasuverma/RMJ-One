"""Web push notifications

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
import uuid
from server import (
    db,
    now_utc,
    get_current,
    require_admin,
    PushSubscriptionIn,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
    WEBPUSH_AVAILABLE,
)

router = APIRouter()

@router.get('/notifications/vapid-public-key')
async def notifications_vapid_key():
    return {'publicKey': VAPID_PUBLIC_KEY, 'enabled': bool(WEBPUSH_AVAILABLE and VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)}


@router.post('/notifications/subscribe')
async def notifications_subscribe(body: PushSubscriptionIn, user=Depends(get_current)):
    existing = await db.push_subscriptions.find_one({'endpoint': body.endpoint}, {'_id': 0})
    doc = {
        'id': existing['id'] if existing else str(uuid.uuid4()),
        'user_id': user['id'], 'role': user.get('role'), 'endpoint': body.endpoint,
        'keys': body.keys, 'created_at': now_utc().isoformat(),
    }
    await db.push_subscriptions.update_one({'endpoint': body.endpoint}, {'$set': doc}, upsert=True)
    return {'ok': True}


@router.post('/notifications/unsubscribe')
async def notifications_unsubscribe(body: dict, user=Depends(get_current)):
    endpoint = body.get('endpoint')
    if endpoint:
        await db.push_subscriptions.delete_one({'endpoint': endpoint, 'user_id': user['id']})
    return {'ok': True}


@router.get('/notifications/status')
async def notifications_status(user=Depends(get_current)):
    count = await db.push_subscriptions.count_documents({'user_id': user['id']})
    # nudged_at: when an admin last pressed Remind for this person — their app shows the
    # setup banner again even if they had closed it.
    emp = await db.employees.find_one({'id': user['id']}, {'_id': 0, 'notif_nudged_at': 1}) if user.get('role') == 'employee' else None
    return {'subscribed': count > 0, 'nudged_at': (emp or {}).get('notif_nudged_at')}


async def staff_push_status() -> list[dict]:
    """Every active employee and whether any of their devices can get push notifications.
    Dead subscriptions are removed when a push to them fails, so a row here means working."""
    emps = await db.employees.find(
        {'status': {'$ne': 'inactive'}},
        {'_id': 0, 'id': 1, 'name': 1, 'designation': 1, 'photo_thumb': 1, 'notif_nudged_at': 1},
    ).sort('name', 1).to_list(2000)
    subs = await db.push_subscriptions.aggregate([
        {'$match': {'user_id': {'$in': [e['id'] for e in emps]}}},
        {'$group': {'_id': '$user_id', 'devices': {'$sum': 1}, 'since': {'$max': '$created_at'}}},
    ]).to_list(2000)
    by = {x['_id']: x for x in subs}
    return [{
        'id': e['id'], 'name': e.get('name') or '', 'designation': e.get('designation') or '', 'photo': e.get('photo_thumb') or '',
        'devices': (by.get(e['id']) or {}).get('devices', 0), 'since': (by.get(e['id']) or {}).get('since'),
        'nudged_at': e.get('notif_nudged_at'),
    } for e in emps]


@router.get('/notifications/staff-status')
async def notifications_staff_status(_: dict = Depends(require_admin)):
    rows = await staff_push_status()
    return {'staff': rows, 'off': sum(1 for r in rows if not r['devices'])}


class NudgeIn(BaseModel):
    employee_ids: Optional[list[str]] = Field(default=None, max_length=2000)   # None = everyone who's off


@router.post('/notifications/staff-nudge')
async def notifications_staff_nudge(body: NudgeIn, _: dict = Depends(require_admin)):
    """Remind staff to turn on notifications: their Home shows the setup banner again,
    even if they had closed it, until they turn notifications on."""
    ids = body.employee_ids
    if ids is None:
        ids = [r['id'] for r in await staff_push_status() if not r['devices']]
    now = now_utc().isoformat()
    res = await db.employees.update_many({'id': {'$in': ids}}, {'$set': {'notif_nudged_at': now}})
    return {'ok': True, 'reminded': res.modified_count, 'at': now}


@router.get('/notifications')
async def list_notifications(user=Depends(get_current), limit: int = 100):
    return await db.notifications.find({'user_id': user['id']}, {'_id': 0}).sort('created_at', -1).to_list(limit)


@router.get('/notifications/unread-count')
async def notifications_unread_count(user=Depends(get_current)):
    count = await db.notifications.count_documents({'user_id': user['id'], 'read': False})
    return {'count': count}


@router.post('/notifications/{nid}/read')
async def mark_notification_read(nid: str, user=Depends(get_current)):
    await db.notifications.update_one({'id': nid, 'user_id': user['id']}, {'$set': {'read': True}})
    return {'ok': True}


@router.post('/notifications/read-all')
async def mark_all_notifications_read(user=Depends(get_current)):
    await db.notifications.update_many({'user_id': user['id'], 'read': False}, {'$set': {'read': True}})
    return {'ok': True}


@router.delete('/notifications/{nid}')
async def delete_notification(nid: str, user=Depends(get_current)):
    """Remove one of your own notifications."""
    await db.notifications.delete_one({'id': nid, 'user_id': user['id']})
    return {'ok': True}


@router.delete('/notifications')
async def clear_notifications(user=Depends(get_current)):
    """Remove all of your own notifications."""
    res = await db.notifications.delete_many({'user_id': user['id']})
    return {'ok': True, 'deleted': res.deleted_count}
