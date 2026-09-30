"""An employee's own attendance alerts (missed check-in, missed check-out,
marked absent, correction and leave decisions) arrive by push only unless
that employee is set to get one by WhatsApp. Runs the real code in-process
with the push/WhatsApp senders swapped for recorders. Needs a real MongoDB
(CI has one)."""
import asyncio
import os
import uuid
from datetime import datetime, timezone

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get('MONGO_URL'), reason='needs a real MongoDB (MONGO_URL)')

DAY = '2031-01-06'  # a Monday far from any real data


def test_employee_attendance_alerts_follow_channel_choice(monkeypatch):
    import server
    from routers import attendance as att
    from motor.motor_asyncio import AsyncIOMotorClient

    push, wa = [], []

    async def fake_push(subs, title, body, url):
        push.extend((s['user_id'], title) for s in subs)

    async def fake_wa(account_id, title, body):
        wa.append((account_id, title))

    monkeypatch.setattr(server, '_send_push_to_subs', fake_push)
    monkeypatch.setattr(server, '_notify_whatsapp', fake_wa)

    emp_id = f'test-emp-{uuid.uuid4().hex[:8]}'
    admin = {'id': 'test-admin', 'name': 'Test Admin', 'role': 'owner'}

    def at(hh, mm):  # IST wall-clock time on DAY, as the UTC "now"
        ist = datetime.fromisoformat(f'{DAY}T{hh:02d}:{mm:02d}:00+05:30')
        return lambda: ist.astimezone(timezone.utc)

    async def settle():
        for _ in range(20):  # notify_user runs as background tasks
            await asyncio.sleep(0.02)

    def got(title):
        return (emp_id, title) in push

    async def go():
        # A client on this test's own event loop, for the code under test too.
        db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ.get('DB_NAME', 'rmj')]
        monkeypatch.setattr(server, 'db', db)
        monkeypatch.setattr(att, 'db', db)
        await db.holidays.delete_many({'date': DAY})
        await db.employees.insert_one({
            'id': emp_id, 'name': 'Test Notif Emp', 'employee_code': 'TNE1', 'status': 'active',
            'mobile': '9999999999', 'notifications_enabled': True,
            # Leave decisions switched to WhatsApp only; everything else left at the default.
            'notif_prefs': {'self_leave_decided': False}, 'notif_prefs_whatsapp': {'self_leave_decided': True},
        })
        await db.push_subscriptions.insert_one({'user_id': emp_id, 'role': 'employee', 'endpoint': f'https://push.test/{emp_id}'})
        try:
            # Missed check-in: 10:45, past a 10:00 start + 30 min grace, no punch.
            monkeypatch.setattr(server, 'now_utc', at(10, 45))
            await server._check_missed_attendance()
            await settle()
            assert got('Missed check-in')
            await server._check_missed_attendance()  # only once a day
            await settle()
            assert push.count((emp_id, 'Missed check-in')) == 1

            # Missed check-out: checked in, 20:05 is past 19:30 + 30 min.
            await db.attendance.insert_one({'id': str(uuid.uuid4()), 'employee_id': emp_id, 'date': DAY,
                                            'check_in': f'{DAY}T04:30:00+00:00', 'check_out': None, 'status': 'present'})
            monkeypatch.setattr(server, 'now_utc', at(20, 5))
            await server._check_missed_checkout()
            await settle()
            assert got('Missed check-out')

            # Marked absent: 21:05, and this time no check-in at all.
            await db.attendance.delete_many({'employee_id': emp_id})
            await db.absentee_summaries.delete_many({'date': DAY})
            monkeypatch.setattr(server, 'now_utc', at(21, 5))
            await server._check_daily_absentee_summary()
            await settle()
            assert got('Marked absent today')

            # Correction and leave decisions.
            cid, lid = str(uuid.uuid4()), str(uuid.uuid4())
            await db.corrections.insert_one({'id': cid, 'employee_id': emp_id, 'employee_code': 'TNE1',
                                             'date': DAY, 'status': 'pending'})
            await db.leaves.insert_one({'id': lid, 'employee_id': emp_id, 'employee_code': 'TNE1', 'leave_type': 'casual',
                                        'from_date': DAY, 'to_date': DAY, 'status': 'pending'})
            await att.decide_correction(cid, server.DecisionIn(action='reject'), admin)
            await att.decide_leave(lid, server.DecisionIn(action='approve'), admin)
            await settle()
            assert got('Correction rejected')
            assert not got('Leave approved')  # WhatsApp only for this one

            # Every one is in the employee's in-app notifications...
            titles = {n['title'] async for n in db.notifications.find({'user_id': emp_id})}
            assert {'Missed check-in', 'Missed check-out', 'Marked absent today', 'Correction rejected',
                    'Leave approved'} <= titles
            # ...and only the one switched to WhatsApp went by WhatsApp.
            assert [t for (u, t) in wa if u == emp_id] == ['Leave approved']
        finally:
            for coll in ('attendance', 'notifications', 'push_subscriptions', 'corrections', 'leaves', 'timeline'):
                await db[coll].delete_many({'$or': [{'employee_id': emp_id}, {'user_id': emp_id}]})
            await db.employees.delete_many({'id': emp_id})
            for coll in ('attendance_reminders', 'checkout_reminders', 'absentee_summaries'):
                await db[coll].delete_many({'date': DAY})

    asyncio.run(go())
