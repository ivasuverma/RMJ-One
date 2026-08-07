# RMJ One - Product Requirements (Milestone 1 MVP)

## Vision
A modern, AI-powered Employee Management System for jewellery businesses (Ram Murti Jewellers). Branded as **RMJ One**, designed to grow into a full jewellery ERP.

## MVP Scope (this iteration)
- **Login** (JWT, owner role)
- **Dashboard** — Today's Attendance tiles (Present/Absent/Late/Half Day/Missing Punch/Leave/Working), Pending Approvals list, Payroll Summary bento grid
- **Employee Module** — Directory with search + status filter chips, full employee profile (Photo, Employee ID, Name, Department, Designation, Shift, Salary, Joining Date, Mobile, Address, Aadhaar, PAN, Bank details, Documents, Status, Notes) + Timeline (Joined, Salary Revised, Advance, Bonus, Penalty, Leave, Correction), Add/Edit/Delete
- **Settings** — Profile, logout

## Design
Glass / Luxe DARK theme. Charcoal `#0D0D0D` surfaces, antique gold `#D4AF37` brand accent, serif display + system sans-serif body, generous spacing (8pt grid).

## Tech stack
- Backend: FastAPI + Motor (MongoDB) + PyJWT + bcrypt
- Frontend: Expo SDK 54, expo-router, expo-image, expo-linear-gradient, react-native-safe-area-context
- Auth: JWT bearer stored via expo-secure-store (native) / AsyncStorage (web)

## Future milestones
- **M2:** Biometric integration, live attendance, corrections, notifications, leave
- **M3:** Payroll engine, ledger, PDF payslips, reports
- **M4:** AI Assistant (Claude/GPT/Gemini), analytics, multi-branch

## Seeded data
- 1 Owner (`owner` / `Owner@123`)
- 5 sample employees across Sales / Workshop / Accounts / Security
- Sample timeline events (Joined, Bonus, Advance)
