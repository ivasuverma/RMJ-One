"""Daily reference gold + silver rate: fetch a supplier's published rates
periodically through the day (see DEFAULT_REFRESH_* below), let the owner
confirm/adjust them (with a margin per metal) and edit the message, then
broadcast it to the shop's WhatsApp Channel.

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
    GOLD_RATE_XAU_LABEL, GOLD_RATE_XAG_LABEL, GOLD_RATE_USDINR_LABEL,
    GOLD_RATE_CHANNEL_ID, send_whatsapp_channel, _notify_module,
)

logger = logging.getLogger('gold_rate')

SCRIPT_PATH = os.path.join(os.path.dirname(__file__), 'scripts', 'fetch_gold_rate.js')
OPENWA_ENV_PATH = r'D:\RMJ-One\OpenWA\.env'
OPENWA_NODE_MODULES = r'D:\RMJ-One\OpenWA\node_modules'
DEFAULT_GOLD_MARGIN = 0
DEFAULT_SILVER_MARGIN = 0
# Subtracted from the sell rate (gold_rate/silver_rate above, margin already
# applied) to get what the public rates page shows as the buy rate — a
# separate, owner-set spread, not derived from the source page in any way.
DEFAULT_GOLD_BUY_MARGIN = 0
DEFAULT_SILVER_BUY_MARGIN = 0
GOLD_ROUND_TO = 50     # gold rate rounds to the nearest ₹50
SILVER_ROUND_TO = 100  # silver rate rounds to the nearest ₹100
POLL_SECONDS = 300

# One shared periodic schedule drives both gold_rate_live (the public rates
# page / dashboard tile / chatbot's RATE reply) and today's still-open
# broadcast draft (gold_rate_today) - every refresh_interval_min minutes,
# within the refresh_start-refresh_end window. gold_rate_live always gets
# the fresh value; gold_rate_today does too, EXCEPT once it's been confirmed
# or sent for the day, at which point this stops touching it - a background
# fetch must never disturb something the owner already reviewed/edited or
# already sent (see _auto_fetch_cycle). Used to be two independent
# schedules (a single once-daily fetch_time for the broadcast, a separate
# window for the chatbot) - merged into one so there's only one thing to
# configure and reason about.
DEFAULT_REFRESH_ENABLED = True
DEFAULT_REFRESH_INTERVAL_MIN = 120
DEFAULT_REFRESH_START = '12:30'
DEFAULT_REFRESH_END = '19:00'

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
    {'ok': True, 'gold': {'rate': int, ...}, 'silver': {'rate': int, ...},
    'xau': {...}|None, 'xag': {...}|None, 'usd_inr': {...}|None}
    or {'ok': False, 'error': str} — never raises. xau/xag/usd_inr are
    best-effort informational fields (see fetch_gold_rate.js) — a miss on
    those doesn't turn ok False."""
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
        'GOLD_RATE_XAU_LABEL': GOLD_RATE_XAU_LABEL,
        'GOLD_RATE_XAG_LABEL': GOLD_RATE_XAG_LABEL,
        'GOLD_RATE_USDINR_LABEL': GOLD_RATE_USDINR_LABEL,
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
        'gold_margin': int(doc.get('gold_margin') or DEFAULT_GOLD_MARGIN),
        'silver_margin': int(doc.get('silver_margin') or DEFAULT_SILVER_MARGIN),
        'gold_buy_margin': int(doc.get('gold_buy_margin') or DEFAULT_GOLD_BUY_MARGIN),
        'silver_buy_margin': int(doc.get('silver_buy_margin') or DEFAULT_SILVER_BUY_MARGIN),
        'template': doc.get('template') or DEFAULT_TEMPLATE,
        'refresh_enabled': doc.get('refresh_enabled', DEFAULT_REFRESH_ENABLED),
        'refresh_interval_min': int(doc.get('refresh_interval_min') or DEFAULT_REFRESH_INTERVAL_MIN),
        'refresh_start': doc.get('refresh_start') or DEFAULT_REFRESH_START,
        'refresh_end': doc.get('refresh_end') or DEFAULT_REFRESH_END,
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


def _buy_rate(sell_rate: int, buy_margin: int) -> int:
    """Buy = sell minus the owner's own configured spread — never derived
    from the source page (it has no buy-side concept RMJ-One uses), and
    never below 0 (a misconfigured margin bigger than the rate itself must
    not show a negative buy price on the public page)."""
    return max(0, sell_rate - int(buy_margin))


