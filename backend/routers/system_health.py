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
import os
import pathlib
import platform
import shutil
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
from datetime import datetime, timezone
from routers.biometric import DEVICE_OFFLINE_HOURS

router = APIRouter()

# The Windows services this app is installed as (see
# restore-services-after-reinstall.ps1) — hardcoded because this app runs as
# a fixed single-tenant deployment on one known box, not a fleet.
WINDOWS_SERVICES = [
    ('RMJOneMongo', 'Database (MongoDB)'),
    ('RMJOneBackend', 'Backend API'),
    ('RMJOneWeb', 'Frontend Web'),
    ('RMJOneWhatsApp', 'WhatsApp Gateway (OpenWA)'),
    ('cloudflared', 'Cloudflare Tunnel'),
    ('RMJOneRunner', 'GitHub Actions Runner'),
]


def _check_one_service_sync(name: str, label: str) -> dict:
    import subprocess
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
    return {'name': name, 'label': label, 'status': status}


async def _check_windows_services() -> list:
    if platform.system() != 'Windows':
        return []
    return list(await asyncio.gather(*(asyncio.to_thread(_check_one_service_sync, n, l) for n, l in WINDOWS_SERVICES)))


def _check_printer_sync(ip: str, port: int, timeout: float = 1.0) -> bool:
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


# The nightly backup task ("RMJOne Mongo Backup", ops/backup) writes here; the backend sends the
# files to Google Drive (backup_service.upload_system_backups).
BACKUP_DIR = pathlib.Path(os.environ.get('SYSTEM_BACKUP_DIR', 'D:/RMJ-One/mongodb/backups'))
BACKUP_LOG = pathlib.Path('D:/RMJ-One/mongodb/log/backup.log')


def _disk_info_sync() -> list:
    out = []
    here = pathlib.Path(__file__).resolve()
    seen = set()
    for label, path in (('Server drive (app & data)', here.drive + '\\' if here.drive else '/'), ('Database & backups', str(BACKUP_DIR.anchor or BACKUP_DIR))):
        if path in seen:
            continue
        seen.add(path)
        try:
            u = shutil.disk_usage(path)
            out.append({'label': label, 'path': path, 'total': u.total, 'free': u.free})
        except Exception:
            pass
    return out


def _dir_size_sync(d: pathlib.Path) -> dict:
    n = size = 0
    try:
        for f in d.iterdir():
            if f.is_file():
                n += 1
                size += f.stat().st_size
    except Exception:
        pass
    return {'files': n, 'bytes': size}


def _local_backups_sync() -> dict:
    """Newest database dump / config bundle on disk and the last line the nightly task logged."""
    def newest(pattern):
        try:
            fs = sorted(BACKUP_DIR.glob(pattern), key=lambda f: f.stat().st_mtime, reverse=True)
            if not fs:
                return None
            st = fs[0].stat()
            return {'name': fs[0].name, 'bytes': st.st_size, 'at': datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(), 'count': len(fs)}
        except Exception:
            return None
    last_line = None
    try:
        with open(BACKUP_LOG, 'rb') as fh:
            fh.seek(0, 2)
            fh.seek(max(0, fh.tell() - 600))
            lines = fh.read().decode('utf-8', 'replace').strip().splitlines()
            last_line = lines[-1] if lines else None
    except Exception:
        pass
    return {'dump': newest('rmj_one-*.gz'), 'config': newest('config-*.zip'), 'log_last': last_line}


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
        try:
            mongo['version'] = (await db.client.server_info()).get('version')
        except Exception:
            pass
        stats = await db.command('dbStats')
        mongo['data_size_bytes'] = int(stats.get('dataSize', 0))
        mongo['storage_size_bytes'] = int(stats.get('storageSize', 0))
    except Exception as e:
        mongo['error'] = str(e)

    # ---- Windows services this app is installed as ----
    services_task = asyncio.ensure_future(_check_windows_services())
    disk_task = asyncio.ensure_future(asyncio.to_thread(_disk_info_sync))
    backups_task = asyncio.ensure_future(asyncio.to_thread(_local_backups_sync))
    cache_task = asyncio.ensure_future(asyncio.to_thread(_dir_size_sync, pathlib.Path(__file__).resolve().parent.parent / 'data' / 'doc_cache'))

    # ---- WhatsApp gateway ----
    whatsapp = await get_whatsapp_status()

    # ---- Thermal printer: live reachability, not just last-print result ----
    store = await db.settings.find_one({'id': 'store'}, {'_id': 0}) or {}
    printer_ip = store.get('printer_ip')
    printer_port = store.get('printer_port') or 9100
    printer = {'configured': bool(printer_ip), 'ip': printer_ip, 'port': printer_port, 'reachable': None}
    printer_task = asyncio.ensure_future(asyncio.to_thread(_check_printer_sync, printer_ip, printer_port)) if printer_ip else None

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
        'auth_error': drive_cfg.get('auth_error'),
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
    sys_backup = await db.settings.find_one({'id': 'system_backup'}, {'_id': 0}) or {}
    led_cfg = await db.settings.find_one({'id': 'led_board'}, {'_id': 0}) or {}
    led_st = await db.settings.find_one({'id': 'led_board_status'}, {'_id': 0}) or {}

    services = await services_task
    if printer_task:
        printer['reachable'] = await printer_task
    local_backups = await backups_task

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
        'disk': await disk_task,
        'doc_cache': await cache_task,
        'backups': {
            **local_backups,
            'drive_last_sent_at': sys_backup.get('last_sent_at'), 'drive_last_sent': sys_backup.get('last_sent'),
            'drive_last_check_at': sys_backup.get('last_check_at'), 'drive_error': sys_backup.get('last_error'),
        },
        'led_board': {
            'enabled': bool(led_cfg.get('enabled')), 'driver': led_cfg.get('driver') or 'simulator', 'host': led_cfg.get('host') or None,
            'last_push_at': led_st.get('last_push_at'), 'last_ok': led_st.get('last_ok'), 'last_error': led_st.get('last_error'),
        },
    }
