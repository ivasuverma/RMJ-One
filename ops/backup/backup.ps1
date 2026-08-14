<#
.SYNOPSIS
  RMJ-One daily backup: mongodump -> zip -> upload to Google Drive via rclone,
  keeping only the N most recent backups (default 5) both locally and on Drive.

.DESCRIPTION
  Everything RMJ-One persists lives in MongoDB (employee records, attendance,
  payroll, repairs, karigar ledger, tasks, audit log — even photos/selfies are
  stored as base64 strings inside documents, not on disk), so a mongodump of
  the app's database is a complete backup. This script:
    1. Reads the Mongo connection string + DB name from backend\.env.
    2. Runs mongodump to a temp folder, then zips it into a single archive.
    3. Uploads that archive to a Google Drive folder via rclone.
    4. Deletes older backups beyond -KeepCount, locally and on Drive.
  Safe to run against a live server — no need to stop RMJOneBackend first.

.PREREQUISITES (one-time, see README.md in this folder)
  - MongoDB Database Tools installed (mongodump/mongorestore on PATH).
  - rclone installed and configured with a remote named "gdrive" pointing at
    the Google account backups should land in (`rclone config`).

.NOTES
  Backups contain employee PII (Aadhaar, PAN, bank account/IFSC, phone
  numbers, photos) — keep the destination Drive folder private, don't share
  it publicly or with more people than need it.
#>
param(
  [string]$RepoRoot = 'E:\Rmj-One',
  [string]$BackupRoot = 'E:\Rmj-One-Backups',
  [string]$RcloneRemote = 'gdrive:RMJ-One-Backups',
  [int]$KeepCount = 5
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$logDir = Join-Path $BackupRoot 'logs'
New-Item -ItemType Directory -Force -Path $BackupRoot, $logDir | Out-Null
$logFile = Join-Path $logDir "backup-$stamp.log"

function Log([string]$msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

try {
    Log "=== RMJ-One backup started ==="

    # --- Read Mongo connection from backend\.env (fallback to defaults) ---
    $envFile = Join-Path $RepoRoot 'backend\.env'
    $mongoUrl = 'mongodb://localhost:27017'
    $dbName = 'rmj_one'
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*MONGO_URL\s*=\s*(.+?)\s*$') { $mongoUrl = $Matches[1] }
            if ($_ -match '^\s*DB_NAME\s*=\s*(.+?)\s*$') { $dbName = $Matches[1] }
        }
    } else {
        Log "WARNING: $envFile not found — using defaults ($mongoUrl, db=$dbName)"
    }
    Log "Using DB '$dbName' at $mongoUrl"

    if (-not (Get-Command mongodump -ErrorAction SilentlyContinue)) {
        throw "mongodump not found on PATH. Install MongoDB Database Tools: https://www.mongodb.com/try/download/database-tools"
    }
    if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
        throw "rclone not found on PATH. Install from https://rclone.org/downloads/ and run 'rclone config' first (see README.md)."
    }

    # --- Dump ---
    $dumpDir = Join-Path $BackupRoot "tmp-dump-$stamp"
    Log "Running mongodump -> $dumpDir"
    $dumpOutput = & mongodump --uri="$mongoUrl" --db="$dbName" --out="$dumpDir" 2>&1
    $dumpOutput | ForEach-Object { Log "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "mongodump exited with code $LASTEXITCODE" }

    $dumpedDbDir = Join-Path $dumpDir $dbName
    if (-not (Test-Path $dumpedDbDir)) {
        throw "mongodump reported success but $dumpedDbDir doesn't exist — nothing to back up. Is '$dbName' the right database name?"
    }

    # --- Zip ---
    $zipName = "rmj-one-backup-$stamp.zip"
    $zipPath = Join-Path $BackupRoot $zipName
    Log "Compressing to $zipPath"
    Compress-Archive -Path $dumpedDbDir -DestinationPath $zipPath -Force
    Remove-Item -Recurse -Force $dumpDir

    $sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
    Log "Backup archive: $zipName ($sizeMB MB)"

    # --- Upload to Google Drive ---
    Log "Uploading to $RcloneRemote"
    $copyOutput = & rclone copy $zipPath $RcloneRemote --log-level INFO 2>&1
    $copyOutput | ForEach-Object { Log "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "rclone copy exited with code $LASTEXITCODE" }
    Log "Upload complete"

    # --- Rotate: keep only the $KeepCount most recent, locally and on Drive ---
    Log "Rotating local backups (keep $KeepCount)"
    Get-ChildItem -Path $BackupRoot -Filter 'rmj-one-backup-*.zip' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip $KeepCount |
        ForEach-Object {
            Log "  deleting local $($_.Name)"
            Remove-Item $_.FullName -Force
        }

    Log "Rotating Drive backups (keep $KeepCount)"
    $remoteListJson = & rclone lsjson $RcloneRemote 2>&1
    if ($LASTEXITCODE -ne 0) {
        Log "  WARNING: could not list $RcloneRemote for rotation ($remoteListJson) — skipping remote rotation this run"
    } else {
        $remoteFiles = $remoteListJson | ConvertFrom-Json
        $remoteFiles |
            Where-Object { $_.Name -like 'rmj-one-backup-*.zip' } |
            Sort-Object ModTime -Descending |
            Select-Object -Skip $KeepCount |
            ForEach-Object {
                Log "  deleting remote $($_.Name)"
                & rclone deletefile "$RcloneRemote/$($_.Name)" 2>&1 | ForEach-Object { Log "    $_" }
            }
    }

    Log "=== Backup finished successfully ==="
    exit 0
}
catch {
    Log "!!! BACKUP FAILED: $($_.Exception.Message)"
    exit 1
}