def _extract_extra(result: dict) -> dict:
    """xau/xag/usd_inr are best-effort informational fields — None on a miss
    rather than failing the whole fetch (see fetch_rates_raw's docstring).
    Also carries each row's raw scraped text (row_text, already returned by
    fetch_gold_rate.js) through to gold_rate_live purely for diagnosis - if
    a field goes stale or wrong again, this is what it actually read off the
    page that time, without needing to reproduce the scrape to find out."""
    def rate_of(key):
        row = result.get(key)
        return row.get('rate') if row else None

    def text_of(key):
        row = result.get(key)
        return row.get('row_text') if row else None
    return {
        'xau_usd': rate_of('xau'), 'xag_usd': rate_of('xag'), 'usd_inr': rate_of('usd_inr'),
        'gold_row_text': text_of('gold'), 'silver_row_text': text_of('silver'),
        'xau_row_text': text_of('xau'), 'xag_row_text': text_of('xag'),
    }


async def _store_live_rate(fetched_gold, fetched_silver, gold_rate, silver_rate, cfg: dict, fetched_at: str,
                            error: str = None, extra: dict = None) -> None:
    """gold_rate_live is the chatbot's own cache — separate from
    gold_rate_today so a background refresh can never disturb an
    already-confirmed/sent broadcast or an in-progress edit on the Work-tab
    screen (that doc's confirmed/sent_at/message stay untouched). Also the
    public rates page's source: gold_buy_rate/silver_buy_rate and
    xau_usd/xag_usd/usd_inr live here too, not on gold_rate_today, so the
    public page always reflects the latest scrape regardless of whether
    today's broadcast has been confirmed/sent yet.

    A None passed for any field here means "this attempt didn't get a new
    value for it" (a failed scrape, a missed xau/xag/usd_inr row, ...), NOT
    "clear whatever was there" — so those fields are left OUT of the $set
    entirely rather than written as None, and the document keeps its last
    known good value. `error`/`fetched_at` are the only fields that always
    get written, since they describe the latest ATTEMPT, not the latest
    success. (fetched_gold/fetched_silver/margins/gold_rate/silver_rate
    are all-or-nothing together — gold_rate is None exactly when the
    others are, so gating the whole group on it is equivalent to gating
    each one individually.)"""
    fields = {'id': 'gold_rate_live', 'fetched_at': fetched_at, 'error': error}
    if gold_rate is not None:
        fields.update({
            'fetched_gold': fetched_gold, 'fetched_silver': fetched_silver,
            'gold_margin_applied': cfg.get('gold_margin'), 'silver_margin_applied': cfg.get('silver_margin'),
            'gold_rate': gold_rate, 'silver_rate': silver_rate,
            'gold_buy_rate': _buy_rate(gold_rate, cfg['gold_buy_margin']),
            'silver_buy_rate': _buy_rate(silver_rate, cfg['silver_buy_margin']),
        })
    for k, v in (extra or {}).items():
        if v is not None:
            fields[k] = v
    await db.settings.update_one({'id': 'gold_rate_live'}, {'$set': fields}, upsert=True)


def _compute_rates(result: dict, cfg: dict) -> tuple:
    """Raw fetched values plus each with the owner's margin applied and
    rounded to the metal's own increment. Shared by the manual fetch and
    the periodic auto-fetch cycle."""
    fetched_gold = int(result['gold']['rate'])
    fetched_silver = int(result['silver']['rate'])
    gold_rate = round_to(fetched_gold + int(cfg['gold_margin']), GOLD_ROUND_TO)
    silver_rate = round_to(fetched_silver + int(cfg['silver_margin']), SILVER_ROUND_TO)
    return fetched_gold, fetched_silver, gold_rate, silver_rate


async def refresh_live_rate(cfg: dict = None) -> dict:
    """Fetches and stores into gold_rate_live only (never touches
    gold_rate_today) - the shared primitive behind the periodic auto-fetch
    cycle below AND led_board.py's own independent auto-push (which has its
    own window/interval config and just wants a fresh rate to put on the
    physical display, with no interest in the broadcast draft at all).
    Returns {'ok': True, 'gold_rate', 'silver_rate', 'fetched_gold',
    'fetched_silver', 'fetched_at'} or {'ok': False, 'error', 'fetched_at'}."""
    if cfg is None:
        cfg = await get_config()
    result = await fetch_rates_raw()
    fetched_at = now_utc().isoformat()
    if result.get('ok'):
        fetched_gold, fetched_silver, gold_rate, silver_rate = _compute_rates(result, cfg)
        await _store_live_rate(fetched_gold, fetched_silver, gold_rate, silver_rate, cfg, fetched_at, extra=_extract_extra(result))
        logger.info(f'live rate refreshed: gold {gold_rate}, silver {silver_rate}')
        return {
            'ok': True, 'gold_rate': gold_rate, 'silver_rate': silver_rate,
            'fetched_gold': fetched_gold, 'fetched_silver': fetched_silver, 'fetched_at': fetched_at,
        }
    error = result.get('error') or 'fetch failed'
    await _store_live_rate(None, None, None, None, cfg, fetched_at, error)
    logger.warning(f'live rate refresh failed: {error}')
    return {'ok': False, 'error': error, 'fetched_at': fetched_at}


