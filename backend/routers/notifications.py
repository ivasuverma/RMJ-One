"""Web push notifications

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends
import uuid
from server import (
    db,
    now_utc,
    get_current,
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
    return {'subscribed': count > 0}


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
