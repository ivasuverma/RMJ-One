"""LED rate board — pushes the confirmed daily gold/silver rate to the shop's LED display.

The board is a Huidu HD-W2 WiFi card. Everything on the RMJ One side lives here:
settings, the text template, "Test connection", "Push now", status, and the automatic
push after the daily rate is confirmed/sent (see `push_after_confirm`, called from
routers/settings.py and gold_rate.py). The only part that talks to the hardware is
`_DRIVERS`: each driver is `async def (cfg, text, rates) -> None` that raises on failure.

Drivers
  simulator   logs the text and succeeds — for trying the whole flow with no board attached.
  huidu_w2    the real HD-W2 protocol. NOT wired yet: it has to be checked against the
              actual board (its network protocol isn't publicly documented), and until then
              it fails with a clear message instead of pretending to work.

Nothing here can affect the WhatsApp/daily-rate flow: automatic pushes swallow their own errors.
"""
import asyncio
import logging
import re
import time
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from server import db, now_utc, IST, log_audit, require_owner, require_staff_or_module, require_admin_or_module_right

logger = logging.getLogger('led_board')
router = APIRouter()

DEFAULT_TEMPLATE = 'GOLD {gold_rate}  SILVER {silver_rate}'
DEFAULT_PORT = 0            # unknown until the HD-W2 protocol is confirmed against the real board
DRIVER_CHOICES = ('simulator', 'huidu_w2')
_MASTER_KEYS = ('gold_24k', 'gold_22k', 'gold_18k', 'gold_14k', 'silver_9999')


class LedBoardNotReady(Exception):
    pass


# ---------------- config / status ----------------
async def get_config() -> dict:
    d = await db.settings.find_one({'id': 'led_board'}, {'_id': 0}) or {}
    return {
        'enabled': bool(d.get('enabled', False)),
        'driver': d.get('driver') if d.get('driver') in DRIVER_CHOICES else 'simulator',
        'host': (d.get('host') or '').strip(),
        'port': int(d.get('port') or DEFAULT_PORT),
        'template': d.get('template') or DEFAULT_TEMPLATE,
        'auto_push': bool(d.get('auto_push', True)),
    }


async def get_status() -> dict:
    d = await db.settings.find_one({'id': 'led_board_status'}, {'_id': 0}) or {}
    return {
        'last_push_at': d.get('last_push_at'), 'last_ok': d.get('last_ok'), 'last_error': d.get('last_error'),
        'last_text': d.get('last_text'), 'last_reason': d.get('last_reason'),
        'last_test_at': d.get('last_test_at'), 'last_test_ok': d.get('last_test_ok'), 'last_test_detail': d.get('last_test_detail'),
    }


def _indian(n: int) -> str:
    s = str(abs(int(n)))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:]); head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ','.join(parts + [tail])
    return ('-' if int(n) < 0 else '') + s


def render_text(template: str, gold: int, silver: int, when: Optional[datetime] = None, extra: Optional[dict] = None) -> str:
    now = (when or now_utc()).astimezone(IST)
    fields = {
        'gold_rate': int(gold), 'silver_rate': int(silver),
        'gold_rate_comma': _indian(gold), 'silver_rate_comma': _indian(silver),
        'date': now.strftime('%d %b %Y'), 'time': now.strftime('%I:%M %p').lstrip('0'),
    }
    # Per-purity rates from the rate master: {gold_24k} {gold_22k} {gold_18k} {gold_14k} {silver_9999}
    # (and the same with a _comma suffix for 1,51,050 style). Missing ones render as "--".
    for k in _MASTER_KEYS:
        v = (extra or {}).get(k)
        fields[k] = v if v is not None else '--'
        fields[k + '_comma'] = _indian(v) if v is not None else '--'
    try:
        return template.format(**fields)
    except Exception:
        return DEFAULT_TEMPLATE.format(**fields)


# ---------------- drivers ----------------
async def _drv_simulator(cfg: dict, text: str, rates: dict) -> None:
    logger.info(f'[simulator] would show on the board: {text!r}')


