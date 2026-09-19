# RMJ-One nightly backup.
#   1. Database dump  -> D:\RMJ-One\mongodb\backups           (keep 14)
#   2. Everything     -> OneDrive\RMJ-One-Backup              (database keep 7, files mirrored, config, README)
# Runs as the "RMJOne Mongo Backup" scheduled task at 02:30.
$root  = 'D:\RMJ-One\mongodb'
$app   = 'D:\RMJ-One\RMJ-One'
$od    = 'C:\Users\Administrator\OneDrive\RMJ-One-Backup'
$log   = "$root\log\backup.log"
function Log($m) { Add-Content $log "$(Get-Date -Format s) $m" }

# ---- 1. database dump (local) ----
$tool = (Get-ChildItem "$root\tools" -Recurse -Filter mongodump.exe | Select-Object -First 1).FullName
$dest = "$root\backups\rmj_one-$(Get-Date -Format yyyy-MM-dd_HHmm).gz"
& $tool --uri=mongodb://127.0.0.1:27017 --db=rmj_one --archive=$dest --gzip 2>&1 | Out-Null
if (-not ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 1MB))) {
    Log 'FAILED database dump'
    Remove-Item $dest -ErrorAction SilentlyContinue
    exit 1
}
Get-ChildItem "$root\backups\rmj_one-*.gz" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | ForEach-Object { $_.Delete() }
Log "ok database $((Get-Item $dest).Length) bytes"

# local mirror of the document/photo files (originals live only on this server + Google Drive)
robocopy "$app\backend\data\doc_cache" "$root\backups\doc_store" /MIR /XF *.tmp /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null

# ---- 2. OneDrive: the off-machine copy of everything ----
try {
    New-Item -ItemType Directory -Force "$od\database", "$od\files\documents", "$od\config" | Out-Null

    Copy-Item $dest "$od\database\" -Force
    Get-ChildItem "$od\database\rmj_one-*.gz" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 7 | ForEach-Object { $_.Delete() }

    # documents + photos: untouched originals, on-screen copies and thumbnails
    robocopy "$app\backend\data\doc_cache" "$od\files\documents" /MIR /XF *.tmp /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null

    # configuration needed to rebuild the server (secrets included - this is your own OneDrive)
    Copy-Item "$app\backend\.env"  "$od\config\backend.env"  -Force
    Copy-Item "$app\frontend\.env" "$od\config\frontend.env" -Force
    Copy-Item "$root\mongod.cfg"   "$od\config\mongod.cfg"   -Force
    Copy-Item "$root\backup-local.ps1" "$od\config\backup-local.ps1" -Force
    # WhatsApp gateway: settings + its databases. Not the 1.7 GB browser session or
    # the media cache - if the session is ever lost, WhatsApp is simply re-linked by QR code.
    try {
        New-Item -ItemType Directory -Force "$od\config\openwa" | Out-Null
        Copy-Item 'D:\RMJ-One\OpenWA\.env' "$od\config\openwa\" -Force
        foreach ($f in '.api-key', 'main.sqlite', 'openwa.sqlite') {
            $src = "D:\RMJ-One\OpenWA\data\$f"
            if (Test-Path $src) {
                # open the file shared so a running gateway doesn't block the copy
                $in = [System.IO.File]::Open($src, 'Open', 'Read', 'ReadWrite')
                try { $out = [System.IO.File]::Create("$od\config\openwa\$f"); $in.CopyTo($out); $out.Close() } finally { $in.Close() }
            }
        }
    } catch { Log "warn openwa copy: $($_.Exception.Message)" }
    $svc = foreach ($n in 'RMJOneBackend','RMJOneWeb','RMJOneMongo','RMJOneWhatsApp','RMJOneRunner') {
        "=== $n ==="; (& nssm dump $n 2>&1) -join "`n"; ''
    }
    Set-Content "$od\config\services-nssm.txt" $svc
    schtasks /Query /TN "RMJOne Mongo Backup" /XML 2>$null | Set-Content "$od\config\scheduled-task.xml"

    Set-Content "$od\README-RESTORE.txt" @"
RMJ-One backup - refreshed every night at 02:30 (last: $(Get-Date -Format 'yyyy-MM-dd HH:mm'))

database\   rmj_one-<date>.gz     newest 7 nightly database dumps (mongodump archive, gzip)
files\documents\                  every document/photo: <id>.full = untouched original,
                                  <id>.view = on-screen copy, <id>.thumb = grid thumbnail
config\                           backend.env, frontend.env, mongod.cfg, Windows service
                                  definitions (services-nssm.txt), this backup script
Code is on GitHub (origin main), not copied here.

RESTORE (new server):
 1. Install MongoDB 8 + Database Tools; start mongod with config\mongod.cfg.
 2. mongorestore --uri=mongodb://127.0.0.1:27017 --gzip --archive=<dump>.gz --drop
 3. Copy files\documents\ to <app>\backend\data\doc_cache\
 4. Clone the repo, place config\backend.env / frontend.env, recreate services from services-nssm.txt.
"@
    Log 'ok onedrive'
} catch {
    Log "FAILED onedrive: $($_.Exception.Message)"
    exit 2
}
