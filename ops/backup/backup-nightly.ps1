# RMJ-One nightly backup (runs as the "RMJOne Mongo Backup" scheduled task at 02:30).
#   1. Database dump        -> D:\RMJ-One\mongodb\backups\rmj_one-<date>.gz   (keep 14)
#   2. Configuration bundle -> D:\RMJ-One\mongodb\backups\config-<date>.zip   (keep 14)
# The backend then uploads both to Google Drive ("RMJ One Backups" folder) within the hour.
# Documents and photos are NOT copied here: Google Drive is their only permanent home.
$root = 'D:\RMJ-One\mongodb'
$app  = 'D:\RMJ-One\RMJ-One'
$log  = "$root\log\backup.log"
function Log($m) { Add-Content $log "$(Get-Date -Format s) $m" }

# ---- 1. database dump ----
$tool = (Get-ChildItem "$root\tools" -Recurse -Filter mongodump.exe | Select-Object -First 1).FullName
$stamp = Get-Date -Format yyyy-MM-dd_HHmm
$dest = "$root\backups\rmj_one-$stamp.gz"
& $tool --uri=mongodb://127.0.0.1:27017 --db=rmj_one --archive=$dest --gzip 2>&1 | Out-Null
if (-not ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 100KB))) {
    Log 'FAILED database dump'
    Remove-Item $dest -ErrorAction SilentlyContinue
    exit 1
}
Get-ChildItem "$root\backups\rmj_one-*.gz" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | ForEach-Object { $_.Delete() }
Log "ok database $((Get-Item $dest).Length) bytes"

# ---- 2. configuration bundle (what is needed to rebuild the server; contains secrets) ----
try {
    $tmp = Join-Path $env:TEMP "rmj-config-$stamp"
    New-Item -ItemType Directory -Force $tmp | Out-Null
    Copy-Item "$app\backend\.env"  "$tmp\backend.env"  -Force
    Copy-Item "$app\frontend\.env" "$tmp\frontend.env" -Force
    Copy-Item "$root\mongod.cfg"   "$tmp\mongod.cfg"   -Force
    Copy-Item "$root\backup-local.ps1" "$tmp\backup-local.ps1" -Force
    if (Test-Path 'C:\ProgramData\cloudflared\token') { Copy-Item 'C:\ProgramData\cloudflared\token' "$tmp\cloudflared.token" -Force }
    if (Test-Path 'D:\RMJ-One\OpenWA\.env') { Copy-Item 'D:\RMJ-One\OpenWA\.env' "$tmp\openwa.env" -Force }
    if (Test-Path 'D:\RMJ-One\OpenWA\data\.api-key') { Copy-Item 'D:\RMJ-One\OpenWA\data\.api-key' "$tmp\openwa.api-key" -Force }
    $svc = foreach ($n in 'RMJOneBackend','RMJOneWeb','RMJOneMongo','RMJOneWhatsApp','RMJOneRunner') {
        "=== $n ==="; (& nssm dump $n 2>&1) -join "`n"; ''
    }
    Set-Content "$tmp\services-nssm.txt" $svc
    schtasks /Query /TN "RMJOne Mongo Backup" /XML 2>$null | Set-Content "$tmp\scheduled-task.xml"
    Set-Content "$tmp\README-RESTORE.txt" @"
RMJ-One configuration bundle, $(Get-Date -Format 'yyyy-MM-dd HH:mm')
Restore on a new server: install MongoDB 8 + Database Tools, start mongod with mongod.cfg,
mongorestore --gzip --archive=rmj_one-<date>.gz --drop, clone the repo (GitHub origin main),
put backend.env / frontend.env in place, recreate the services from services-nssm.txt.
Documents and photos are in Google Drive ("RMJ One Documents"); the app fetches them on demand.
"@
    Compress-Archive -Path "$tmp\*" -DestinationPath "$root\backups\config-$stamp.zip" -Force
    Remove-Item $tmp -Recurse -Force
    Get-ChildItem "$root\backups\config-*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | ForEach-Object { $_.Delete() }
    Log 'ok config bundle'
} catch {
    Log "FAILED config bundle: $($_.Exception.Message)"
    exit 2
}
