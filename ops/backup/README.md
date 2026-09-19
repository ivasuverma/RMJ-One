# RMJ-One backups

Everything runs on one Windows server; the database is a local MongoDB
(`RMJOneMongo`, data in `D:\RMJ-One\mongodb`). **Google Drive is the only off-site
place** — for documents/photos and for system backups. Nothing else (no OneDrive).

**Documents and photos** live permanently in Drive (`RMJ One Documents`). The server
keeps only small grid thumbnails, plus a temporary cache of recently opened files
(cleared after 7 days / 1 GB, only for files already in Drive). A photo is deleted from
the server only after it has reached Drive.

**System backups** — the scheduled task "RMJOne Mongo Backup" runs `backup-nightly.ps1`
at 02:30 (installed copy: `D:\RMJ-One\mongodbackup-local.ps1` — keep the two in sync):

| File (in `D:\RMJ-One\mongodbackups`) | What | Kept locally |
|---|---|---|
| `rmj_one-<date>.gz` | full database dump (mongodump archive) | 14 |
| `config-<date>.zip` | .env files, service definitions, backup script, WhatsApp gateway settings | 14 |

The backend (`backup_service.upload_system_backups`, hourly) sends new files to the
Drive folder **RMJ One Backups** and keeps the newest 30 there. Log:
`D:\RMJ-One\mongodb\logackup.log`. Code lives on GitHub.

**Restore:** stop the backend, download the `.gz` from Drive (or use the local file), then
`restore-nightly.ps1 -Archive <file>`. Documents/photos need no restore step — they are
already in Drive and the app fetches them on demand.

`backup-openwa.ps1` / `register-scheduled-task-openwa.ps1` are an optional, separate
rclone-based copy of the WhatsApp gateway data; not scheduled by default.
