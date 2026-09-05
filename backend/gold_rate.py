"""Daily reference gold + silver rate: fetch a supplier's published rates
once a day, let the owner confirm/adjust them (with a margin per metal) and
edit the message, then broadcast it to the shop's WhatsApp Channel.

The reference page (Ayodhya Jewellers, one of the shop's own suppliers) is a
JS-rendered live board — the rates never appear in the plain HTML, only after
a live feed pushes a value into the page — so fetching it means actually
rendering the page with Chrome, not a simple GET+parse. Reuses the Chrome
already installed for OpenWA (no separate browser download) via a small
Node/Puppeteer script (scripts/fetch_gold_rate.js).

NOT auto-sent by default: the fetched numbers are a supplier's market/spot
rates, not necessarily what the shop charges (margin on top), so a human
confirms — and can adjust the rate, margin, or message — before anything
reaches the Channel's followers. An owner can opt into fully-automatic
sending (auto_send_enabled on the gold_rate_config doc) once they trust the
scrape; still off unless deliberately turned on. See routers/settings.py
for the endpoints and send_whatsapp_channel() in server.py for the actual
send.
"""
import asyncio
import json
import logging
import os
from datetime import datetime

from server import (
    db, now_utc, IST, format_ist_date_time, GOLD_RATE_SOURCE_URL, GOLD_RATE_ROW_LABEL, GOLD_RATE_SILVER_LABEL,
    GOLD_RATE_CHANNEL_ID, send_whatsapp_channel,
)

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

# Chatbot live-rate refresh — independent of the once-daily broadcast fetch
# above. Keeps gold_rate_live current so a customer texting RATE any time of
# day gets a close-to-live number, not whatever was scraped once at noon.
DEFAULT_CHATBOT_REFRESH_ENABLED = True
DEFAULT_CHATBOT_REFRESH_INTERVAL_MIN = 120
DEFAULT_CHATBOT_REFRESH_START = '12:30'
DEFAULT_CHATBOT_REFRESH_END = '19:00'

# Fully-automatic daily broadcast — off by default. The whole point of the
# confirm-before-send flow (see run_fetch_and_store's docstring) is a human
# look before anything reaches customers; this is an explicit, deliberate
# opt-out of that once the owner trusts the scrape enough (their call, not
# a default this app should ever pick for them).
DEFAULT_AUTO_SEND_ENABLED = False

# The reference source is a commodity-market feed — nothing moves Sat/Sun, so
# by default the loop doesn't bother fetching (would just re-scrape Friday's
# frozen value) and never auto-sends on those days even if a fetch happens
# anyway (e.g. someone hits "Fetch now" manually — see run_fetch_and_store).
DEFAULT_SKIP_WEEKEND_FETCH = True


def today_ist() -> str:
    return now_utc().astimezone(IST).date().isoformat()


def is_weekend_ist() -> bool:
    return now_utc().astimezone(IST).weekday() >= 5  # Mon=0 ... Sat=5, Sun=6


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
# gold_rate_config doc) — {gold_rate}/{silver_rate}/{date}/{time} are the
# only placeholders. date/time are the rate's fetch time (IST), same as the
# chatbot's RATE reply template (whatsapp_bot.py) — not left in this default
# text, but available to add.
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
        'chatbot_refresh_enabled': doc.get('chatbot_refresh_enabled', DEFAULT_CHATBOT_REFRESH_ENABLED),
        'chatbot_refresh_interval_min': int(doc.get('chatbot_refresh_interval_min') or DEFAULT_CHATBOT_REFRESH_INTERVAL_MIN),
        'chatbot_refresh_start': doc.get('chatbot_refresh_start') or DEFAULT_CHATBOT_REFRESH_START,
        'chatbot_refresh_end': doc.get('chatbot_refresh_end') or DEFAULT_CHATBOT_REFRESH_END,
        'auto_send_enabled': doc.get('auto_send_enabled', DEFAULT_AUTO_SEND_ENABLED),
        'skip_weekend_fetch': doc.get('skip_weekend_fetch', DEFAULT_SKIP_WEEKEND_FETCH),
    }


async def default_message(gold_rate: int, silver_rate: int, fetched_at: str = None) -> str:
    cfg = await get_config()
    template = cfg['template']
    date_str, time_str = format_ist_date_time(fetched_at)
    fields = {'gold_rate': gold_rate, 'silver_rate': silver_rate, 'date': date_str, 'time': time_str}
    try:
        return template.format(**fields)
    except Exception:
        # A bad edit (typo'd placeholder) must not silently block every
        # future send — fall back to the known-good default.
        return DEFAULT_TEMPLATE.format(**fields)


async def _store_live_rate(fetched_gold, fetched_silver, gold_rate, silver_rate, cfg: dict, fetched_at: str, error: str = None) -> None:
    """gold_rate_live is the chatbot's own cache — separate from
    gold_rate_today so a background refresh can never disturb an
    already-confirmed/sent broadcast or an in-progress edit on the Work-tab
    screen (that doc's confirmed/sent_at/message stay untouched)."""
    await db.settings.update_one({'id': 'gold_rate_live'}, {'$set': {
        'id': 'gold_rate_live', 'fetched_at': fetched_at, 'error': error,
        'fetched_gold': fetched_gold, 'fetched_silver': fetched_silver,
        'gold_margin_applied': cfg.get('gold_margin') if error is None else None,
        'silver_margin_applied': cfg.get('silver_margin') if error is None else None,
        'gold_rate': gold_rate, 'silver_rate': silver_rate,
    }}, upsert=True)


