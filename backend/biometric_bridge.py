"""
RMJ One — eSSL/ZKTeco biometric bridge.

eSSL devices (and the ZKTeco hardware most of them are built on) don't speak
plain HTTP — they expose a TCP protocol on port 4370 that you *poll* for
punch records. This script runs on a machine that's on the same LAN as the
device (normally the Windows Server, right next to the backend), polls the
device over TCP, and forwards each new punch to RMJ One's existing
`/api/biometric/push` endpoint — the same endpoint the "Biometric Devices"
screen in Settings already talks to.

Requires: pip install pyzk requests

--------------------------------------------------------------------------
STEP 1 — test the connection (no data is sent anywhere, read-only):

    python biometric_bridge.py --ip 192.168.1.50 --test

This connects to the device, prints its serial number + firmware, lists
every enrolled user ID (so you can confirm they match your RMJ One employee
codes), and shows how many attendance records are sitting on the device.

STEP 2 — once the test looks right, register the device in the app
(Settings → Biometric Devices → Register Device) using the serial number
printed by --test, a label, and a secret you make up. Then run continuous
sync:

    python biometric_bridge.py --ip 192.168.1.50 --serial A1B2C3D4 \
        --secret "the-secret-you-registered" \
        --backend-url https://rmjserver.faun-ilish.ts.net:8443/api

Leave that running (or install as a Windows service / Scheduled Task) and
punches will flow into RMJ One within one poll interval (default 30s).
--------------------------------------------------------------------------
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

try:
    from zk import ZK
except ImportError:
    sys.exit("Missing dependency. Run:  pip install pyzk requests")

try:
    import requests
except ImportError:
    sys.exit("Missing dependency. Run:  pip install pyzk requests")

STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'biometric_state.json')


def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_state(state: dict):
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)


def connect(ip: str, port: int, password: int, timeout: int = 10):
    zk = ZK(ip, port=port, timeout=timeout, password=password, force_udp=False, ommit_ping=False)
    return zk.connect()


def test_connection(args):
    print(f"Connecting to {args.ip}:{args.port} ...")
    conn = connect(args.ip, args.port, args.password)
    try:
        print("Connected.\n")
        try:
            print(f"  Serial number : {conn.get_serialnumber()}")
        except Exception:
            print("  Serial number : (device didn't report one — check the sticker/menu instead)")
        try:
            print(f"  Firmware      : {conn.get_firmware_version()}")
        except Exception:
            pass
        try:
            print(f"  Device name   : {conn.get_device_name()}")
        except Exception:
            pass

        users = conn.get_users()
        print(f"\n  Enrolled users ({len(users)}):")
        for u in users[:50]:
            print(f"    device user_id={u.user_id!r:12} name={u.name!r}")
        if len(users) > 50:
            print(f"    ... and {len(users) - 50} more")

        att = conn.get_attendance() or []
        print(f"\n  Attendance records on device: {len(att)}")
        if att:
            last = sorted(att, key=lambda a: a.timestamp)[-5:]
            print("  Most recent punches:")
            for a in last:
                print(f"    user_id={a.user_id!r:12} time={a.timestamp} status={a.status} punch={a.punch}")

        print(
            "\nNext: for every row above, the device user_id must match an RMJ One "
            "employee_code exactly (case-insensitive). Fix any mismatches on the "
            "device (or re-enroll with the right ID) before turning on sync."
        )
    finally:
        conn.disconnect()


def push_punch(base_url: str, serial: str, secret: str, user_id: str, timestamp: datetime):
    resp = requests.post(
        f"{base_url.rstrip('/')}/biometric/push",
        json={
            'serial': serial,
            'secret': secret,
            'user_id': user_id,
            'timestamp': timestamp.astimezone(timezone.utc).isoformat(),
            'event_type': 'auto',
        },
        timeout=15,
    )
    return resp


def sync_once(args, state: dict) -> int:
    conn = connect(args.ip, args.port, args.password)
    sent = 0
    try:
        att = conn.get_attendance() or []
    finally:
        conn.disconnect()

    watermark = state.get(args.serial, '1970-01-01T00:00:00')
    watermark_dt = datetime.fromisoformat(watermark)
    new_records = [a for a in att if a.timestamp.replace(tzinfo=None) > watermark_dt.replace(tzinfo=None)]
    new_records.sort(key=lambda a: a.timestamp)

    for a in new_records:
        uid = str(a.user_id).strip()
        try:
            resp = push_punch(args.backend_url, args.serial, args.secret, uid, a.timestamp)
            if resp.status_code == 200:
                body = resp.json()
                if body.get('skipped'):
                    print(f"  [skip] {uid} @ {a.timestamp} — {body.get('reason')}")
                else:
                    print(f"  [ok]   {uid} @ {a.timestamp} — {body.get('action')} for {body.get('employee')}")
                    sent += 1
            else:
                print(f"  [ERR]  {uid} @ {a.timestamp} — HTTP {resp.status_code}: {resp.text[:200]}")
        except requests.RequestException as e:
            print(f"  [ERR]  {uid} @ {a.timestamp} — {e}")
            continue  # leave watermark before this record so it's retried next cycle
        state[args.serial] = a.timestamp.isoformat()
        save_state(state)

    return sent


def main():
    p = argparse.ArgumentParser(description="RMJ One eSSL/ZKTeco biometric bridge")
    p.add_argument('--ip', required=True, help='Device IP address, e.g. 192.168.1.50')
    p.add_argument('--port', type=int, default=4370)
    p.add_argument('--password', type=int, default=0, help='Device comm password (default 0)')
    p.add_argument('--test', action='store_true', help='Connect, print device info + users, then exit (no push)')
    p.add_argument('--serial', help='Device serial as registered in RMJ One (Settings > Biometric Devices)')
    p.add_argument('--secret', help='Shared secret as registered in RMJ One')
    p.add_argument('--backend-url', default=os.environ.get('RMJ_BACKEND_URL', 'http://localhost:8000/api'))
    p.add_argument('--interval', type=int, default=30, help='Seconds between polls in continuous mode (default 30)')
    p.add_argument('--once', action='store_true', help='Sync one time and exit, instead of looping')
    args = p.parse_args()

    if args.test:
        test_connection(args)
        return

    if not args.serial or not args.secret:
        sys.exit("--serial and --secret are required for sync mode (use --test first to verify the connection).")

    state = load_state()
    print(f"Syncing {args.ip} -> {args.backend_url}  (serial={args.serial})")
    if args.once:
        n = sync_once(args, state)
        print(f"Done — {n} new punch(es) sent.")
        return

    print(f"Polling every {args.interval}s. Ctrl+C to stop.\n")
    while True:
        try:
            n = sync_once(args, state)
            if n:
                print(f"  -> {n} new punch(es) sent.")
        except Exception as e:
            print(f"  [ERR] sync cycle failed: {e}")
        time.sleep(args.interval)


if __name__ == '__main__':
    main()
