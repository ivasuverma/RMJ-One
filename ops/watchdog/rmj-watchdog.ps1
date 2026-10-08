<#
  RMJ One - server watchdog (runs every 2 minutes as the "RMJOne Watchdog"
  scheduled task, registered by .github/workflows/deploy.yml).

  Keeps the shop server answering without anyone having to restart the PC:
    * MongoDB and the Cloudflare tunnel (cloudflared) services are started
      again if they have stopped.
    * If the backend (http://localhost:8000/api/) fails to answer on two runs
      in a row, a crash report is saved to ops\logs\incidents\ (what the
      services were doing, memory, the backend's last log lines, recent
      Windows errors / sleep events) and the backend is restarted.
    * Never restarts more than once every 10 minutes, so a backend that can't
      start can't be thrown into a restart loop.
  Everything it does is written to ops\logs\watchdog.log.
#>
param([string]$Repo = 'D:\RMJ-One\RMJ-One', [int]$Port = 8000)

$ErrorActionPreference = 'Continue'
$logDir = Join-Path $Repo 'ops\logs'
$incDir = Join-Path $logDir 'incidents'
New-Item -ItemType Directory -Force -Path $incDir | Out-Null
$logFile = Join-Path $logDir 'watchdog.log'
$stateFile = Join-Path $logDir 'watchdog-state.json'

function Log($msg) { Add-Content -Path $logFile -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) }
function Status($name) { ((nssm status $name 2>$null | Out-String) -replace '[^A-Za-z_]', '') }
function IsUp {
  try { $r = Invoke-RestMethod -Uri "http://localhost:$Port/api/" -TimeoutSec 15; return ($r.status -eq 'ok') } catch { return $false }
}

# Keep the log small: past 2 MB, keep only the newest half.
if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 2MB) {
  $keep = Get-Content $logFile | Select-Object -Last 5000; Set-Content -Path $logFile -Value $keep
}

$state = @{ fails = 0; last_restart = '' }
if (Test-Path $stateFile) { try { $j = Get-Content $stateFile -Raw | ConvertFrom-Json; $state.fails = [int]$j.fails; $state.last_restart = [string]$j.last_restart } catch { } }
function Save { $state | ConvertTo-Json | Set-Content -Path $stateFile }

# 1) The database and the internet link must be running.
foreach ($svc in @('MongoDB', 'Cloudflared')) {
  $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
  if ($s -and $s.Status -ne 'Running') {
    Log "$svc was $($s.Status) - starting it"
    try { Start-Service -Name $svc -ErrorAction Stop; Log "$svc started" } catch { Log "$svc could not start: $($_.Exception.Message)" }
  }
}

# 2) The backend must answer.
if (IsUp) {
  if ($state.fails -gt 0) { Log 'backend answering again'; $state.fails = 0; Save }
  exit 0
}
$state.fails += 1; Save
Log "backend not answering (check $($state.fails))"
if ($state.fails -lt 2) { exit 0 }

if ($state.last_restart) {
  $since = (Get-Date) - [datetime]::Parse($state.last_restart)
  if ($since.TotalMinutes -lt 10) { Log "restarted $([int]$since.TotalMinutes) min ago - waiting before trying again"; exit 0 }
}

# 3) Crash report, then restart.
$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm'
$report = Join-Path $incDir "$stamp.txt"
$lines = @("RMJ One server incident $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') (PC time)", '')
$lines += "RMJOneBackend: $(Status 'RMJOneBackend')   RMJOneWeb: $(Status 'RMJOneWeb')"
foreach ($svc in @('MongoDB', 'Cloudflared')) { $s = Get-Service -Name $svc -ErrorAction SilentlyContinue; $lines += "${svc}: $(if ($s) { $s.Status } else { 'not installed' })" }
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
if ($os) { $lines += ("PC memory free: {0:N0} MB of {1:N0} MB; up since {2}" -f ($os.FreePhysicalMemory / 1KB), ($os.TotalVisibleMemorySize / 1KB), $os.LastBootUpTime) }
$py = Get-Process -Name python* -ErrorAction SilentlyContinue
foreach ($p in $py) { $lines += ("python pid {0}: {1:N0} MB, CPU {2:N0}s, started {3}" -f $p.Id, ($p.WorkingSet64 / 1MB), $p.CPU, $p.StartTime) }
$err = (nssm get RMJOneBackend AppStderr 2>$null | Out-String).Trim() -replace "`0", ''
$out = (nssm get RMJOneBackend AppStdout 2>$null | Out-String).Trim() -replace "`0", ''
foreach ($f in @($err, $out) | Where-Object { $_ } | Select-Object -Unique) {
  if (Test-Path $f) { $lines += ''; $lines += "--- last lines of $f ---"; $lines += Get-Content $f -Tail 80 }
}
$lines += ''; $lines += '--- Windows events, last 3 hours (errors, sleep/wake, unexpected shutdowns) ---'
try {
  $ev = Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = (Get-Date).AddHours(-3) } -ErrorAction Stop |
    Where-Object { $_.Level -le 2 -or $_.Id -in 41, 42, 107, 6008, 1074 -or $_.ProviderName -match 'Power' } | Select-Object -First 25
  foreach ($e in $ev) { $lines += ("{0:HH:mm:ss}  {1} {2}: {3}" -f $e.TimeCreated, $e.ProviderName, $e.Id, (($e.Message -split "`n")[0])) }
} catch { $lines += "(could not read events: $($_.Exception.Message))" }

Log 'restarting backend'
nssm stop RMJOneBackend 2>$null | Out-Null
for ($i = 0; $i -lt 10 -and (Status 'RMJOneBackend') -ne 'SERVICE_STOPPED'; $i++) { Start-Sleep -Seconds 2 }
# A process that won't stop (stuck) is ended so the port is free again.
Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'uvicorn' -and $_.CommandLine -match "--port $Port" } |
  ForEach-Object { Log "ending stuck backend process $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
nssm start RMJOneBackend 2>$null | Out-Null
$ok = $false
for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Seconds 3; if (IsUp) { $ok = $true; break } }
$lines += ''; $lines += "Restart result: $(if ($ok) { 'backend answering again' } else { 'still NOT answering after 60s' })"
Set-Content -Path $report -Value $lines
Log "restart $(if ($ok) { 'worked' } else { 'did NOT bring it back' }) - report $report"

$state.fails = 0; $state.last_restart = (Get-Date).ToString('o'); Save
# Keep 60 days of reports.
Get-ChildItem $incDir -Filter *.txt | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-60) } | Remove-Item -Force -ErrorAction SilentlyContinue