async def _drv_huidu_w2(cfg: dict, text: str, rates: dict) -> None:
    # TODO(protocol): send `text` to the HD-W2. To be filled in after testing against the
    # real board (address + how LedArt talks to it). Deliberately fails loudly until then.
    raise LedBoardNotReady('The HD-W2 connection is not set up yet — use "Simulator" until it has been tested with the real board.')


_DRIVERS = {'simulator': _drv_simulator, 'huidu_w2': _drv_huidu_w2}


async def _tcp_check(host: str, port: int, timeout: float = 4.0) -> dict:
    t0 = time.monotonic()
    try:
        _, w = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
        w.close()
        try:
            await w.wait_closed()
        except Exception:
            pass
        return {'ok': True, 'detail': f'Connected in {round((time.monotonic() - t0) * 1000)} ms'}
    except asyncio.TimeoutError:
        return {'ok': False, 'detail': f'No answer from {host}:{port} (timed out) — is the board on the shop WiFi?'}
    except OSError as e:
        return {'ok': False, 'detail': f'Could not connect to {host}:{port} — {e.strerror or e}'}


# ---------------- core push ----------------
async def _current_rates() -> Optional[dict]:
    t = await db.settings.find_one({'id': 'gold_rate_today'}, {'_id': 0}) or {}
    if t.get('gold_rate') and t.get('silver_rate'):
        return {'gold': int(t['gold_rate']), 'silver': int(t['silver_rate']), 'date': t.get('date'),
                'confirmed': bool(t.get('confirmed'))}
    return None


async def push_rates(gold: int, silver: int, reason: str = 'manual') -> dict:
    """Render the standard rate text and send it to the board."""
    cfg = await get_config()
    from routers.rate_master import fields_for
    return await push_text(render_text(cfg['template'], gold, silver, extra=await fields_for(gold, silver)), reason,
                           {'gold': gold, 'silver': silver})


async def push_text(text: str, reason: str = 'manual', rates: Optional[dict] = None) -> dict:
    """Send ready-made text to the board; records the outcome in led_board_status."""
    cfg = await get_config()
    rates = rates or {}
    ok, err = True, None
    try:
        await asyncio.wait_for(_DRIVERS[cfg['driver']](cfg, text, rates), timeout=20)
    except LedBoardNotReady as e:
        ok, err = False, str(e)
    except asyncio.TimeoutError:
        ok, err = False, 'The board did not answer in time'
    except Exception as e:
        ok, err = False, str(e)[:200] or e.__class__.__name__
    await db.settings.update_one({'id': 'led_board_status'}, {'$set': {
        'id': 'led_board_status', 'last_push_at': now_utc().isoformat(), 'last_ok': ok,
        'last_error': err, 'last_text': text, 'last_reason': reason,
    }}, upsert=True)
    if not ok:
        logger.warning(f'LED board push failed ({reason}): {err}')
    return {'ok': ok, 'text': text, 'error': err}


async def push_after_confirm(gold: Optional[int], silver: Optional[int], reason: str = 'rate_confirmed', force: bool = False) -> Optional[dict]:
    """Called after the daily rate is confirmed/sent. Never raises. Returns the push result, or None
    when nothing was sent (board off, or auto-update off and not `force`d, or no rate)."""
    try:
        cfg = await get_config()
        if not cfg['enabled'] or not (cfg['auto_push'] or force):
            return None
        if gold is None or silver is None:
            r = await _current_rates()
            if not r:
                return None
            gold, silver = r['gold'], r['silver']
        return await push_rates(int(gold), int(silver), reason)
    except Exception as e:
        logger.warning(f'LED board auto-push error: {e}')
        return {'ok': False, 'text': None, 'error': str(e)[:200]}


# ---------------- endpoints ----------------
class LedBoardConfigIn(BaseModel):
    enabled: bool = False
    driver: str = 'simulator'
    host: str = ''
    port: int = 0
    template: Optional[str] = None
    auto_push: bool = True


class LedBoardPushIn(BaseModel):
    gold_rate: Optional[int] = None
    silver_rate: Optional[int] = None
    # A one-off message with the same {placeholders} as the board template. When given it is
    # shown instead of the standard rate text (the next automatic update replaces it again).
    template: Optional[str] = None