async def _maybe_auto_send(doc: dict, gold_rate: int, silver_rate: int, cfg: dict) -> None:
    """If auto_send_enabled, sends today's message to the Channel and marks
    `doc` confirmed/sent in place - shared by the manual fetch and the
    periodic auto-fetch cycle, called before either's single write of the
    gold_rate_today doc."""
    if not cfg.get('auto_send_enabled'):
        return
    if is_weekend_ist():
        logger.info('gold rate auto-send skipped — weekend (market closed)')
        return
    sent = await send_whatsapp_channel(GOLD_RATE_CHANNEL_ID, doc['message'], flow='gold_rate_auto_send')
    if sent:
        doc['confirmed'] = True
        doc['sent_at'] = now_utc().isoformat()
        logger.info('gold rate auto-sent to channel')
        from routers.led_board import push_after_confirm
        await push_after_confirm(gold_rate, silver_rate, 'auto_send')
    else:
        logger.warning('gold rate auto-send failed — left unsent for manual review')


async def run_fetch_and_store() -> dict:
    """Fetch, apply the configured margins + rounding, and store today's
    result — unconditional overwrite of gold_rate_today regardless of
    confirmed/sent state, since this only ever runs from an explicit owner
    action (Rate Master's refetch, or the admin "Fetch New Rate" button on
    /rates), never from the background loop (see _auto_fetch_cycle for
    that, which does respect confirmed/sent)."""
    cfg = await get_config()
    result = await fetch_rates_raw()
    date_str = today_ist()
    doc = {
        'id': 'gold_rate_today', 'date': date_str, 'fetched_at': now_utc().isoformat(),
        'manual': False, 'confirmed': False, 'sent_at': None,
    }
    if result.get('ok'):
        fetched_gold, fetched_silver, gold_rate, silver_rate = _compute_rates(result, cfg)
        doc.update({
            'fetched_gold': fetched_gold, 'fetched_silver': fetched_silver,
            'gold_margin_applied': cfg['gold_margin'], 'silver_margin_applied': cfg['silver_margin'],
            'gold_rate': gold_rate, 'silver_rate': silver_rate, 'error': None,
            'message': await default_message(gold_rate, silver_rate, doc['fetched_at']),
        })
        logger.info(f'rates fetched: gold {fetched_gold}+{cfg["gold_margin"]}->{gold_rate}, silver {fetched_silver}+{cfg["silver_margin"]}->{silver_rate}')
        # Same scrape feeds the live cache too — no need for the periodic
        # cycle to launch a second Chrome at the same moment.
        await _store_live_rate(fetched_gold, fetched_silver, gold_rate, silver_rate, cfg, doc['fetched_at'], extra=_extract_extra(result))
        await _notify_module(
            'gold_rate', 'Gold Rate Updated',
            f"Gold ₹{gold_rate:,}/g · Silver ₹{silver_rate:,}/g", '/settings/whatsapp',
            script='gold_rate_fetched',
        )
        await _maybe_auto_send(doc, gold_rate, silver_rate, cfg)
    else:
        doc.update({
            'fetched_gold': None, 'fetched_silver': None, 'gold_margin_applied': None, 'silver_margin_applied': None,
            'gold_rate': None, 'silver_rate': None, 'error': result.get('error') or 'fetch failed', 'message': None,
        })
        logger.warning(f"gold/silver rate fetch failed: {doc['error']}")
    await db.settings.update_one({'id': 'gold_rate_today'}, {'$set': doc}, upsert=True)
    return doc


