# Running RMJ One locally

This app has two halves that both need to be running: a FastAPI + MongoDB backend, and an
Expo (React Native) frontend. Steps below get both up on your Mac.

## 1. Backend

Requirements: Python 3.11+, MongoDB running somewhere reachable (local Docker is easiest).

```bash
# Start Mongo (skip if you already have one running)
docker run -d --name rmj-mongo -p 27017:27017 mongo:7

cd backend
cp .env.example .env          # defaults already point at the Docker Mongo above
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

The backend seeds demo data on first boot: an owner login (`owner` / `Owner@123`), an
admin and accountant login, and 5 sample employees (see terminal log for their PINs).

Note: `requirements.txt` includes `emergentintegrations`, a package used only by the
"Ask AI" assistant screen. If it fails to install from your network, remove that line (and
`litellm`) from requirements.txt — every other screen (dashboard, attendance, payroll,
employees) works without it.

### Optional: browser push notifications

Settings → Notifications now actually works — it sends a real browser push (works even
with the tab closed) when: an employee submits a leave/correction request (notifies
owner + admin), a leave/correction is approved or rejected (notifies the employee), or a
salary is marked paid (notifies the employee). Without setup below, everything else still
works fine — the toggle just says push isn't configured.

```bash
cd backend
python generate_vapid_keys.py
# paste the two printed lines into backend/.env
pip install pywebpush
```

On iPhone, Safari only supports push for sites added to the Home Screen first (open the
site → Share → Add to Home Screen → open it from there → enable notifications). Android
Chrome supports it directly from a normal browser tab.

## 2. Frontend

```bash
cd frontend
cp .env.example .env
# Edit .env: set EXPO_PUBLIC_BACKEND_URL to your Mac's LAN IP if testing on a
# physical phone via Expo Go (find it with `ipconfig getifaddr en0`), or leave as
# localhost:8000 if you'll use the iOS Simulator on the same Mac.
npm install
npx expo start
```

Then either:
- Press `i` to launch the iOS Simulator (needs Xcode installed), or
- Scan the QR code with the **Expo Go** app on your phone (phone and Mac must be on the
  same Wi-Fi network).

## What to test

- **Dashboard** — attendance hero, pending-approvals rows, and payroll tiles are now
  tappable and route to the right screen.
- **Attendance → tap an employee → a day** — pick a shift chip to prefill check-in/out,
  or type times directly; status and lateness now auto-calculate from them. "PAID OFF" is
  a new option for weekly-offs/comp-offs. Sundays with no punch are now paid by default.
- **Employee profile** — opens on Details, then Payroll (was Timeline first). The Payroll
  tab shows a real monthly-at-a-glance card instead of the old placeholder.
- **Payroll tab** — once generated, a **Regenerate** button appears next to Lock Month, for
  refreshing unpaid entries after attendance edits (paid entries are never touched). Paid
  rows are now tinted green.
- **Payroll → an employee** — shows the calculation formula, and a "Modify attendance for
  this month" button that jumps straight to that employee's calendar.
- Try double/triple-tapping any Save/Submit/Approve/Pay button — it should now only fire
  once.
- **Settings** — owner sees everything; admin/accountant only see the sections their role
  can actually act on (Approvals is owner+admin, Reports is everyone staff, Store/Shifts/
  Holidays/Users/Biometric/Audit are owner-only, matching what the backend already
  enforced but the UI didn't reflect before).
- **Employee profile → Details → ID Proofs** — owner/admin can attach Aadhaar/PAN/etc. as
  a photo or PDF (tap "Add ID Proof"); employees see their own uploaded documents
  read-only on their Profile tab.
- **Settings/Profile → Notifications** — toggling it on should prompt the browser for
  permission, then say "On". See "Optional: browser push notifications" above for the
  one-time server setup.

## Known limitation

I statically verified (TypeScript typecheck, Python syntax check, and in-process backend
smoke tests against a mock database) these changes from a sandboxed dev environment
without a real MongoDB/Mongo Atlas connection, so I could not click through the actual
running app end-to-end myself. Please flag anything that doesn't behave as described above
and I'll fix it.