class LedBoardPreviewIn(BaseModel):
    template: str
    gold_rate: Optional[int] = None      # preview against typed-but-unsaved rates
    silver_rate: Optional[int] = None


_RATE_PLACEHOLDER = re.compile(r'\{(gold_rate|silver_rate|gold_24k|gold_22k|gold_18k|gold_14k|silver_9999)(_comma)?\}')


def _check_template(t: str) -> str:
    t = (t or '').strip()
    if not t:
        raise HTTPException(status_code=400, detail='Type the text to show first')
    if len(t) > 200:
        raise HTTPException(status_code=400, detail='Text is too long for a board (max 200 characters)')
    try:
        t.format(**{k: 1 for k in ('gold_rate', 'silver_rate', 'date', 'time', 'gold_rate_comma', 'silver_rate_comma')},
                 **{k: 1 for k in _MASTER_KEYS}, **{k + '_comma': '1' for k in _MASTER_KEYS})
    except Exception as e:
        raise HTTPException(status_code=400, detail=f'Unknown placeholder: {e}')
    return t


async def _render_custom(template: str, gold: Optional[int], silver: Optional[int]) -> str:
    """Render a one-off message. Rate placeholders need a rate; plain text does not."""
    template = _check_template(template)
    if gold is None or silver is None:
        if _RATE_PLACEHOLDER.search(template):
            raise HTTPException(status_code=400, detail="There is no rate for today yet — fetch or enter it on the Gold Rate screen first")
        return render_text(template, 0, 0)
    return render_text(template, gold, silver, extra=await _extra({'gold': gold, 'silver': silver}))


async def _extra(r: Optional[dict]) -> dict:
    from routers.rate_master import fields_for
    return await fields_for(r['gold'], r['silver']) if r else {}


class LedTemplateIn(BaseModel):
    name: str
    text: str


MAX_TEMPLATES = 30


async def _templates() -> list:
    d = await db.settings.find_one({'id': 'led_board_templates'}, {'_id': 0}) or {}
    return d.get('items') or []


@router.post('/led-board/templates')
async def led_template_save(body: LedTemplateIn, user: dict = Depends(require_admin_or_module_right('gold_rate', 'edit'))):
    """Save a custom message as a reusable template (same name = update it)."""
    name = body.name.strip()[:40]
    if not name:
        raise HTTPException(status_code=400, detail='Give the template a name')
    text = _check_template(body.text)
    items = await _templates()
    existing = next((i for i in items if i['name'].lower() == name.lower()), None)
    if existing:
        existing['name'], existing['text'] = name, text
    else:
        if len(items) >= MAX_TEMPLATES:
            raise HTTPException(status_code=400, detail=f'You can keep up to {MAX_TEMPLATES} templates — delete one first')
        items.append({'id': uuid.uuid4().hex[:12], 'name': name, 'text': text})
    await db.settings.update_one({'id': 'led_board_templates'}, {'$set': {'id': 'led_board_templates', 'items': items}}, upsert=True)
    await log_audit(user, 'led_board.template_save', 'settings', 'led_board_templates', f'{name}: {text}'[:120])
    return {'items': items}


@router.delete('/led-board/templates/{tid}')
async def led_template_delete(tid: str, user: dict = Depends(require_admin_or_module_right('gold_rate', 'edit'))):
    items = await _templates()
    gone = next((i for i in items if i['id'] == tid), None)
    if not gone:
        raise HTTPException(status_code=404, detail='Template not found')
    items = [i for i in items if i['id'] != tid]
    await db.settings.update_one({'id': 'led_board_templates'}, {'$set': {'id': 'led_board_templates', 'items': items}}, upsert=True)
    await log_audit(user, 'led_board.template_delete', 'settings', 'led_board_templates', gone['name'])
    return {'items': items}


@router.get('/led-board')
async def led_board_state(_: dict = Depends(require_staff_or_module('gold_rate'))):
    cfg = await get_config()
    r = await _current_rates()
    return {
        'config': cfg, 'status': await get_status(), 'drivers': list(DRIVER_CHOICES),
        'today': r, 'preview': render_text(cfg['template'], r['gold'], r['silver'], extra=await _extra(r)) if r else None,
        'default_template': DEFAULT_TEMPLATE, 'templates': await _templates(),
    }


