# RMJ-One backups

Everything runs on one Windows server; the database is a local MongoDB
(`RMJOneMongo`, data in `D:\RMJ-One\mongodb`).

**Nightly at 02:30** (scheduled task "RMJOne Mongo Backup", runs `backup-nightly.ps1`,
installed copy: `D:\RMJ-One\mongodb\backup-local.ps1` — keep the two in sync):

| Where | What | Kept |
|---|---|---|
| `D:\RMJ-One\mongodb\backups\` | database dump `rmj_one-<date>.gz`, mirror of document files (`doc_store`) | 14 dumps |
| `OneDrive\RMJ-One-Backup\` | `database\` dumps, `files\documents\` (all documents/photos), `config\` (.env files, service definitions, WhatsApp gateway settings/db), `README-RESTORE.txt` | 7 dumps |
| Google Drive | document/photo originals (uploaded as they arrive) and the app's own nightly database backup (Settings → Google Drive) | 30 |

Log: `D:\RMJ-One\mongodb\log\backup.log`. Code lives on GitHub.

**Restore:** stop the backend, then `restore-nightly.ps1 -Archive <file> [-Files <folder>]`
(see the script header). `restore_backup.py` in `backend\scripts` restores the app's own
Drive-format (`.json.gz`) backups.

`backup-openwa.ps1` / `register-scheduled-task-openwa.ps1` are an optional, separate
rclone-based copy of the WhatsApp gateway data to Google Drive; they are not scheduled by default.
