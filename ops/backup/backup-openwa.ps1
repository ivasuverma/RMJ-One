<#
.SYNOPSIS
  OpenWA daily backup: runs OpenWA's own scripts/backup.sh (captures the
  paired WhatsApp session, API keys, audit log, SQLite data) and uploads the
  resulting archive to Google Drive via rclone, keeping the N most recent.

.DESCRIPTION
  Separate from backup.ps1 (which dumps RMJ-One's own MongoDB) because
  OpenWA's state lives entirely outside MongoDB, at $OpenWADir\data  -  most
  importantly the paired WhatsApp session (whatsapp-web.js LocalAuth /
  Baileys auth state). Without this backup, a server rebuild can restore
  every business record via backup.ps1/restore.ps1 but WhatsApp itself still
  needs a fresh QR-code scan (see ops\setup-new-pc.ps1's -OpenWABackup param,
  which is exactly what an archive from THIS script feeds).

  Delegates the actual capture to OpenWA's own scripts/backup.sh (it knows
  its own config resolution  -  env vars, .env, .env.generated  -  far better
  than a script living outside that repo could), then just uploads +
  rotates, the same way backup.ps1 does for the Mongo dump.

.PREREQUISITES (one-time, see README.md in this folder)
  - Git for Windows (ships bash.exe)  -  already required by
    ops\setup-new-pc.ps1, so nothing new to install on this box.
  - rclone installed and configured with a remote named "gdrive" (the SAME
    one backup.ps1 uses  -  this just uploads under a different subfolder).

.NOTES
  The archive can contain database passwords, plugin secrets, and an admin
  API key (OpenWA's own backup.sh says as much)  -  keep the destination Drive
  folder private.
#>
param(
    [string]$OpenWADir = 'E:\OpenWA',
    [string]$RcloneRemote = 'gdrive:RMJ-One-Backups/openwa',
    [int]$KeepCount = 5
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$backupsDir = Join-Path $OpenWADir 'backups'
$logDir = Join-Path $backupsDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "backup-$stamp.log"

function Log([string]$msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

try {
    Log "=== OpenWA backup started ==="

    $bash = Join-Path ${env:ProgramFiles} 'Git\bin\bash.exe'
    if (-not (Test-Path $bash)) {
        $cmd = Get-Command bash -ErrorAction SilentlyContinue
        if ($cmd) { $bash = $cmd.Source } else { throw "Git Bash not found. Install Git for Windows (ships bash.exe) and re-run." }
    }
    if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
        throw "rclone not found on PATH. Install from https://rclone.org/downloads/ and run 'rclone config' first (see README.md)."
    }

    # --- Run OpenWA's own backup script (captures data/, sessions/, baileys/,
    #     main.sqlite/openwa.sqlite, .api-key, .env.generated into a tar.gz) ---
    $openwaDirUnix = $OpenWADir -replace '\\', '/'
    Log "Running OpenWA's scripts/backup.sh in $OpenWADir"
    $backupOutput = & $bash -lc "cd '$openwaDirUnix' && ./scripts/backup.sh" 2>&1
    $backupOutput | ForEach-Object { Log "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "backup.sh exited with code $LASTEXITCODE" }

    $archive = Get-ChildItem -Path $backupsDir -Filter 'openwa-backup-*.tar.gz' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $archive) { throw "backup.sh reported success but no openwa-backup-*.tar.gz was found in $backupsDir" }
    $sizeMB = [math]::Round($archive.Length / 1MB, 2)
    Log "Backup archive: $($archive.Name) ($sizeMB MB)"

    # --- Upload to Google Drive ---
    Log "Uploading to $RcloneRemote"
    $copyOutput = & rclone copy $archive.FullName $RcloneRemote --log-level INFO 2>&1
    $copyOutput | ForEach-Object { Log "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "rclone copy exited with code $LASTEXITCODE" }
    Log "Upload complete"

    # --- Rotate: keep only the $KeepCount most recent, locally and on Drive ---
    Log "Rotating local backups (keep $KeepCount)"
    Get-ChildItem -Path $backupsDir -Filter 'openwa-backup-*.tar.gz' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip $KeepCount |
        ForEach-Object {
            Log "  deleting local $($_.Name)"
            Remove-Item $_.FullName -Force
        }

    Log "Rotating Drive backups (keep $KeepCount)"
    $remoteListJson = & rclone lsjson $RcloneRemote 2>&1
    if ($LASTEXITCODE -ne 0) {
        Log "  WARNING: could not list $RcloneRemote for rotation ($remoteListJson)  -  skipping remote rotation this run"
    } else {
        $remoteFiles = $remoteListJson | ConvertFrom-Json
        $remoteFiles |
            Where-Object { $_.Name -like 'openwa-backup-*.tar.gz' } |
            Sort-Object ModTime -Descending |
            Select-Object -Skip $KeepCount |
            ForEach-Object {
                Log "  deleting remote $($_.Name)"
                & rclone deletefile "$RcloneRemote/$($_.Name)" 2>&1 | ForEach-Object { Log "    $_" }
            }
    }

    Log "=== OpenWA backup finished successfully ==="
    exit 0
}
catch {
    Log "!!! OPENWA BACKUP FAILED: $($_.Exception.Message)"
    exit 1
}
