"""Daily reference gold + silver rate: fetch a supplier's published rates
once a day, let the owner confirm/adjust them (with a margin per metal) and
edit the message, then broadcast it to the shop's WhatsApp Channel.

The reference page (Ayodhya Jewellers, one of the shop's own suppliers) is a
JS-rendered live board — the rates never appear in the plain HTML, only after
a live feed pushes a value into the page — so fetching it means actually
rendering the page with Chrome, not a simple GET+parse. Reuses the Chrome
already installed for OpenWA (no separate browser download) via a small
Node/Puppeteer script (scripts/fetch_gold_rate.js).

Deliberately NOT auto-sent: the fetched numbers are a supplier's market/spot
rates, not necessarily what the shop charges (margin on top), so a human
confirms — and can adjust the rate, margin, or message — before anything
reaches the Channel's followers. See routers/settings.py for the endpoints
and send_whatsapp_channel() in server.py for the actual send.
"""
import asyncio
import json
import logging
import os

from server import db, now_utc, IST, GOLD_RATE_SOURCE_URL, GOLD_RATE_ROW_LABEL, GOLD_RATE_SILVER_LABEL

logger = logging.getLogger('gold_rate')

SCRIPT_PATH = os.path.join(os.path.dirname(__file__), 'scripts', 'fetch_gold_rate.js')
OPENWA_ENV_PATH = r'E:\OpenWA\.env'
OPENWA_NODE_MODULES = r'E:\OpenWA\node_modules'
DEFAULT_FETCH_TIME = '12:30'
DEFAULT_GOLD_MARGIN = 0
DEFAULT_SILVER_MARGIN = 0
GOLD_ROUND_TO = 50     # gold rate rounds to the nearest ₹50
SILVER_ROUND_TO = 100  # silver rate rounds to the nearest ₹100
POLL_SECONDS = 300


def today_ist() -> str:
    return now_utc().astimezone(IST).date().isoformat()


def round_to(value: int, nearest: int) -> int:
    return int(round(value / nearest) * nearest)


def _read_puppeteer_executable_path() -> str:
    """Reuse the Chrome path OpenWA is already configured with, read live
    from its .env so a Chrome version bump there doesn't need a matching
    change here too."""
    try:
        with open(OPENWA_ENV_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('PUPPETEER_EXECUTABLE_PATH='):
                    return line.split('=', 1)[1].strip()
    except OSError:
        pass
    return ''


async def fetch_rates_raw() -> dict:
    """Runs the headless-Chrome scraper. Returns
    {'ok': True, 'gold': {'rate': int, ...}, 'silver': {'rate': int, ...}}
    or {'ok': False, 'error': str} — never raises."""
    chrome_path = _read_puppeteer_executable_path()
    if not chrome_path:
        return {'ok': False, 'error': "Could not find OpenWA's Chrome path (E:\\OpenWA\\.env)"}
    env = {
        **os.environ,
        'PUPPETEER_EXECUTABLE_PATH': chrome_path,
        'NODE_PATH': OPENWA_NODE_MODULES,
        'GOLD_RATE_SOURCE_URL': GOLD_RATE_SOURCE_URL,
        'GOLD_RATE_ROW_LABEL': GOLD_RATE_ROW_LABEL,
        'GOLD_RATE_SILVER_LABEL': GOLD_RATE_SILVER_LABEL,
    }
    try:
        proc = await asyncio.create_subprocess_exec(
            'node', SCRIPT_PATH, env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=45)
        lines = stdout.decode('utf-8', 'ignore').strip().splitlines()
        line = lines[-1] if lines else ''
        if not line:
            return {'ok': False, 'error': stderr.decode('utf-8', 'ignore')[:300] or 'no output from fetch script'}
        return json.loads(line)
    except asyncio.TimeoutError:
        return {'ok': False, 'error': 'timed out fetching the rate page'}
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}


# Owner-editable from Settings > WhatsApp (`template` field on the
# gold_rate_config doc) — {gold_rate}/{silver_rate} are the only placeholders.
DEFAULT_TEMPLATE = (
    'Today approx. rate update: \n'
    'Gold 24k: {gold_rate} /tola\n'
    'Silver : {silver_rate} /kg\n'
    '\n'
    'Click bell icon above for notification \U0001F514'
)