@router.put('/led-board/config')
async def led_board_config(body: LedBoardConfigIn, user: dict = Depends(require_owner)):
    if body.driver not in DRIVER_CHOICES:
        raise HTTPException(status_code=400, detail=f'driver must be one of {", ".join(DRIVER_CHOICES)}')
    host = body.host.strip()
    if host and not re.match(r'^[A-Za-z0-9.\-]{1,253}$', host):
        raise HTTPException(status_code=400, detail='Board address must be an IP address or host name')
    if not (0 <= body.port <= 65535):
        raise HTTPException(status_code=400, detail='Port must be 0–65535')
    if body.template:
        try:
            body.template.format(**{k: 1 for k in ('gold_rate', 'silver_rate', 'date', 'time', 'gold_rate_comma', 'silver_rate_comma')},
                                 **{k: 1 for k in _MASTER_KEYS}, **{k + '_comma': '1' for k in _MASTER_KEYS})
        except Exception as e:
            raise HTTPException(status_code=400, detail=f'Template has an unknown placeholder: {e}')
        if len(body.template) > 200:
            raise HTTPException(status_code=400, detail='Template is too long for a board (max 200 characters)')
    await db.settings.update_one({'id': 'led_board'}, {'$set': {
        'id': 'led_board', 'enabled': body.enabled, 'driver': body.driver, 'host': host, 'port': body.port,
        'template': body.template or None, 'auto_push': body.auto_push, 'updated_at': now_utc().isoformat(),
    }}, upsert=True)
    await log_audit(user, 'settings.led_board.config_update', 'settings', 'led_board', f'{body.driver} {host}:{body.port} enabled={body.enabled} auto={body.auto_push}')
    return await get_config()


@router.post('/led-board/test')
async def led_board_test(user: dict = Depends(require_admin_or_module_right('gold_rate', 'edit'))):
    cfg = await get_config()
    if cfg['driver'] == 'simulator':
        res = {'ok': True, 'detail': 'Simulator — no board is contacted'}
    elif not cfg['host'] or not cfg['port']:
        res = {'ok': False, 'detail': 'Enter the board address and port first'}
    else:
        res = await _tcp_check(cfg['host'], cfg['port'])
    await db.settings.update_one({'id': 'led_board_status'}, {'$set': {
        'id': 'led_board_status', 'last_test_at': now_utc().isoformat(), 'last_test_ok': res['ok'], 'last_test_detail': res['detail'],
    }}, upsert=True)
    return res


@router.post('/led-board/preview')
async def led_board_preview(body: LedBoardPreviewIn, _: dict = Depends(require_staff_or_module('gold_rate'))):
    r = await _current_rates()
    gold = body.gold_rate if body.gold_rate else (r['gold'] if r else None)
    silver = body.silver_rate if body.silver_rate else (r['silver'] if r else None)
    try:
        return {'text': await _render_custom(body.template, gold, silver), 'error': None}
    except HTTPException as e:
        return {'text': None, 'error': e.detail}


@router.post('/led-board/push')
async def led_board_push(body: LedBoardPushIn, user: dict = Depends(require_admin_or_module_right('gold_rate', 'edit'))):
    cfg = await get_config()
    if not cfg['enabled']:
        raise HTTPException(status_code=400, detail='The LED board is switched off — turn it on in the board settings first')
    gold, silver = body.gold_rate, body.silver_rate
    if gold is None or silver is None:
        r = await _current_rates()
        gold, silver = (r['gold'], r['silver']) if r else (None, None)
    if body.template is not None:
        text = await _render_custom(body.template, gold, silver)
        res = await push_text(text, 'custom')
    else:
        if gold is None:
            raise HTTPException(status_code=400, detail="There is no rate for today yet — fetch or enter it on the Gold Rate screen first")
        res = await push_rates(int(gold), int(silver), 'manual')
    await log_audit(user, 'led_board.push', 'settings', 'led_board', f"{'ok' if res['ok'] else 'failed'}: {res['text']}")
    if not res['ok']:
        raise HTTPException(status_code=502, detail=res['error'] or 'Could not update the board')
    return res
