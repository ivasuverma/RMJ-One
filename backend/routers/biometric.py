"""Biometric devices: eSSL cloud push, ZKTeco/eSSL iClock ADMS protocol, eBioServer webhook

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from typing import Optional, Literal
from datetime import datetime, timezone, timedelta
import uuid
from server import (
    db,
    now_utc,
    require_owner,
    require_staff,
    require_module,
    _apply_punch,
    _notify_module,
    log_audit,
    IST,
)

router = APIRouter()
iclock_router = APIRouter()  # mounted directly on app, no /api prefix — real ADMS device protocol

# Minimum minutes required between two accepted biometric punches for the
# same employee before a new scan is treated as a real check-in/check-out
# toggle rather than the ADMS receiver re-processing the SAME record it just
# uploaded. Kept deliberately small: the eSSL device has its own "Duplicate
# Punch Period" (typically 300 min) that already collapses a single visit's
# repeat scans, so this server-side guard only needs to catch the ADMS
# getrequest re-uploading an identical punch (same timestamp, ~0 gap). A large
# value here DOUBLE-filters on top of the device and can swallow a legitimate
# second punch (e.g. an early check-out) — which is why it's 2, not 180.
PUNCH_COOLDOWN_MIN = 2

# On the ADMS re-query, this device re-dumps its whole stored log every poll,
# ignoring the StartTime/EndTime we send. Records older than this window are
# treated as already-handled re-dumps and skipped at intake (see iclock_upload)
# so they can't spam the log or re-toggle old days. Wide enough to still absorb
# a genuine multi-day device/network outage on reconnect.
BACKLOG_MAX_HOURS = 72

# ---------------- Biometric (eSSL Cloud Push) ----------------
class DeviceIn(BaseModel):
    serial: str
    label: str
    secret: str


class BiometricPushIn(BaseModel):
    serial: str
    secret: str
    user_id: str  # employee_code (as configured in eSSL device)
    timestamp: Optional[str] = None  # ISO; defaults to now
    event_type: Optional[Literal['check_in', 'check_out', 'auto']] = 'auto'
    verify_mode: Optional[str] = ''  # 'face', 'fingerprint', etc.


@router.get('/biometric/devices')
async def list_devices(_: dict = Depends(require_staff)):
    docs = await db.biometric_devices.find({}, {'_id': 0, 'secret': 0}).sort('created_at', 1).to_list(100)
    return docs


@router.post('/biometric/devices')
async def create_device(body: DeviceIn, user=Depends(require_owner), _mod=Depends(require_module('biometric'))):
    if await db.biometric_devices.find_one({'serial': body.serial}):
        raise HTTPException(status_code=400, detail='Device serial already registered')
    doc = {
        'id': str(uuid.uuid4()), 'serial': body.serial.strip(), 'label': body.label.strip(),
        'secret': body.secret, 'created_at': now_utc().isoformat(),
        'last_seen': None, 'status': 'idle',
    }
    await db.biometric_devices.insert_one(dict(doc))
    await log_audit(user, 'biometric.device.create', 'device', doc['id'], body.serial)
    return {k: v for k, v in doc.items() if k not in ('_id', 'secret')}


@router.post('/biometric/devices/{did}/pull')
async def pull_device(did: str, user=Depends(require_owner), _mod=Depends(require_module('biometric'))):
    """Queue a one-shot 'send me everything' for this device. The device only
    talks to us when IT polls (ADMS is device-initiated), so we can't reach out
    live — instead we set a flag that the next iclock/getrequest poll turns into
    a full-history ATTLOG query. The 72h intake filter still drops stale
    re-dumps, so this safely pulls just the recent punches the device is holding.
    Poll interval is ~10s, so it takes effect almost immediately."""
    d = await db.biometric_devices.find_one({'id': did}, {'_id': 0})
    if not d: raise HTTPException(status_code=404, detail='Device not found')
    await db.biometric_devices.update_one({'id': did}, {'$set': {'force_pull': True}})
    await log_audit(user, 'biometric.device.pull', 'device', did, d.get('serial', ''))
    return {'ok': True, 'note': 'The device will re-send its recent punches on its next check-in (usually within a few seconds).'}


@router.delete('/biometric/devices/{did}')
async def delete_device(did: str, user=Depends(require_owner), _mod=Depends(require_module('biometric'))):
    d = await db.biometric_devices.find_one({'id': did}, {'_id': 0})
    if not d: raise HTTPException(status_code=404, detail='Device not found')
    await db.biometric_devices.delete_one({'id': did})
    await log_audit(user, 'biometric.device.delete', 'device', did, d.get('serial', ''))
    return {'ok': True}


@router.get('/biometric/logs')
async def biometric_logs(limit: int = 100, _: dict = Depends(require_staff)):
    return await db.biometric_logs.find({}, {'_id': 0}).sort('created_at', -1).limit(limit).to_list(limit)


async def _ingest_biometric_punch(serial: str, user_id: str, ts: datetime, event_type: str = 'auto', verify_mode: str = '') -> dict:
    """Turn one (serial, user_id, timestamp) punch into an attendance
    check-in/check-out, however it arrived (custom JSON push, real
    ADMS/iClock upload, or the eBioServer webhook). Matches the device's
    user_id to an employee, then hands off to _apply_punch() — the same
    state machine the app's own check-in/check-out endpoints use — so a
    biometric punch and an app punch can never disagree on shift/late/
    half-day handling. This wrapper's own job is just employee matching and
    the biometric_logs audit trail."""
    log_doc = {
        'id': str(uuid.uuid4()), 'serial': serial, 'user_id': user_id,
        'timestamp': ts.isoformat(), 'event_type': event_type or 'auto',
        'verify_mode': verify_mode or '', 'created_at': now_utc().isoformat(),
    }

    # Match by biometric_id first (the device's own numeric/short ID, set per-employee
    # in the app when it doesn't line up with employee_code), then fall back to
    # employee_code directly (for setups where they were deliberately enrolled to match).
    emp = await db.employees.find_one({'biometric_id': user_id}, {'_id': 0, 'password_hash': 0})
    if not emp:
        emp = await db.employees.find_one({'employee_code': user_id.upper()}, {'_id': 0, 'password_hash': 0})
    if not emp:
        log_doc['result'] = 'rejected'; log_doc['reason'] = 'unknown_employee'
        await db.biometric_logs.insert_one(dict(log_doc))
        return {'ok': False, 'reason': 'unknown_employee', 'user_id': user_id}

    # Normalize to UTC before storing — same as the app path, which always
    # passes now_utc(). Devices/eBioServer hand us IST-labelled timestamps;
    # _apply_punch converts back to IST internally for date/lateness math
    # either way, so this only affects what's persisted, not the logic.
    #
    # A NAIVE timestamp (e.g. the /biometric/push or eBioServer webhook path,
    # where datetime.fromisoformat parsed a string with no offset) must be
    # read as IST — that is the documented device contract. Previously it fell
    # through to .astimezone(), which silently assumes the SERVER's local
    # timezone; on a UTC-hosted server that shifted every naive punch back
    # 5h30m, landing early-morning punches on the previous day. Pin naive
    # timestamps to IST so the result no longer depends on the host timezone.
    # (The iClock ADMS path already tags tzinfo=IST, so it is unaffected.)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=IST)
    norm_ts = ts.astimezone(timezone.utc)

    # Debounce: this device re-captures the same physical visit as multiple
    # separate scans a few seconds apart (confirmed in the field — back-to-
    # back punches produced a 0.01h 'half day' since 'auto' toggled straight
    # from check-in to check-out). Require at least PUNCH_COOLDOWN_MIN since
    # this employee's last accepted biometric punch before treating a new
    # scan as a real check-in/check-out; anything sooner is almost certainly
    # the same visit being re-captured, not a genuine quick check-out. Only
    # applies to the biometric path — the app's own check-in/check-out
    # buttons are deliberate user actions and aren't debounced.
    last = await db.attendance_events.find_one(
        {'employee_id': emp['id'], 'source': 'biometric'}, {'_id': 0}, sort=[('timestamp', -1)],
    )
    if last:
        try:
            gap_min = abs((norm_ts - datetime.fromisoformat(last['timestamp'])).total_seconds()) / 60
        except Exception:
            gap_min = None
        if gap_min is not None and gap_min < PUNCH_COOLDOWN_MIN:
            log_doc['result'] = 'skipped'; log_doc['reason'] = 'duplicate_punch_cooldown'
            await db.biometric_logs.insert_one(dict(log_doc))
            return {'ok': True, 'skipped': True, 'reason': 'duplicate_punch_cooldown'}

    result = await _apply_punch(emp, event_type or 'auto', norm_ts, {'source': 'biometric', 'device_serial': serial})

    if not result['ok']:
        reason = result['reason']
        if reason in ('already_checked_in', 'already_checked_out'):
            log_doc['result'] = 'skipped'; log_doc['reason'] = reason
            await db.biometric_logs.insert_one(dict(log_doc))
            return {'ok': True, 'skipped': True, 'reason': reason}
        log_doc['result'] = 'rejected'; log_doc['reason'] = reason
        await db.biometric_logs.insert_one(dict(log_doc))
        return {'ok': False, 'reason': reason, 'user_id': user_id}

    kind = result['kind']
    # last_seen = when we actually heard from the device (now), NOT the punch's
    # own timestamp — a re-dump of an old punch was making "Last seen" read as
    # the punch time (e.g. yesterday) instead of the live connection time.
    await db.biometric_devices.update_one({'serial': serial},
                                          {'$set': {'last_seen': now_utc().isoformat(), 'status': 'online'}})
    log_doc['result'] = 'accepted'; log_doc['action'] = kind; log_doc['attendance_id'] = result['attendance_id']
    log_doc['employee_id'] = emp['id']; log_doc['employee_name'] = emp['name']
    await db.biometric_logs.insert_one(dict(log_doc))

    # Notify owners/admins for genuinely LIVE punches only. The device re-dumps
    # its whole backlog on many polls, so an accepted punch can be hours or days
    # old — firing on those would spam stale "checked in" alerts. Only punches
    # within the last 15 minutes are treated as real-time, matching the app's
    # own check-in/out notifications (same scripts, so the same toggles apply).
    try:
        age_min = (now_utc() - norm_ts).total_seconds() / 60
    except Exception:
        age_min = 9999
    if -2 <= age_min <= 15:
        now_local = norm_ts.astimezone(IST)
        if kind == 'check_in':
            await _notify_module('attendance', f"{emp['name']} checked in",
                                 f"{now_local.strftime('%I:%M %p')}{' · Late' if result.get('is_late') else ''} · Biometric",
                                 '/(tabs)/attendance', script='attendance_checkin')
        elif kind == 'check_out':
            await _notify_module('attendance', f"{emp['name']} checked out",
                                 f"Worked {result.get('working_hours', 0)}h today · Biometric",
                                 '/(tabs)/attendance', script='attendance_checkout')
    return {'ok': True, 'action': kind, 'employee': emp['name'], 'attendance_id': result['attendance_id']}


@router.post('/biometric/push')
async def biometric_push(body: BiometricPushIn):
    # Called by a bridge script (e.g. biometric_bridge.py) — no bearer JWT;
    # validated via device serial + secret since it's not an ADMS-capable flow.
    device = await db.biometric_devices.find_one({'serial': body.serial}, {'_id': 0})
    if not device or device.get('secret') != body.secret:
        await db.biometric_logs.insert_one({
            'id': str(uuid.uuid4()), 'serial': body.serial, 'user_id': body.user_id,
            'timestamp': body.timestamp or now_utc().isoformat(), 'event_type': body.event_type or 'auto',
            'verify_mode': body.verify_mode or '', 'created_at': now_utc().isoformat(),
            'result': 'rejected', 'reason': 'invalid_device_credentials',
        })
        raise HTTPException(status_code=401, detail='Invalid device credentials')

    try:
        ts = datetime.fromisoformat(body.timestamp) if body.timestamp else now_utc()
    except Exception:
        ts = now_utc()
    result = await _ingest_biometric_punch(body.serial, body.user_id, ts, body.event_type or 'auto', body.verify_mode or '')
    if not result['ok'] and result.get('reason') == 'unknown_employee':
        raise HTTPException(status_code=404, detail=f'Unknown employee {body.user_id}')
    if not result['ok'] and result.get('reason') == 'no_check_in':
        raise HTTPException(status_code=400, detail='No check-in yet today')
    return result


# ---------------- Biometric (real eSSL/ZKTeco ADMS / iClock push protocol) ----------------
# This is the protocol the device itself speaks natively when you set
# Comm > Cloud Server Settings > Server Address/Port to point at this backend
# (Server Mode stays "ADMS" — that field usually can't be changed, and doesn't
# need to be). These routes are intentionally at the app root (not under /api)
# because the device hard-codes the /iclock/... paths — they're not configurable.
# No shared secret is used here (the protocol has no field for one); trust is
# "the device is on your LAN and its serial is registered" — same as any other
# local network appliance.

@iclock_router.get('/iclock/cdata')
@iclock_router.get('/iclock/cdata.aspx')
async def iclock_handshake(SN: str = Query(...)):
    """Device 'hello' on boot / periodic re-handshake. Tells it how often to
    push and what tables we want. A plain 200 with this shape is enough for
    it to start sending ATTLOG data."""
    await db.biometric_devices.update_one(
        {'serial': SN}, {'$set': {'last_seen': now_utc().isoformat(), 'status': 'online'}}
    )
    body = (
        "GET OPTION FROM: {sn}\r\n"
        "Stamp=9999\r\n"
        "OpStamp=9999\r\n"
        "ErrorDelay=30\r\n"
        "Delay=10\r\n"
        "TransFlag=TransData AttLog\r\n"
        "TransInterval=1\r\n"
        "Realtime=1\r\n"
        "Encrypt=None\r\n"
    ).format(sn=SN)
    return PlainTextResponse(body)


@iclock_router.post('/iclock/cdata')
@iclock_router.post('/iclock/cdata.aspx')
async def iclock_upload(request: Request, SN: str = Query(...), table: str = Query('ATTLOG')):
    """Device pushes punch data here. Body is plain text, one record per line,
    tab-separated: PIN<TAB>Time<TAB>Status<TAB>Verify<TAB>WorkCode..."""
    device = await db.biometric_devices.find_one({'serial': SN}, {'_id': 0})
    raw = (await request.body()).decode('utf-8', errors='ignore')
    if not device:
        # Log it anyway so it shows up in Settings > Biometric > Logs — makes it
        # obvious the device is reachable but just isn't registered yet.
        await db.biometric_logs.insert_one({
            'id': str(uuid.uuid4()), 'serial': SN, 'user_id': '', 'timestamp': now_utc().isoformat(),
            'event_type': 'auto', 'verify_mode': '', 'created_at': now_utc().isoformat(),
            'result': 'rejected', 'reason': 'unregistered_device',
        })
        return PlainTextResponse('OK')  # ack anyway — device will just keep retrying otherwise

    n = 0
    if table.upper() == 'ATTLOG':
        for line in raw.splitlines():
            parts = line.strip().split('\t')
            if len(parts) < 2:
                continue
            pin, time_str = parts[0].strip(), parts[1].strip()
            if not pin or not time_str:
                continue
            try:
                ts = datetime.strptime(time_str, '%Y-%m-%d %H:%M:%S').replace(
                    tzinfo=IST
                )
            except Exception:
                continue
            # Ignore ancient records. This device re-dumps its ENTIRE stored
            # attendance log on every poll (it doesn't honour the StartTime/
            # EndTime on our DATA QUERY), so a backlog going back days — much of
            # it already recorded or manually-edited (and thus rejected) — is
            # re-processed over and over, spamming biometric_logs and crowding
            # out the day's real punches. Anything older than the backlog window
            # is a re-dump we've already handled: skip it silently (no ingest,
            # no log row) so only genuinely recent punches flow through. A real
            # multi-day outage still resyncs everything within this window.
            if ts < now_utc() - timedelta(hours=BACKLOG_MAX_HOURS):
                continue
            # parts[2] is the device's own Status/in-out code when present
            # (0=Check In, 1=Check Out on eSSL/ZKTeco ADMS firmware — the
            # rest, 2-5, are break/OT variants we don't distinguish and
            # fall back to 'auto' for). Previously this was ignored
            # entirely and every punch went through as 'auto' (toggle
            # whichever of check-in/check-out is still open) — fragile,
            # because ANY extra scan more than PUNCH_COOLDOWN_MIN after the
            # last one (a stray re-scan, a curious walk-past, a retry after
            # a failed verify) silently flips the day to "checked out" and
            # then locks out the real evening check-out with
            # 'already_checked_in'. Trusting the device's own Status code
            # when it sends one avoids that entirely.
            event_type = 'auto'
            if len(parts) >= 3:
                status_code = parts[2].strip()
                if status_code == '0':
                    event_type = 'check_in'
                elif status_code == '1':
                    event_type = 'check_out'
            await _ingest_biometric_punch(SN, pin, ts, event_type)
            n += 1
    return PlainTextResponse(f'OK: {n}')


@iclock_router.get('/iclock/getrequest')
@iclock_router.get('/iclock/getrequest.aspx')
async def iclock_getrequest(SN: str = Query(...)):
    """Device polls this periodically asking 'any commands for me?'. Some
    ADMS firmwares (confirmed on at least one eSSL model in the field) don't
    actually push new ATTLOG records on their own even with Realtime=1 in the
    handshake — they sit on captured punches until the server explicitly
    asks for them here. So instead of always saying 'no commands', ask a
    registered device to upload its attendance log on every poll. This is
    idempotent: the device only has new data to send when there's actually a
    new punch, so a device that already pushes spontaneously just no-ops on
    an empty query. Command id is fixed at 1 since we never track command
    acks (devicecmd below accepts anything).

    StartTime is a rolling 48h window, not an all-time query: the first-ever
    query after this feature shipped intentionally asked for everything
    (StartTime=2000-01-01) to drain whatever backlog a device had accumulated
    while it couldn't reach the server — confirmed in the field this pulled
    in real punches going back to March that had never synced. That one-time
    full drain already happened, so a 48h window is enough going forward
    (covers this poll plus any missed polls from a brief outage) without
    risking a full historical re-backfill on every request."""
    device = await db.biometric_devices.find_one({'serial': SN}, {'_id': 0})
    if not device:
        return PlainTextResponse('OK')
    # The device compares StartTime/EndTime against its OWN clock, which is set
    # to IST — so the window must be expressed in IST, not UTC. Computing it
    # from now_utc() sent a window shifted 5h30m behind what the device's clock
    # reads, which could clip the current day's punches out of the query near
    # the day boundary. Build the window in IST to match the device.
    now_ist = now_utc().astimezone(IST)
    end = (now_ist + timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S')
    if device.get('force_pull'):
        # A "Sync now" was requested from the app — pull the full history once,
        # then clear the flag. The 72h intake filter keeps only recent punches.
        await db.biometric_devices.update_one({'serial': SN}, {'$set': {'force_pull': False}})
        start = '2000-01-01 00:00:00'
    else:
        start = (now_ist - timedelta(hours=48)).strftime('%Y-%m-%d %H:%M:%S')
    return PlainTextResponse(f'C:1:DATA QUERY ATTLOG StartTime={start} EndTime={end}')


@iclock_router.post('/iclock/devicecmd')
@iclock_router.post('/iclock/devicecmd.aspx')
async def iclock_devicecmd(request: Request):
    """Device posts the result of a command we supposedly sent. We don't send
    any, but must still 200 or the device logs errors."""
    await request.body()
    return PlainTextResponse('OK')


# ---------------- Biometric (eBioServer webhook) ----------------
# A third path into the same attendance pipeline, for shops running eSSL's
# eBioServer middleware app on a Windows PC between the fingerprint device
# and RMJ-One (used when the device itself can't be pointed at a custom
# server via ADMS/iClock — e.g. it only supports eBioServer's own cloud/local
# push). eBioServer's Master Settings has a single "Web URL" field for the
# whole app, POSTed to on every punch. Per eSSL's Web Hook manual (v1.1):
#   plain mode:     {"UserId","LogDateTime","SerialNumber","TransactionMode","Direction"}
#   encrypted mode: {"data": "<base64 AES>"}  — key is a 32-char string set
#                    in eBioServer, but the manual never specifies cipher
#                    mode/IV, so we can't decrypt it reliably. We only
#                    support the plain ("without password") mode — leave the
#                    Symmetric Key blank in eBioServer's Web Hook settings.
# Both modes are told by eSSL to always get back {"StatusCode":"200",...},
# so we never raise here — reject/accept is recorded in biometric_logs
# instead (Settings > Biometric > Logs), same pattern as the ADMS receiver.
class EBioServerWebhookIn(BaseModel):
    UserId: Optional[str] = None
    LogDateTime: Optional[str] = None
    SerialNumber: Optional[str] = None
    TransactionMode: Optional[str] = None
    Direction: Optional[str] = None
    data: Optional[str] = None  # present only in encrypted mode (unsupported)


_EBIOSERVER_ACK = {'StatusCode': '200', 'Message': 'Success'}


@router.post('/biometric/ebioserver-webhook')
async def ebioserver_webhook(body: EBioServerWebhookIn, key: Optional[str] = Query(None)):
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    configured_secret = store.get('biometric_webhook_secret')
    if configured_secret and key != configured_secret:
        await db.biometric_logs.insert_one({
            'id': str(uuid.uuid4()), 'serial': body.SerialNumber or '', 'user_id': body.UserId or '',
            'timestamp': body.LogDateTime or now_utc().isoformat(), 'event_type': 'auto',
            'verify_mode': body.TransactionMode or '', 'created_at': now_utc().isoformat(),
            'result': 'rejected', 'reason': 'invalid_webhook_key',
        })
        # Still ack 200 — eBioServer has no real retry/backoff handling to
        # speak of, and a non-200 just makes it spam retries. The rejection
        # is visible in the logs screen instead.
        return _EBIOSERVER_ACK

    if body.data and not body.UserId:
        await db.biometric_logs.insert_one({
            'id': str(uuid.uuid4()), 'serial': body.SerialNumber or '', 'user_id': '',
            'timestamp': now_utc().isoformat(), 'event_type': 'auto', 'verify_mode': '',
            'created_at': now_utc().isoformat(), 'result': 'rejected', 'reason': 'encrypted_mode_unsupported',
        })
        return _EBIOSERVER_ACK

    if not body.UserId or not body.LogDateTime:
        await db.biometric_logs.insert_one({
            'id': str(uuid.uuid4()), 'serial': body.SerialNumber or '', 'user_id': body.UserId or '',
            'timestamp': now_utc().isoformat(), 'event_type': 'auto', 'verify_mode': body.TransactionMode or '',
            'created_at': now_utc().isoformat(), 'result': 'rejected', 'reason': 'missing_fields',
        })
        return _EBIOSERVER_ACK

    try:
        ts = datetime.strptime(body.LogDateTime, '%Y-%m-%d %H:%M:%S').replace(
            tzinfo=IST
        )
    except Exception:
        ts = now_utc()

    # No Direction/in-out field is actually populated in eBioServer's own
    # examples — TransactionMode is a verify-method label (e.g. "VS_FP"),
    # not a direction — so we auto-toggle check-in/check-out exactly like
    # the ADMS receiver does.
    await _ingest_biometric_punch(
        body.SerialNumber or 'ebioserver', body.UserId, ts, 'auto', body.TransactionMode or ''
    )
    return _EBIOSERVER_ACK
