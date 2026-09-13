"""System Health

One page that answers "is everything actually working right now" without
digging through logs or RDP-ing into the server: MongoDB, the Windows
services this app runs as, WhatsApp, the thermal printer, Google Drive +
its photo/document upload backlog, and every registered biometric device.

Extracted-router pattern (§2.1 router split) — nothing here duplicates the
underlying checks; it re-reads the same collections/helpers the rest of the
app already uses (get_whatsapp_status, drive_service, biometric_devices,
system_health_state) so this can never drift from what actually triggers a
real alert elsewhere."""
import asyncio
import platform
import socket
import time
from fastapi import APIRouter, Depends
from server import (
    db,
    now_utc,
    APP_START_TIME,
    require_owner,
    require_module,
    get_whatsapp_status,
    WEBPUSH_AVAILABLE,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
)
from routers.biometric import DEVICE_OFFLINE_HOURS

router = APIRouter()

# The Windows services this app is installed as (see
# restore-services-after-reinstall.ps1) — hardcoded because this app runs as
# a fixed single-tenant deployment on one known box, not a fleet.
WINDOWS_SERVICES = [
    ('RMJOneBackend', 'Backend API'),
    ('RMJOneWeb', 'Frontend Web'),
    ('RMJOneWhatsApp', 'WhatsApp Gateway (OpenWA)'),
    ('cloudflared', 'Cloudflare Tunnel'),
    ('RMJOneRunner', 'GitHub Actions Runner'),
]


def _check_windows_services_sync() -> list:
    if platform.system() != 'Windows':
        return []
    import subprocess
    out = []
    for name, label in WINDOWS_SERVICES:
        status = 'unknown'
        try:
            res = subprocess.run(['sc', 'query', name], capture_output=True, text=True, timeout=5)
            text = (res.stdout or '') + (res.stderr or '')
            if 'does not exist' in text or '1060' in text:
                status = 'not_installed'
            else:
                for line in text.splitlines():
                    if 'STATE' in line:
                        if 'RUNNING' in line: status = 'running'
                        elif 'STOP_PENDING' in line or 'START_PENDING' in line: status = 'pending'
                        elif 'STOPPED' in line: status = 'stopped'
                        elif 'PAUSED' in line: status = 'paused'
                        break
        except Exception:
            status = 'unknown'
        out.append({'name': name, 'label': label, 'status': status})
    return out


def _check_printer_sync(ip: str, port: int, timeout: float = 3.0) -> bool:
    """A bare TCP connect/disconnect — no bytes sent, so this can never
    trigger a stray print, unlike actually sending an ESC/POS job."""
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except Exception:
        return False


async def _upload_queue_counts(collection: str) -> dict:
    coll = db[collection]
    states = ('queued', 'uploading', 'failed', 'local')
    counts = await asyncio.gather(*(
        coll.count_documents({'upload_state': s, 'deleted': {'$ne': True}}) for s in states
    ))
    return dict(zip(states, counts))


@router.get('/system/health')
async def system_health(user=Depends(require_owner), _mod=Depends(require_module('system_health'))):
    now = now_utc()

    # ---- MongoDB: round-trip latency + current storage footprint ----
    mongo = {'ok': False, 'latency_ms': None, 'data_size_bytes': None, 'storage_size_bytes': None, 'error': None}
    try:
        t0 = time.monotonic()
        await asyncio.wait_for(db.command('ping'), timeout=5)
        mongo['latency_ms'] = round((time.monotonic() - t0) * 1000, 1)
        mongo['ok'] = True
        stats = await db.command('dbStats')
        mongo['data_size_bytes'] = int(stats.get('dataSize', 0))
        mongo['storage_size_bytes'] = int(stats.get('storageSize', 0))
    except Exception as e:
        mongo['error'] = str(e)

    # ---- Windows services this app is installed as ----
    services = await asyncio.to_thread(_check_windows_services_sync)

    # ---- WhatsApp gateway ----
    whatsapp = await get_whatsapp_status()

    # ---- Thermal printer: live reachability, not just last-print result ----
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    printer_ip = store.get('printer_ip')
    printer_port = store.get('printer_port') or 9100
    printer = {'configured': bool(printer_ip), 'ip': printer_ip, 'port': printer_port, 'reachable': None}
    if printer_ip:
        printer['reachable'] = await asyncio.to_thread(_check_printer_sync, printer_ip, printer_port)

    # ---- Google Drive (also backs Documents + Photos) ----
    drive_cfg, env_ready = {}, False
    try:
        import drive_service
        drive_cfg = await drive_service.get_config()
        env_ready = drive_service.env_ready()
    except Exception:
        pass
    google_drive = {
        'connected': bool(drive_cfg.get('refresh_token')),
        'email': drive_cfg.get('email'),
        'env_ready': env_ready,
        'connected_at': drive_cfg.get('connected_at'),
    }

    # ---- Photo / document sync backlog — the actual signal that Drive sync
    # is keeping up, not just "is a token present" ----
    sync_queue = {
        'photos': await _upload_queue_counts('record_photos'),
        'documents': await _upload_queue_counts('documents'),
    }

    # ---- Biometric devices ----
    devices = await db.biometric_devices.find({}, {'_id': 0, 'secret': 0}).sort('label', 1).to_list(200)
    offline_count = sum(1 for d in devices if d.get('status') == 'offline')

    # Last-alert timestamps from the same cooldown doc every _notify_system_health
    # call writes to — a rough "when did this last actually break" signal.
    health_state = await db.settings.find_one({'id': 'system_health_state'}, {'_id': 0}) or {}

    return {
        'generated_at': now.isoformat(),
        'system': {
            'uptime_seconds': int((now - APP_START_TIME).total_seconds()),
            'platform': platform.platform(),
        },
        'services': services,
        'mongodb': mongo,
        'whatsapp': {**whatsapp, 'last_disconnected_alert_at': health_state.get('whatsapp_disconnected')},
        'printer': {**printer, 'last_failure_at': health_state.get('printer_failed')},
        'google_drive': {
            **google_drive,
            'last_disconnected_alert_at': health_state.get('drive_disconnected'),
            'last_upload_failure_at': health_state.get('drive_upload_failed'),
        },
        'sync_queue': sync_queue,
        'biometric': {
            'devices': devices,
            'offline_count': offline_count,
            'offline_threshold_hours': DEVICE_OFFLINE_HOURS,
            'last_offline_alert_at': health_state.get('biometric_device_offline'),
        },
        'push_notifications': {'enabled': bool(WEBPUSH_AVAILABLE and VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)},
    }
