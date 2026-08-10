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

## Known limitation

I made and statically verified (TypeScript + Python syntax) these changes from a sandboxed
dev environment without outbound internet access, so I could not actually boot the
backend/Mongo or run the app end-to-end myself. Please flag anything that doesn't behave
as described above and I'll fix it.
