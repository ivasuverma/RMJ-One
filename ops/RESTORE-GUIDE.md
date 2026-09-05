# How to restore RMJ-One — plain-language guide

Three different situations, three different fixes. Find the one that matches
what's actually wrong and follow just that section.

---

## Situation 1: "I need to bring back some deleted/wrong records, but the app is working fine"

Example: someone deleted a customer by mistake, or a repair entry got messed
up, and you want to bring back yesterday's data without touching anything
that's fine right now.

**Do this — no computer/terminal needed, just the app:**

1. Open the app, go to **Settings → Backup**.
2. Under "Recent backups in Drive", find one from before the mistake
   happened (each one shows its date/time in the filename).
3. Tap **Restore** next to it.
4. Confirm when asked.

That's it. This is safe — it only adds back/updates records from that
backup, it does **not** delete anything currently in the app. Takes under a
minute for a normal-sized backup.

---

## Situation 2: "The database is corrupted / I want to wipe everything and go back to exactly one backup"

This is rare — only do this if Situation 1's "safe" restore isn't enough
because you specifically need an EXACT rollback (delete everything, then
restore only what was in the backup).

**You'll need:** Remote Desktop / physical access to the shop's server, and
the backup file downloaded from Google Drive (folder "RMJ One Backups").

1. Download the backup file (a `.json.gz` file) from Google Drive onto the
   server, e.g. into `C:\Downloads\`.
2. Open **PowerShell as Administrator** on the server.
3. Stop the app so nothing writes to the database while you restore:
   ```powershell
   nssm stop RMJOneBackend
   ```
4. Run the restore script — `--drop` means "wipe each collection first,
   exact replace":
   ```powershell
   cd E:\Rmj-One\backend
   .\.venv\Scripts\python.exe scripts\restore_backup.py "C:\Downloads\rmj-one-backup-2026-08-14_1200.json.gz" --drop
   ```
   It will ask you to type `yes` to confirm before doing anything.
5. Start the app again:
   ```powershell
   nssm start RMJOneBackend
   ```
6. Open the app and check everything looks right.

(Leave off `--drop` if you'd rather just merge/update instead of wiping —
same as the in-app Restore button in Situation 1.)

---

## Situation 3: "The whole server died — new/wiped Windows machine, starting from nothing"

This is the big one — a new PC, or the old one wiped and reinstalled.

### What you need in hand before you start

Gather these first (ideally you already keep copies in a password manager):

| # | What | Where it normally comes from |
|---|------|-------------------------------|
| 1 | Your saved `backend\.env` file | Your password manager / secure notes — this is NEVER backed up automatically on purpose (it holds secrets) |
| 2 | Your saved `OpenWA\.env` file | Same — also never auto-backed-up |
| 3 | A recent database backup | Google Drive folder **"RMJ-One-Backups"** (`.zip` file) |
| 4 | A recent OpenWA backup | Google Drive folder **"RMJ-One-Backups/openwa"** (`.tar.gz` file) — this is what avoids re-scanning the WhatsApp QR code |
| 5 | (optional) Cloudflare Tunnel token | Cloudflare Zero Trust dashboard → Networks → Tunnels → your tunnel → Configure |

Download items 1-4 onto the new PC first (e.g. onto the Desktop) so you can
point the installer at them.

### Steps

1. On the new/fresh Windows PC, install **Git** if this file didn't come
   with it already (you need it to even get this script) — or just copy
   `ops\setup-new-pc.ps1` onto the new PC any way you like (USB stick,
   email it to yourself, etc.) — it's a single file, it doesn't need the
   rest of the repo yet.

2. Right-click **PowerShell → Run as administrator**.

3. Allow the script to run this once:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass -Force
   ```

4. Run the installer, pointing it at the 4 files you gathered above:
   ```powershell
   .\setup-new-pc.ps1 `
     -EnvFile 'C:\Users\you\Desktop\backend.env' `
     -BackupZip 'C:\Users\you\Desktop\rmj-one-backup-2026-08-14_020000.zip' `
     -OpenWAEnvFile 'C:\Users\you\Desktop\openwa.env' `
     -OpenWABackup 'C:\Users\you\Desktop\openwa-backup-2026-08-14_020000.tar.gz'
   ```
   (Adjust the paths to wherever you actually saved those 4 files.)

5. Just watch it work — it installs everything by itself: Git, Node,
   Python, MongoDB, all the app code, the WhatsApp gateway, and restores
   both your business data AND your paired WhatsApp session. Takes maybe
   15-30 minutes depending on internet speed. It prints `[ok]` after each
   step, or `[!]` for something that needs your attention.

6. At the very end it prints a short list of things that still need doing
   by hand (things that need your Google/Cloudflare/GitHub login, which
   can't be scripted) — read that list, it tells you exactly what's left.

7. Open the app and check it looks right. If WhatsApp isn't sending
   messages, that's the one thing that sometimes still needs a manual
   QR-code re-scan even with `-OpenWABackup` — check the OpenWA
   dashboard.

### If you don't have a recent OpenWA backup (item 4 above)

That's fine — everything still works, you'll just need to re-pair WhatsApp
by scanning the QR code again with the shop's phone, same as setting it up
the very first time. Nothing else is affected.

### If you don't have a recent database backup (item 3 above) either

The app will start fresh with demo data (login `owner` / `Owner@123`) —
change that password immediately. You will have lost all real business
data back to whenever your last backup actually was, so this is the
scenario the daily backups (see below) exist to prevent.

---

## Making sure you never end up with an old/missing backup

Two separate daily backups need to be running — check both are actually
scheduled (a fresh Windows PC doesn't have these until you set them up
once):

```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -like '*Backup*' }
```

You should see **both** `RMJ-One Daily Backup` and `OpenWA Daily Backup`
listed. If either is missing, see `ops\backup\README.md` for the one-time
setup (needs your Google Drive login once, via `rclone config`).

To test either one works right now, without waiting for 2 AM:
```powershell
Start-ScheduledTask -TaskName 'RMJ-One Daily Backup'
Start-ScheduledTask -TaskName 'OpenWA Daily Backup'
```
Then check Google Drive for the new files a minute or two later.

---

## The Jsoft WhatsApp relay (separate from all of the above)

This is the small helper that makes Jsoft Extreme's own "send WhatsApp on
sale" feature go out through WhatsApp. It's unrelated to RMJ-One's own
backup/restore — it's not business data, just a small always-running
program.

Lives at: `D:\JSoft_Extreme\WhatsAppRelay`
Runs as Windows service: `JsoftWhatsAppRelay`

**If it stops working** (Jsoft's WhatsApp messages aren't sending), first
check if the service is even running:
```powershell
nssm status JsoftWhatsAppRelay
```

**To reinstall it from scratch** (new PC, or the service got removed):
```powershell
cd D:\JSoft_Extreme\WhatsAppRelay
Set-ExecutionPolicy -Scope Process Bypass -Force
.\install-relay.ps1
```
This needs `relay.py` to already be in that folder — copy it from a backup
of `D:\JSoft_Extreme\WhatsAppRelay` if it's missing (there's no automated
backup of this folder specifically — it's small and rarely changes, so a
manual copy every so often, or just re-copying the file from this repo's
history/an old backup, is enough).

Check it's healthy:
```powershell
Invoke-RestMethod http://127.0.0.1:9003/health
```
Should print `ok : True`.
