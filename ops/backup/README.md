# RMJ-One backups

Everything runs on one Windows server; the database is a local MongoDB
(`RMJOneMongo`, data in `D:\RMJ-One\mongodb`). **Google Drive is the only off-site
place** — for documents/photos and for system backups. Nothing else (no OneDrive).

**Documents and photos** live permanently in Drive (`RMJ One Documents`): documents,
record photos, repair intake/delivery photos, attendance selfies and WhatsApp broadcast
photos (see backend/media_offload.py). The server keeps only small thumbnails, plus a
temporary cache of recently opened files (on-screen copies 7 days / 1 GB; originals
1 day). A photo is deleted from the server only after it has reached Drive. The one
exception is the website's "Fresh at the counter" photos, which rmj.co.in is served
from and so stay on the server.

**System backups** — the scheduled task "RMJOne Mongo Backup" runs `backup-nightly.ps1`
twice a day, at 02:30 and 14:30 (the deploy workflow keeps those times set) (installed copy: `D:\RMJ-One\mongodbackup-local.ps1` — keep the two in sync):

| File (in `D:\RMJ-One\mongodbackups`) | What | Kept locally |
|---|---|---|
| `rmj_one-<date>.gz` | full database dump (mongodump archive) | 14 |
| `config-<date>.zip` | .env files, service definitions, backup script, WhatsApp gateway settings | 14 |

The backend (`backup_service.upload_system_backups`, hourly) sends new files to the
Drive folder **RMJ One Backups** and keeps the newest 70 there (about two weeks). Once a file is in Drive,
the local copy is deleted after 1 day (the "Kept locally" count above is only the
fallback for when Drive is not reachable). Log:
`D:\RMJ-One\mongodb\logackup.log`. Code lives on GitHub.

**Online copy (MongoDB Atlas).** Twice a day, after 3 AM and 3 PM, the backend
(`backend/atlas_mirror.py`) copies the whole database to the free Atlas cluster
(Cluster0, Mumbai), replacing the previous copy — one ready-to-run copy,
not a history (times: `ATLAS_MIRROR_HOURS`, default `3,15`). Turned on by `ATLAS_MIRROR_URL=mongodb+srv://…` in `backend/.env`;
status and "Copy online now" are in Settings › Backup. If the server is lost:
point `MONGO_URL` at the Atlas address (same database name) on any PC and start
the backend.

**Restore:** stop the backend, download the `.gz` from Drive (or use the local file), then
`restore-nightly.ps1 -Archive <file>`. Documents/photos need no restore step — they are
already in Drive and the app fetches them on demand.

`backup-openwa.ps1` / `register-scheduled-task-openwa.ps1` are an optional, separate
rclone-based copy of the WhatsApp gateway data; not scheduled by default.
