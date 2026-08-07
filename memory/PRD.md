# RMJ One - Product Requirements

## Vision
RMJ One is an AI-powered Employee Management System for jewellery businesses (Ram Murti Jewellers), designed to grow into a full jewellery ERP.

## Delivered so far

### Milestone 1 (M1)
- JWT owner login, seeded owner user
- Dashboard (attendance tiles / pending approvals / payroll summary)
- Employee module: profile, timeline, CRUD, search + status filters

### Milestone 2A (M2A) — Attendance
- Employee PIN-based login (4-digit)
- Selfie + geo-fenced check-in / check-out (both mandatory)
- Owner Today attendance rows + Live event board
- Attendance correction requests + owner approval
- Leave management (casual / sick / paid / unpaid) with owner approval
- Single-store settings (coords, fence radius, work hours, grace)
- In-app smart reminder banners (check-in/out reminders)

### Milestone 2B (M2B) — Roles & Payroll
- Admin + Accountant roles with RBAC (owner > admin > accountant > employee)
- User Management (owner-only)
- Shifts CRUD (name / start / end / grace)
- Holiday calendar (public / festival / store_closed)
- Payroll engine (calendar month, uses attendance + Sunday work + leaves + monthly ledger entries)
- Employee Ledger with running balance
- Digital Salary Receipt PDF (one-tap)
- Payroll save / lock / unlock, Mark Paid

### Milestone 3 (M3) — Calendar, Reports & Audit
- **Attendance Calendar** (owner/admin edit any employee; employee view-only for self)
- Day-detail sheet with edit for staff, "Request Change" for employee with desired times
- Correction approvals apply desired check-in/out times exactly
- Payroll **opening balance carry-forward** from previous months
- Payroll **per-entry overrides** (bonus, fine, deduction, note, payment_mode: cash/bank/UPI/cheque) — editable when unlocked and unpaid
- **Enriched PDF payslip**: Earnings / Deductions sections, opening balance line, payment mode, note
- **6 PDF Reports**: Attendance, Late, Missing Punch, Leave, Payroll, Ledger
- **Audit Logs** viewer (owner-only) for attendance edits, correction/leave decisions, payroll actions, user create/delete

## Roles
| Role | Employees CRUD | Corrections/Leaves | Payroll | Store settings | User mgmt | Audit |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| Owner | ✅ | ✅ | ✅ save/lock/unlock | ✅ | ✅ | ✅ |
| Admin | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Accountant | 👁 read | ❌ | ✅ save/lock, cannot unlock | ❌ | ❌ | ❌ |
| Employee | — | own only | own view | — | — | — |

## Tech
- Backend: FastAPI + Motor + PyJWT + bcrypt + reportlab (PDF)
- Frontend: Expo SDK 54, expo-router, expo-camera, expo-location, expo-image-manipulator, expo-secure-store
- Design: Glass/Luxe DARK — charcoal + antique gold, serif display + system sans

## Future milestones
- **M4**: eSSL AI Face Mercury biometric integration, AI Assistant (natural-language queries via GPT-5/Claude/Gemini via Emergent LLM key), multi-branch support
- Push notifications (Emergent-managed; requires deployed build)

## Notes
- Preview container cannot reach a store LAN device → biometric integration will be built server-side and verified only after deployment.
- Camera + Location work correctly on real devices via Expo Go / deployed builds. Web preview may show permission prompts but full camera stream requires native runtime.
