<#
.SYNOPSIS
  Restore an RMJ-One backup zip (from backup.ps1) into MongoDB.

.DESCRIPTION
  Extracts the given zip and runs mongorestore --drop, which replaces each
  collection in the target database with what's in the backup. Everything
  written to that database since the backup was taken will be lost — the
  script asks for confirmation unless -Force is passed.

.EXAMPLE
  # Restore from a local backup file
  .\restore.ps1 -ZipPath 'E:\Rmj-One-Backups\rmj-one-backup-2026-08-14_020000.zip'

.EXAMPLE
  # Restore from a copy downloaded from Google Drive, skip the prompt
  .\restore.ps1 -ZipPath 'C:\Users\you\Downloads\rmj-one-backup-2026-08-10_020000.zip' -Force
#>
param(
    [Parameter(Mandatory = $true)][string]$ZipPath,
    [string]$RepoRoot = 'E:\Rmj-One',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ZipPath)) { throw "Zip not found: $ZipPath" }

$envFile = Join-Path $RepoRoot 'backend\.env'
$mongoUrl = 'mongodb://localhost:27017'
$dbName = 'rmj_one'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*MONGO_URL\s*=\s*(.+?)\s*$') { $mongoUrl = $Matches[1] }
        if ($_ -match '^\s*DB_NAME\s*=\s*(.+?)\s*$') { $dbName = $Matches[1] }
    }
}

if (-not (Get-Command mongorestore -ErrorAction SilentlyContinue)) {
    throw "mongorestore not found on PATH. Install MongoDB Database Tools: https://www.mongodb.com/try/download/database-tools"
}

$tmp = Join-Path $env:TEMP "rmj-restore-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Write-Host "Extracting $ZipPath -> $tmp"
Expand-Archive -Path $ZipPath -DestinationPath $tmp -Force

# backup.ps1 zips the dumped "<dbname>/*.bson" folder directly, so the zip's
# top level IS that folder. Handle it either way in case the zip was built
# differently (e.g. re-zipped by hand).
$dbDir = Join-Path $tmp $dbName
if (-not (Test-Path $dbDir)) {
    $firstDir = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
    if ($firstDir) { $dbDir = $firstDir.FullName }
}
if (-not (Test-Path $dbDir)) {
    throw "Couldn't find dumped collection files inside $ZipPath (looked for a '$dbName' folder)."
}

Write-Host ""
Write-Host "About to restore into database '$dbName' at $mongoUrl" -ForegroundColor Yellow
Write-Host "from: $dbDir" -ForegroundColor Yellow
Write-Host "THIS REPLACES EVERY COLLECTION IN THAT DATABASE WITH THE BACKUP." -ForegroundColor Yellow
Write-Host "Anything written since the backup was taken will be lost." -ForegroundColor Yellow
Write-Host ""

if (-not $Force) {
    $confirm = Read-Host "Type YES to continue"
    if ($confirm -ne 'YES') {
        Write-Host "Aborted — nothing was changed."
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
        exit 1
    }
}

Write-Host "Consider stopping RMJOneBackend first (nssm stop RMJOneBackend) so nothing"
Write-Host "writes to the database mid-restore, then start it again afterward."
Write-Host ""

& mongorestore --uri="$mongoUrl" --db="$dbName" --drop "$dbDir"
if ($LASTEXITCODE -ne 0) { throw "mongorestore exited with code $LASTEXITCODE" }

Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Write-Host "Restore complete."
