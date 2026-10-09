# RMJ-One — notes for Claude

Shop software for **Ram Murti Jewellers, Ludhiana** (est. 1932). The owner reviews work from
screenshots on an iPhone and says **"Deploy"** to ship. Read this first in every new chat.

## How to work with the owner

- **One branch and one PR per change.** Never push to `main` — it auto-deploys.
- **Deploy only when the owner says "Deploy"**:
  1. Merge the open PR(s): `gh api -X PUT repos/ivasuverma/RMJ-One/pulls/<n>/merge -f merge_method=squash`.
  2. Start the deploy: `gh api -X POST repos/ivasuverma/RMJ-One/actions/workflows/deploy.yml/dispatches -f ref=main`.
  3. Poll the run until it finishes. Its jobs are lint, tests / pytest and deploy.
  4. Report the result.
  5. **Always end with:** "Please check Biometric Devices — if it shows offline, restart the PC."
- Don't run `backend/tests/*.py` against the live server. Locally they're fine, against a local Mongo.
- Read the existing code first and reuse its data and helpers. Don't duplicate business logic.
- **The owner decides all access.** Don't widen who can see or do what without being asked.
- **Never truncate text in the UI.** No `numberOfLines` cut-offs, no clipped boxes; let text wrap.
  The owner dislikes this strongly.
- **Cash Ledger must have no effect on any other module.**
- **Never ask for or accept the R2 secret (or any secret) in chat.**
- Replies are short and plain. Say what changed and where to find it in the app.
  After building, offer screenshots from a local run.

## Architecture

- **Backend:** FastAPI + MongoDB.
  - Runs on the shop's Windows PC; repo at `D:\RMJ-One\RMJ-One`.
  - Windows service `RMJOneBackend` (nssm) on port 8000.
  - Public at `https://api.rmj.co.in` through a Cloudflare tunnel.
  - Code in `backend/server.py` and `backend/routers/*.py`.
- **App:** Expo React Native Web (PWA).
  - Live at `https://app.rmj.co.in`; code in `frontend/` (expo-router, `frontend/app/...`).
  - Tabs are in `frontend/app/(tabs)`; the employee app is in `frontend/app/(emp)`.
- **Website:** `https://rmj.co.in`, a static site in `website/`.
  - Deployed by Cloudflare Pages / `deploy-website.yml` when `website/` changes on `main`.
- **Deploy workflow** `.github/workflows/deploy.yml` runs on the shop PC:
  - Pulls the code, builds the app and restarts the services.
  - Registers the **RMJOne Watchdog** scheduled task (`ops/watchdog/rmj-watchdog.ps1`, every 2 min).
    The watchdog restarts a hung backend and writes incident reports to `ops/logs/incidents/`.
  - Posts diagnostics as job annotations. Job logs can't be fetched; read
    `gh api repos/ivasuverma/RMJ-One/check-runs/<job id>/annotations`.
- **CI:** `backend-tests.yml` runs pytest only when `backend/**` changes. It uses xdist (loadscope),
  so a test must not change shared state that another test module checks.

## Roles and access

- Roles: `owner`, `admin`, `accountant` (store login), `employee`.
- Modules are granted per user (`resolve_modules(user)`; guards such as `require_staff_or_module`).
- **Hidden tiles:**
  - The owner can hide Work/Ledger tiles for everyone; a double-tap on the tab title reveals them.
  - The owner gets a gear to choose which ones (`frontend/src/components/SecretTiles.tsx`, `routers/users.py`).
  - Hidden modules are also left out of Home for non-owners. Quick actions become add-only.
  - Cash Ledger is hidden by default.

## Modules worth knowing

- **Message Broadcast** (formerly Rate Broadcast).
  - Code: `routers/rate_broadcast.py`, `routers/broadcasts.py`; app `frontend/app/settings/rate-broadcast/`.
  - Sends today's rate and offers on WhatsApp from either number:
    - **Shop WhatsApp (OpenWA)**: plain text, slow (about 6 a minute). Wording is editable in
      Settings › WhatsApp › Message Templates.
    - **Official (Meta)**: approved templates, with a daily limit.
  - **Each list has its own schedule:** on/off, daily or weekly, day, time, skip Sunday, send-from.
  - Built-in lists are Customer list (`weekly`) and Daily subscribers (`daily`); custom lists are also supported.
  - Sign-ups: the website button opens the shop's WhatsApp (+91 97818 00888) with START typed in.
    START/STOP/WEEKLY replies manage the lists.
  - The Meta official number and Meta templates are in **Settings › WhatsApp**.
  - The Meta rate template was **not yet approved** (as of Oct 2026).
- **Documents:**
  - Capture goes to Pending, then Done folders.
  - Customer slips can go to an "OS" (outstanding) folder.
  - Select/delete and a purge-before-date tool exist only in Done folders.
  - Send from iPhone is an iOS Shortcut that asks for the category; set up in Settings.
- **Stock In/Out (samples):**
  - A photo is compulsory when issuing; optional when receiving (`record_photos` ref_type `sample_receive`).
- **Record photos:** collection `record_photos` with a `ref_type` per module; bulk thumbnails come from `/record-photos/thumbnails`.
- **Cash Ledger:** person page with combined running balance and group tags; statement/PDF list every entry with its group.
- **Website:**
  - Live rates; "market closed" banner with blurred rates from 8 PM to 9 AM.
  - Visitor ticker reads "N visits today · N total" (`/public/visit`).
  - "Jewellers for generations … set up by Sh. Ram Murti in 1932" wording.

## Local dev recipe (cloud sandbox)

```bash
# Mongo in Docker
docker start rmjmongo   # if docker is down: dockerd & then start
# Backend (kill old uvicorn in a separate command first)
cd backend && MONGO_URL=mongodb://localhost:27017 DB_NAME=rmj_live \
  python3 -m uvicorn server:app --host 127.0.0.1 --port 8001
# Tests
EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8001 python3 -m pytest -q -o addopts="" -p no:warnings tests/<file>.py
# Web build + serve
cd frontend && EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8001 npx expo export -p web --clear --output-dir <out>
npx serve -s <out> -l 8782
```

- **Logins:** owner/Owner@123, admin/Admin@123, accountant/Accountant@123. Employee: `/auth/employee-login` rmj001/1234.
- **Playwright:** use Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
  Put the token in sessionStorage `rmj.access_token`. Use `.last()` for testIDs.
- `frontend`: `npx tsc --noEmit -p .` and `npx eslint <files>` before opening a PR.

## Open items

- The Meta rate template is waiting for approval. Until it's approved, use "Shop WhatsApp" to send.
- The watchdog hasn't triggered yet. Check `ops\logs\watchdog.log` on the PC if the site goes down (Error 520).