async def get_config() -> dict:
    doc = await db.settings.find_one({'id': 'gold_rate_config'}, {'_id': 0}) or {}
    return {
        'fetch_time': doc.get('fetch_time') or DEFAULT_FETCH_TIME,
        'gold_margin': int(doc.get('gold_margin') or DEFAULT_GOLD_MARGIN),
        'silver_margin': int(doc.get('silver_margin') or DEFAULT_SILVER_MARGIN),
        'template': doc.get('template') or DEFAULT_TEMPLATE,
    }


async def default_message(gold_rate: int, silver_rate: int) -> str:
    cfg = await get_config()
    template = cfg['template']
    try:
        return template.format(gold_rate=gold_rate, silver_rate=silver_rate)
    except Exception:
        # A bad edit (typo'd placeholder) must not silently block every
        # future send — fall back to the known-good default.
        return DEFAULT_TEMPLATE.format(gold_rate=gold_rate, silver_rate=silver_rate)


async def run_fetch_and_store() -> dict:
    """Fetch, apply the configured margins + rounding, and store today's
    result — does NOT send anything, that's a separate explicit owner action
    (see routers/settings.py's /settings/gold-rate/send)."""
    cfg = await get_config()
    result = await fetch_rates_raw()
    date_str = today_ist()
    doc = {
        'id': 'gold_rate_today', 'date': date_str, 'fetched_at': now_utc().isoformat(),
        'manual': False, 'confirmed': False, 'sent_at': None,
    }
    if result.get('ok'):
        fetched_gold = int(result['gold']['rate'])
        fetched_silver = int(result['silver']['rate'])
        gold_rate = round_to(fetched_gold + int(cfg['gold_margin']), GOLD_ROUND_TO)
        silver_rate = round_to(fetched_silver + int(cfg['silver_margin']), SILVER_ROUND_TO)
        doc.update({
            'fetched_gold': fetched_gold, 'fetched_silver': fetched_silver,
            'gold_margin_applied': cfg['gold_margin'], 'silver_margin_applied': cfg['silver_margin'],
            'gold_rate': gold_rate, 'silver_rate': silver_rate, 'error': None,
            'message': await default_message(gold_rate, silver_rate),
        })
        logger.info(f'rates fetched: gold {fetched_gold}+{cfg["gold_margin"]}->{gold_rate}, silver {fetched_silver}+{cfg["silver_margin"]}->{silver_rate}')
    else:
        doc.update({
            'fetched_gold': None, 'fetched_silver': None, 'gold_margin_applied': None, 'silver_margin_applied': None,
            'gold_rate': None, 'silver_rate': None, 'error': result.get('error') or 'fetch failed', 'message': None,
        })
        logger.warning(f"gold/silver rate fetch failed: {doc['error']}")
    await db.settings.update_one({'id': 'gold_rate_today'}, {'$set': doc}, upsert=True)
    return doc


async def gold_rate_loop():
    """Once a day, at the configured fetch_time (IST), fetch and store —
    checked every 5 minutes so a server restart near the target time still
    catches it, and retried on the same cadence if a fetch failed (transient
    site hiccup) until it succeeds or the owner enters rates manually (which
    also marks today done). Never sends on its own."""
    await asyncio.sleep(60)   # let startup settle
    while True:
        try:
            cfg = await get_config()
            fetch_time = cfg.get('fetch_time') or DEFAULT_FETCH_TIME
            hh, mm = (int(x) for x in fetch_time.split(':'))
            now_ist = now_utc().astimezone(IST)
            today = today_ist()
            existing = await db.settings.find_one({'id': 'gold_rate_today'}, {'_id': 0})
            done_ok = bool(existing and existing.get('date') == today and not existing.get('error'))
            due = now_ist.hour > hh or (now_ist.hour == hh and now_ist.minute >= mm)
            if due and not done_ok:
                await run_fetch_and_store()
        except Exception as e:
            logger.warning(f'gold rate loop error: {e}')
        await asyncio.sleep(POLL_SECONDS)
