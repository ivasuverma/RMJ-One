"""AI Assistant (Gemini)

Extracted from the former monolithic server.py (§2.1 router split). Shared
infrastructure (db, auth deps, models, cross-domain helpers) stays in
server.py and is imported from here — nothing about behavior changed,
only where the code lives."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict
from datetime import timedelta
import uuid
import asyncio
import os
import time as _time
from server import (
    db,
    now_utc,
    today_str,
    require_staff,
    _opening_balance,
)

router = APIRouter()

# ---------------- AI Assistant (Gemini 3 Flash) ----------------
class AssistantAskIn(BaseModel):
    question: str


_ASSISTANT_CONTEXT_CACHE: Dict[str, object] = {'snapshot': None, 'built_at': 0.0}
_ASSISTANT_CONTEXT_TTL_SEC = 30


async def _build_context() -> str:
    """Compact snapshot for the assistant prompt (read-only). Rebuilding this
    is O(N) reads across every employee + every closing-balance computation
    (_opening_balance per employee), so a burst of questions in the same
    chat used to redo that full scan on every single message. Cached for
    _ASSISTANT_CONTEXT_TTL_SEC — fine at current scale (a snapshot up to 30s
    stale is not meaningfully different for a "what's going on today"
    assistant), and avoids the cost scaling with chat activity rather than
    just with employee count."""
    now = _time.monotonic()
    if _ASSISTANT_CONTEXT_CACHE['snapshot'] is not None and (now - _ASSISTANT_CONTEXT_CACHE['built_at']) < _ASSISTANT_CONTEXT_TTL_SEC:
        return _ASSISTANT_CONTEXT_CACHE['snapshot']
    snapshot = await _build_context_uncached()
    _ASSISTANT_CONTEXT_CACHE['snapshot'] = snapshot
    _ASSISTANT_CONTEXT_CACHE['built_at'] = now
    return snapshot


async def _build_context_uncached() -> str:
    d = today_str()
    lines: list = []
    employees = await db.employees.find({}, {'_id': 0, 'password_hash': 0, 'photo': 0}).to_list(500)
    lines.append(f"TODAY: {d}")
    lines.append(f"TOTAL EMPLOYEES: {len(employees)}")
    lines.append("EMPLOYEES:")
    for e in employees:
        lines.append(f"- {e.get('employee_code')} · {e.get('name')} · {e.get('designation') or '—'} · {e.get('department') or '—'} · ₹{e.get('salary', 0):.0f} · status={e.get('status')}")
    # Today's attendance
    lines.append("\nTODAY ATTENDANCE:")
    att_map = {}
    async for a in db.attendance.find({'date': d}, {'_id': 0, 'check_in.selfie': 0, 'check_out.selfie': 0}):
        att_map[a['employee_id']] = a
    for e in employees:
        a = att_map.get(e['id'])
        if a:
            ci = (a.get('check_in') or {}).get('timestamp', '')
            co = (a.get('check_out') or {}).get('timestamp', '')
            lines.append(f"- {e['employee_code']} · {e['name']}: status={a.get('status')} in={ci or '—'} out={co or '—'} late={a.get('is_late', False)} hours={a.get('working_hours', 0)}")
        else:
            lines.append(f"- {e['employee_code']} · {e['name']}: no punch today")
    # Pending items
    p_corr = await db.corrections.count_documents({'status': 'pending'})
    p_leaves = await db.leaves.count_documents({'status': 'pending'})
    lines.append(f"\nPENDING: corrections={p_corr}, leave_requests={p_leaves}")
    # Ledger balances
    lines.append("\nLEDGER (closing balances):")
    for e in employees:
        bal = await _opening_balance(e['id'], (now_utc() + timedelta(days=1)).isoformat())
        lines.append(f"- {e['employee_code']} · {e['name']}: ₹{bal:.0f}")
    return "\n".join(lines)


SYSTEM_PROMPT = (
    "You are RMJ AI, the built-in assistant for RMJ One, an employee management app "
    "for a jewellery business. You have read-only access to a snapshot of today's data. "
    "Answer questions concisely and factually using ONLY the snapshot below. "
    "If the answer isn't in the snapshot, say you don't have that data. "
    "Use INR (₹) for money. Format lists with bullets when helpful. "
    "Never invent employees, numbers, or actions. Never suggest destructive actions."
)


@router.post('/assistant/ask')
async def assistant_ask(body: AssistantAskIn, user=Depends(require_staff)):
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as ex:
        raise HTTPException(status_code=500, detail=f'AI library unavailable: {ex}')
    key = os.environ.get('EMERGENT_LLM_KEY')
    if not key:
        raise HTTPException(status_code=500, detail='EMERGENT_LLM_KEY not configured')
    context = await _build_context()
    session_id = f"assistant-{user['id']}-{uuid.uuid4()}"
    chat = LlmChat(
        api_key=key, session_id=session_id,
        system_message=f"{SYSTEM_PROMPT}\n\nDATA SNAPSHOT:\n{context}",
    ).with_model("gemini", "gemini-3-flash-preview")
    try:
        resp = await asyncio.wait_for(chat.send_message(UserMessage(text=body.question)), timeout=20)
        text = resp if isinstance(resp, str) else str(resp)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail='The AI assistant took too long to respond. Please try again.')
    except Exception as ex:
        raise HTTPException(status_code=502, detail=f'AI service error: {ex}')
    # Store transcript
    await db.assistant_history.insert_one({
        'id': str(uuid.uuid4()), 'user_id': user['id'], 'user_name': user.get('name', ''),
        'question': body.question, 'answer': text, 'created_at': now_utc().isoformat(),
    })
    return {'answer': text}


@router.get('/assistant/history')
async def assistant_history(user=Depends(require_staff), limit: int = 50):
    return await db.assistant_history.find(
        {'user_id': user['id']}, {'_id': 0}
    ).sort('created_at', -1).limit(limit).to_list(limit)
