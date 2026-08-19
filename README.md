# RMJ One

RMJ One is the day-to-day operations app for **Ram Murti Jewellers** — a jewellery shop
management system built to replace the paper registers the shop used to run on.

It covers:

- **Repairs** — intake, karigar assignment, receive-back weights, billing, and delivery,
  with a full item lifecycle from received through delivered.
- **Karigar ledgers with dual balances** — every account (customer, karigar, employee)
  tracks **fine gold (grams)** and **cash (₹)** independently. A karigar can owe fine gold
  while the shop owes them cash, and both are shown separately, never netted into one number.
- **Cash Book** — a manual daily cash in/out ledger, mirroring the shop's paper cash book,
  supporting multiple named counters (registers/tills) with automatic opening-balance
  carry-forward and linked inter-counter transfers.
- **Stock in/out & samples** — tracking pieces sent out on approval and their return.
- **Payroll & attendance** — shift-aware attendance, biometric device integration, and a
  monthly payroll cycle with advances/deductions.
- **Tasks, approvals, and leave** — day-to-day work assignment and staff requests.
- **Notifications** — optional browser push (works even with the tab closed) for leave
  requests, approvals, and payroll events.

One login serves every role — **owner, admin, accountant, employee** — the account decides
what the app shows.

## Stack

- **Backend:** FastAPI (Python), MongoDB via `motor` (async driver). Domain logic is split
  across `backend/routers/*.py`; shared infrastructure (db, auth, models) lives in
  `backend/server.py`.
- **Frontend:** Expo / React Native, file-based routing via `expo-router`. Ships as a
  native app and as a **web export** for browser access.
- **Deployment:** the web export is served from a Windows PC at the shop, behind a
  Cloudflare Tunnel, deployed automatically by a **self-hosted GitHub Actions runner**
  living on that same machine (`.github/workflows/deploy.yml`) — pushes to `main` fast-forward
  the server's checkout, restart the backend service, rebuild the web export, and restart
  the web service.
- **Backups:** a scheduled PowerShell job (`ops/backup/`) dumps MongoDB and uploads it to
  Google Drive daily.

## Quick setup

See **[RUNNING.md](RUNNING.md)** for full local setup instructions (backend + frontend,
demo logins, optional push notification setup, and a running log of what to test after
changes).

In short:

```bash
# Backend
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000

# Frontend
cd frontend && npm install && npx expo start
```

## Repo layout

```
backend/
  server.py          # shared infra: db, auth/JWT, models, module/permission resolution
  routers/            # one file per domain (repairs, cashbook, payroll, users, ...)
  tests/               # integration tests — mutate real data, not run in CI (see below)
frontend/
  app/                 # expo-router screens (file-based routing)
  src/
    api/               # typed API client
    auth/               # auth context, role/permission helpers
    theme/               # design tokens, palettes, ThemeContext
    components/          # shared UI
ops/backup/            # MongoDB → Google Drive backup scripts + scheduled task registration
.github/workflows/deploy.yml   # self-hosted deploy pipeline, triggers on push to main
```

## Notes for contributors

- `backend/tests/*.py` log in as the real owner account and create/delete real records —
  don't run them against a shop's live database, and they are intentionally excluded from
  CI/deploy.
- Dev-only Python tooling (`black`, `flake8`, `mypy`, `isort`, `pytest`) lives in
  `backend/requirements-dev.txt`, separate from the runtime `requirements.txt`.
- The design system (dark charcoal + antique gold, Inter font) lives in
  `frontend/src/theme.ts` / `frontend/src/theme/palettes.ts` — consume tokens via
  `useTheme()` rather than hardcoding colours or sizes.