async def refresh_live_rate(cfg: dict = None) -> dict:
    """Chatbot-only background refresh — see _store_live_rate. Called on the
    gold_rate_loop's own poll cadence, independent of the daily broadcast
    fetch (though that one also mirrors into gold_rate_live on success, so
    this doesn't duplicate work at the same moment)."""
    if cfg is None:
        cfg = await get_config()
    result = await fetch_rates_raw()
    fetched_at = now_utc().isoformat()
    if result.get('ok'):
        fetched_gold = int(result['gold']['rate'])
        fetched_silver = int(result['silver']['rate'])
        gold_rate = round_to(fetched_gold + int(cfg['gold_margin']), GOLD_ROUND_TO)
        silver_rate = round_to(fetched_silver + int(cfg['silver_margin']), SILVER_ROUND_TO)
        await _store_live_rate(fetched_gold, fetched_silver, gold_rate, silver_rate, cfg, fetched_at)
        logger.info(f'live rate refreshed: gold {gold_rate}, silver {silver_rate}')
        return {'ok': True, 'gold_rate': gold_rate, 'silver_rate': silver_rate}
    error = result.get('error') or 'fetch failed'
    await _store_live_rate(None, None, None, None, cfg, fetched_at, error)
    logger.warning(f'live rate refresh failed: {error}')
    return {'ok': False, 'error': error}


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
            'message': await default_message(gold_rate, silver_rate, doc['fetched_at']),
        })
        logger.info(f'rates fetched: gold {fetched_gold}+{cfg["gold_margin"]}->{gold_rate}, silver {fetched_silver}+{cfg["silver_margin"]}->{silver_rate}')
        # Same scrape feeds the chatbot's cache too — no need for the
        # periodic refresh to launch a second Chrome at the same moment.
        await _store_live_rate(fetched_gold, fetched_silver, gold_rate, silver_rate, cfg, doc['fetched_at'])
        if cfg.get('auto_send_enabled') and is_weekend_ist():
            logger.info('gold rate auto-send skipped — weekend (market closed)')
        elif cfg.get('auto_send_enabled'):
            sent = await send_whatsapp_channel(GOLD_RATE_CHANNEL_ID, doc['message'])
            if sent:
                doc['confirmed'] = True
                doc['sent_at'] = now_utc().isoformat()
                logger.info('gold rate auto-sent to channel')
            else:
                logger.warning('gold rate auto-send failed — left unsent for manual review')
    else:
        doc.update({
            'fetched_gold': None, 'fetched_silver': None, 'gold_margin_applied': None, 'silver_margin_applied': None,
            'gold_rate': None, 'silver_rate': None, 'error': result.get('error') or 'fetch failed', 'message': None,
        })
        logger.warning(f"gold/silver rate fetch failed: {doc['error']}")
    await db.settings.update_one({'id': 'gold_rate_today'}, {'$set': doc}, upsert=True)
    return doc


async def _maybe_refresh_live_rate(cfg: dict) -> None:
    if not cfg.get('chatbot_refresh_enabled', DEFAULT_CHATBOT_REFRESH_ENABLED):
        return
    start = cfg.get('chatbot_refresh_start') or DEFAULT_CHATBOT_REFRESH_START
    end = cfg.get('chatbot_refresh_end') or DEFAULT_CHATBOT_REFRESH_END
    interval_min = int(cfg.get('chatbot_refresh_interval_min') or DEFAULT_CHATBOT_REFRESH_INTERVAL_MIN)
    try:
        sh, sm = (int(x) for x in start.split(':'))
        eh, em = (int(x) for x in end.split(':'))
    except Exception:
        return
    now_ist = now_utc().astimezone(IST)
    now_min = now_ist.hour * 60 + now_ist.minute
    if not (sh * 60 + sm <= now_min <= eh * 60 + em):
        return
    live = await db.settings.find_one({'id': 'gold_rate_live'}, {'_id': 0})
    if live and live.get('fetched_at'):
        try:
            last = datetime.fromisoformat(live['fetched_at'])
            if (now_utc() - last).total_seconds() < interval_min * 60:
                return
        except Exception:
            pass
    await refresh_live_rate(cfg)


async def gold_rate_loop():
    """Once a day, at the configured fetch_time (IST), fetch and store —
    checked every 5 minutes so a server restart near the target time still
    catches it, and retried on the same cadence if a fetch failed (transient
    site hiccup) until it succeeds or the owner enters rates manually (which
    also marks today done). Never sends on its own.

    Same loop also drives the chatbot's live-rate refresh (_maybe_refresh_
    live_rate) on its own independent schedule/window — see gold_rate_live
    vs gold_rate_today in _store_live_rate's docstring for why they're kept
    separate."""
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
            skip_today = cfg.get('skip_weekend_fetch', DEFAULT_SKIP_WEEKEND_FETCH) and is_weekend_ist()
            if due and not done_ok and not skip_today:
                await run_fetch_and_store()
            if not skip_today:
                await _maybe_refresh_live_rate(cfg)
        except Exception as e:
            logger.warning(f'gold rate loop error: {e}')
        await asyncio.sleep(POLL_SECONDS)