async def _should_auto_fetch(cfg: dict) -> bool:
    """Gate for the periodic auto-fetch: enabled, within the configured
    time window, and at least refresh_interval_min since the last fetch
    (gold_rate_live.fetched_at is the shared clock for this, since that
    field always updates on every cycle regardless of gold_rate_today's
    confirmed/sent state)."""
    if not cfg.get('refresh_enabled', DEFAULT_REFRESH_ENABLED):
        return False
    start = cfg.get('refresh_start') or DEFAULT_REFRESH_START
    end = cfg.get('refresh_end') or DEFAULT_REFRESH_END
    interval_min = int(cfg.get('refresh_interval_min') or DEFAULT_REFRESH_INTERVAL_MIN)
    try:
        sh, sm = (int(x) for x in start.split(':'))
        eh, em = (int(x) for x in end.split(':'))
    except Exception:
        return False
    now_ist = now_utc().astimezone(IST)
    now_min = now_ist.hour * 60 + now_ist.minute
    if not (sh * 60 + sm <= now_min <= eh * 60 + em):
        return False
    live = await db.settings.find_one({'id': 'gold_rate_live'}, {'_id': 0})
    if live and live.get('fetched_at'):
        try:
            last = datetime.fromisoformat(live['fetched_at'])
            if (now_utc() - last).total_seconds() < interval_min * 60:
                return False
        except Exception:
            pass
    return True


async def _auto_fetch_cycle(cfg: dict) -> None:
    """The one shared periodic fetch. Always refreshes gold_rate_live via
    refresh_live_rate (the public rates page / dashboard tile / chatbot's
    cache). Also refreshes today's still-open broadcast draft
    (gold_rate_today) - UNLESS it's already been confirmed or sent today,
    in which case this leaves it alone for the rest of the day (see
    _store_live_rate's docstring for why that protection matters: a
    background fetch must never disturb something the owner already
    reviewed/edited or already sent). A fetch that fails never overwrites
    an already-good unconfirmed draft from earlier the same day - only a
    day with no good draft yet gets the failure recorded, so a transient
    later hiccup can't wipe out a working morning fetch."""
    today = today_ist()
    existing = await db.settings.find_one({'id': 'gold_rate_today'}, {'_id': 0})
    today_locked = bool(existing and existing.get('date') == today and (existing.get('confirmed') or existing.get('sent_at')))

    res = await refresh_live_rate(cfg)
    if today_locked:
        return

    if res.get('ok'):
        gold_rate, silver_rate = res['gold_rate'], res['silver_rate']
        doc = {
            'id': 'gold_rate_today', 'date': today, 'fetched_at': res['fetched_at'],
            'manual': False, 'confirmed': False, 'sent_at': None,
            'fetched_gold': res['fetched_gold'], 'fetched_silver': res['fetched_silver'],
            'gold_margin_applied': cfg['gold_margin'], 'silver_margin_applied': cfg['silver_margin'],
            'gold_rate': gold_rate, 'silver_rate': silver_rate, 'error': None,
            'message': await default_message(gold_rate, silver_rate, res['fetched_at']),
        }
        await _maybe_auto_send(doc, gold_rate, silver_rate, cfg)
        await db.settings.update_one({'id': 'gold_rate_today'}, {'$set': doc}, upsert=True)
        await _notify_module(
            'gold_rate', 'Gold Rate Updated',
            f"Gold ₹{gold_rate:,}/g · Silver ₹{silver_rate:,}/g", '/settings/whatsapp',
            script='gold_rate_fetched',
        )
    else:
        have_good_today = bool(existing and existing.get('date') == today and existing.get('gold_rate') is not None)
        if have_good_today:
            logger.info("auto-fetch failed this cycle — keeping today's still-good unconfirmed draft")
            return
        await db.settings.update_one({'id': 'gold_rate_today'}, {'$set': {
            'id': 'gold_rate_today', 'date': today, 'fetched_at': res.get('fetched_at') or now_utc().isoformat(),
            'manual': False, 'confirmed': False, 'sent_at': None,
            'fetched_gold': None, 'fetched_silver': None, 'gold_margin_applied': None, 'silver_margin_applied': None,
            'gold_rate': None, 'silver_rate': None, 'error': res.get('error') or 'fetch failed', 'message': None,
        }}, upsert=True)


async def gold_rate_loop():
    """One shared periodic schedule (see DEFAULT_REFRESH_* above) drives
    both gold_rate_live and today's still-open broadcast draft - checked
    every 5 minutes, actually fetching only when _should_auto_fetch's gate
    (enabled, in-window, enough time since the last fetch) passes. Manual
    fetches (Rate Master's refetch button, /rates' admin button) go through
    run_fetch_and_store instead, unconditionally, any time."""
    await asyncio.sleep(60)   # let startup settle
    while True:
        try:
            cfg = await get_config()
            skip_today = cfg.get('skip_weekend_fetch', DEFAULT_SKIP_WEEKEND_FETCH) and is_weekend_ist()
            if not skip_today and await _should_auto_fetch(cfg):
                await _auto_fetch_cycle(cfg)
        except Exception as e:
            logger.warning(f'gold rate loop error: {e}')
        await asyncio.sleep(POLL_SECONDS)
