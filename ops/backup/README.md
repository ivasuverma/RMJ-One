# RMJ-One backups

Daily automatic backup of the RMJ-One database to Google Drive, keeping the
5 most recent backups (older ones are deleted automatically, locally and on
Drive).

Everything RMJ-One stores lives in MongoDB — including employee photos,
attendance selfies, and karigar slip photos, which are saved as base64 text
inside documents rather than as separate files — so a `mongodump` of the
database is a complete backup of the app's data. Nothing else on the server
needs to be backed up for this purpose.

**Backups contain sensitive personal data** — employee Aadhaar/PAN numbers,
bank account + IFSC, phone numbers, photos. Keep the Google Drive folder
private (don't share it, don't put it in a shared/team folder unless you
mean to).

## What's in this folder

- `backup.ps1` — does the actual work: mongodump → zip → upload to Drive →
  delete old backups beyond the last 5.
- `restore.ps1` — restores a backup zip back into MongoDB, with a
  confirmation prompt since it overwrites live data.
- `register-scheduled-task.ps1` — registers `backup.ps1` to run daily in
  Windows Task Scheduler.
- `backup-openwa.ps1` / `register-scheduled-task-openwa.ps1` — the same
  thing for the WhatsApp gateway (OpenWA). Its state (the paired WhatsApp
  session, API keys, audit log) lives entirely outside MongoDB at
  `E:\OpenWA\data`, so it needs its own separate backup — see "OpenWA
  backup" below. Uses the same `gdrive` rclone remote, just a different
  subfolder, so step 3 below only needs doing once for both.

## One-time setup (on RMJ Server)

### 1. Install MongoDB Database Tools

`mongodump`/`mongorestore` ship separately from the MongoDB server itself.
Download and install from:
https://www.mongodb.com/try/download/database-tools

Confirm it's on PATH: open a new PowerShell window and run `mongodump --version`.

### 2. Install rclone

Download the Windows build from https://rclone.org/downloads/, extract
`rclone.exe` somewhere permanent (e.g. `C:\Tools\rclone\`), and add that
folder to your system PATH (System Properties → Environment Variables).
Confirm with a new PowerShell window: `rclone version`.

### 3. Authorize rclone against your Google Drive

Run this **as the Windows user account you intend the backup task to run
as** (your own login is fine):

```powershell
rclone config
```

Walk through the prompts:
- `n` (new remote)
- name: `gdrive` (the scripts assume this exact name)
- storage type: search for `drive` and pick **Google Drive**
- client_id / client_secret: leave blank (press Enter) to use rclone's
  default — fine for personal use
- scope: `1` (full access)
- root_folder_id: leave blank
- service_account_file: leave blank
- "Edit advanced config?": `n`
- "Use auto config?": `y` if you have a browser available on this machine
  (it'll open a Google sign-in/consent page); if the server has no browser,
  say `n` and follow the printed instructions to authorize from another
  computer and paste the resulting code back in
- "Configure this as a Shared Drive?": `n` (unless you specifically use a
  Google Workspace Shared Drive)
- confirm `y` to save

Test it worked:

```powershell
rclone lsd gdrive:
```

This should list your Google Drive folders without error. The backup
folder (`RMJ-One-Backups`) doesn't need to exist yet — rclone creates it on
first upload.

### 4. Test the backup script manually

```powershell
cd E:\Rmj-One
powershell -ExecutionPolicy Bypass -File ops\backup\backup.ps1
```

Watch the output. On success you'll see `=== Backup finished successfully ===`.
Check:
- A new zip appeared in `E:\Rmj-One-Backups\`
- A log file appeared in `E:\Rmj-One-Backups\logs\`
- The file shows up in Google Drive under `RMJ-One-Backups`

If it fails, the error is printed and written to the log — the most likely
causes are `mongodump`/`rclone` not being on PATH, or step 3 not completed
under the right user account.

### 5. Register the daily schedule

```powershell
cd E:\Rmj-One
powershell -ExecutionPolicy Bypass -File ops\backup\register-scheduled-task.ps1
```

Defaults to running daily at 2:00 AM as your current Windows user (needed so
it can see that account's rclone authorization from step 3). You'll be
prompted once for your Windows password — Task Scheduler needs it to run
the job even when nobody's logged in. Pass `-Time '03:30'` to pick a
different time.

To change the schedule later, delete the task in Task Scheduler ("RMJ-One
Daily Backup") and re-run the script with a new `-Time`.

### 6. Verify it's really scheduled

Open **Task Scheduler** → Task Scheduler Library → find **RMJ-One Daily
Backup**. Right-click → Run, to fire it immediately as a final end-to-end
test, then check the log folder and Drive again.

## Restoring a backup

**This overwrites live data — only do this if you actually need to roll
back.** Get the backup zip either from `E:\Rmj-One-Backups\` (if it's still
local) or download it from the Google Drive `RMJ-One-Backups` folder, then:

```powershell
cd E:\Rmj-One
powershell -ExecutionPolicy Bypass -File ops\backup\restore.ps1 -ZipPath 'E:\Rmj-One-Backups\rmj-one-backup-2026-08-14_020000.zip'
```

It'll ask you to type `YES` to confirm before touching anything. Consider
stopping the backend first (`nssm stop RMJOneBackend`) so nothing writes to
the database mid-restore, then start it again (`nssm start RMJOneBackend`)
once the restore finishes.

## OpenWA backup (WhatsApp session)

Repeat steps 4-6 above with the OpenWA scripts instead, once rclone is
configured (step 3 is shared — do it once):

```powershell
cd E:\Rmj-One
powershell -ExecutionPolicy Bypass -File ops\backup\backup-openwa.ps1
powershell -ExecutionPolicy Bypass -File ops\backup\register-scheduled-task-openwa.ps1
```

This runs OpenWA's own `scripts/backup.sh` (via Git Bash) and uploads the
resulting archive to `gdrive:RMJ-One-Backups/openwa`. **This is the only
thing that lets a rebuilt server skip re-scanning the WhatsApp QR code** —
see `ops\setup-new-pc.ps1`'s `-OpenWABackup` parameter, which restores
straight from an archive this produces.

## What's not covered

- `backend\.env` and `E:\OpenWA\.env` (secrets: JWT_SECRET, Google OAuth
  client, API keys) aren't included in either backup and aren't in Drive —
  that's deliberate, so a secret doesn't sit in plaintext in your Drive
  alongside business data. Keep your own secure copy of both `.env` files
  separately (a password manager note, or an encrypted vault) so a
  from-scratch server rebuild has them available.
- This only backs up the database (+ OpenWA's own state via the second
  script above). If you ever add real file storage (uploads to disk, S3,
  etc.) instead of the current base64-in-Mongo approach, `backup.ps1` will
  need updating to cover that too.
