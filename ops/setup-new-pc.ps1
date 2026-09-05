<#
================================================================================
  RMJ One - one-file server setup for a NEW Windows PC
================================================================================
  Run this ONCE on a fresh Windows machine to rebuild the whole shop server:
  prerequisites, code, backend service, web service, the WhatsApp gateway
  (OpenWA), and (optionally) the Cloudflare tunnel and a database restore.

  WHAT YOU NEED IN HAND BEFORE RUNNING
    1. Your saved backend\.env file (JWT_SECRET, VAPID keys, Google Drive
       OAuth, OpenWA connection, etc.). This is NOT in git and NOT in the
       Drive backup on purpose. Keep a copy in your password manager. Point
       -EnvFile at it, or the script will open Notepad so you can paste it in.
    2. (Optional) A recent database backup .zip from E:\Rmj-One-Backups or the
       Google Drive "RMJ-One-Backups" folder, to restore your data. Point
       -BackupZip at it.
    3. Your saved OpenWA\.env file. Point -OpenWAEnvFile at it, or the script
       opens Notepad for it too. The API key in it must match OPENWA_API_KEY
       in backend\.env.
    4. (Optional but strongly recommended) A recent OpenWA backup archive
       (made by OpenWA's own scripts/backup.sh  -  see ops\backup\README.md for
       why this is separate from the Mongo backup above). Point -OpenWABackup
       at it to restore the paired WhatsApp session without re-scanning the
       QR code. Without it, WhatsApp needs a fresh QR scan on this PC.
    5. (Optional) Your Cloudflare Tunnel token (Zero Trust dashboard ->
       Networks -> Tunnels -> your tunnel -> Configure -> the `cloudflared
       service install <TOKEN>` string). Paste it when prompted.

  HOW TO RUN
    - Save this file somewhere on the new PC (e.g. Desktop).
    - Right-click PowerShell -> "Run as administrator".
    - Then:
        Set-ExecutionPolicy -Scope Process Bypass -Force
        .\setup-new-pc.ps1 -EnvFile 'C:\path\to\backend.env' -BackupZip 'C:\path\to\backup.zip' `
          -OpenWAEnvFile 'C:\path\to\openwa.env' -OpenWABackup 'C:\path\to\openwa-backup.tar.gz'
      (all four are optional; omit any of them to handle that part manually)

  This script is safe to re-run - it skips anything already done.
================================================================================
#>

[CmdletBinding()]
param(
  [string]$RepoDir      = 'E:\Rmj-One',
  [string]$RepoUrl      = 'https://github.com/ivasuverma/RMJ-One.git',
  [string]$Branch       = 'main',
  [string]$ApiUrl       = 'https://api.rmj.co.in',   # public backend URL baked into the web build
  [int]   $BackendPort  = 8000,                       # local port uvicorn listens on
  [int]   $WebPort      = 3000,                        # local port the static web build is served on
  [string]$EnvFile      = '',                          # path to your saved backend\.env (optional)
  [string]$BackupZip    = '',                          # path to a DB backup .zip to restore (optional)
  [string]$OpenWADir    = 'E:\OpenWA',                 # WhatsApp gateway checkout
  [string]$OpenWARepoUrl = 'https://github.com/rmyndharis/OpenWA.git',
  [string]$OpenWAEnvFile = '',                         # path to your saved OpenWA\.env (optional)
  [string]$OpenWABackup  = '',                         # archive from OpenWA's own scripts/backup.sh (optional)
  [switch]$SkipPrereqs                                # skip the winget installs if you've done them
)

$ErrorActionPreference = 'Stop'
function Say($m)  { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }

# --- must be admin (services + winget system installs need it) ---
$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
         ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Please run this in an ADMINISTRATOR PowerShell window.' }

# ------------------------------------------------------------------ 1. prereqs
if (-not $SkipPrereqs) {
  Say '1/10  Installing prerequisites with winget'
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'winget not found. Install "App Installer" from the Microsoft Store, then re-run.'
  }
  # id, friendly name. Each is skipped if already present.
  $pkgs = @(
    @{ id = 'Git.Git';                 name = 'Git' },
    @{ id = 'OpenJS.NodeJS.LTS';       name = 'Node.js LTS' },
    @{ id = 'Python.Python.3.11';      name = 'Python 3.11' },
    @{ id = 'MongoDB.Server';          name = 'MongoDB Server' },
    @{ id = 'MongoDB.DatabaseTools';   name = 'MongoDB Database Tools (mongodump/restore)' },
    @{ id = 'NSSM.NSSM';               name = 'NSSM (service manager)' },
    @{ id = 'Cloudflare.cloudflared';  name = 'cloudflared (tunnel)' },
    @{ id = 'Rclone.Rclone';           name = 'rclone (Drive backup)' }
  )
  foreach ($p in $pkgs) {
    Write-Host "  installing $($p.name) ..."
    winget install --id $($p.id) -e --silent --accept-source-agreements --accept-package-agreements `
      --disable-interactivity 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Ok $p.name } else { Warn "$($p.name): winget returned $LASTEXITCODE (may already be installed - continuing)" }
  }
  # Pull the freshly-installed tools onto THIS session's PATH.
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path','User')
  Ok 'Prerequisites step done'
} else {
  Warn 'Skipping prerequisite install (-SkipPrereqs)'
}

function Need($exe, $hint) {
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) {
    throw "'$exe' not found on PATH. $hint  Open a NEW admin PowerShell (so PATH refreshes) and re-run with -SkipPrereqs."
  }
}
Need 'git'  'Git did not land on PATH.'
Need 'node' 'Node.js did not land on PATH.'
Need 'nssm' 'NSSM did not land on PATH.'

# ------------------------------------------------------------------ 2. code
Say '2/10  Getting the code'
$parent = Split-Path -Parent $RepoDir
if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
if (Test-Path (Join-Path $RepoDir '.git')) {
  cd $RepoDir; git fetch origin $Branch; git reset --hard "origin/$Branch"
  Ok "Updated existing clone at $RepoDir"
} else {
  git clone $RepoUrl $RepoDir
  cd $RepoDir; git checkout $Branch
  Ok "Cloned into $RepoDir"
}

# ------------------------------------------------------------------ 3. backend .env
Say '3/10  Backend secrets (.env)'
$backend = Join-Path $RepoDir 'backend'
$envPath = Join-Path $backend '.env'
if ($EnvFile -and (Test-Path $EnvFile)) {
  Copy-Item -LiteralPath $EnvFile -Destination $envPath -Force
  Ok "Copied your .env from $EnvFile"
} elseif (Test-Path $envPath) {
  Ok '.env already present - leaving it untouched'
} else {
  Copy-Item (Join-Path $backend '.env.example') $envPath -Force
  Warn 'No .env supplied. Opening the template in Notepad - paste in your saved secrets'
  Warn 'and set ENVIRONMENT=production plus ALLOWED_ORIGINS=https://app.rmj.co.in, then Save & close.'
  Start-Process notepad $envPath -Wait
}

# ------------------------------------------------------------------ 4. backend venv + deps
Say '4/10  Backend Python environment'
$venvPy = Join-Path $backend '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) {
  Need 'python' 'Python did not land on PATH.'
  python -m venv (Join-Path $backend '.venv')
}
& $venvPy -m pip install --upgrade pip | Out-Null
& $venvPy -m pip install -r (Join-Path $backend 'requirements.txt')
# pywebpush is in requirements.txt, but install explicitly in case an older
# requirements file is ever used - push notifications depend on it.
& $venvPy -m pip install pywebpush | Out-Null
Ok 'Backend dependencies installed'

# ------------------------------------------------------------------ 5. frontend build
Say '5/10  Building the web app'
$frontend = Join-Path $RepoDir 'frontend'
"EXPO_PUBLIC_BACKEND_URL=$ApiUrl" | Set-Content -Path (Join-Path $frontend '.env') -Encoding ASCII
cd $frontend
cmd /c 'npm ci'
$env:EXPO_NO_TELEMETRY = '1'
cmd /c "npx expo export --platform web --output-dir dist"
if (-not (Test-Path (Join-Path $frontend 'dist\index.html'))) { throw 'Web export failed - no dist\index.html produced.' }
# `serve` gives static hosting with SPA fallback (deep links -> index.html).
cmd /c 'npm install -g serve'
Ok 'Web app built into frontend\dist'

# ------------------------------------------------------------------ 6. OpenWA (WhatsApp gateway)
Say '6/10  WhatsApp gateway (OpenWA)'
$openwaParent = Split-Path -Parent $OpenWADir
if (-not (Test-Path $openwaParent)) { New-Item -ItemType Directory -Path $openwaParent -Force | Out-Null }
if (Test-Path (Join-Path $OpenWADir '.git')) {
  cd $OpenWADir; git fetch origin main; git reset --hard origin/main
  Ok "Updated existing OpenWA clone at $OpenWADir"
} else {
  git clone $OpenWARepoUrl $OpenWADir
  cd $OpenWADir
  Ok "Cloned OpenWA into $OpenWADir"
}

$openwaEnvPath = Join-Path $OpenWADir '.env'
if ($OpenWAEnvFile -and (Test-Path $OpenWAEnvFile)) {
  Copy-Item -LiteralPath $OpenWAEnvFile -Destination $openwaEnvPath -Force
  Ok "Copied your OpenWA .env from $OpenWAEnvFile"
} elseif (Test-Path $openwaEnvPath) {
  Ok 'OpenWA .env already present - leaving it untouched'
} else {
  Copy-Item (Join-Path $OpenWADir '.env.example') $openwaEnvPath -Force
  Warn 'No OpenWA .env supplied. Opening the template in Notepad - paste in your saved secrets, then Save & close.'
  Warn 'Whatever API key ends up here (or gets auto-generated on first boot) must match OPENWA_API_KEY in backend\.env.'
  Start-Process notepad $openwaEnvPath -Wait
}

cmd /c 'npm ci'
Push-Location (Join-Path $OpenWADir 'dashboard')
cmd /c 'npm ci'
Pop-Location
cmd /c 'npm run build:all'
if (-not (Test-Path (Join-Path $OpenWADir 'dist\main.js'))) { throw 'OpenWA build failed - no dist\main.js produced.' }
Ok 'OpenWA built (nest build + dashboard)'

# Restoring OpenWA's own data (session, sqlite, api key) is what avoids a
# fresh WhatsApp QR-code scan on this PC - the Mongo backup below has nothing
# to do with this, OpenWA's state lives entirely outside the app database.
if ($OpenWABackup -and (Test-Path $OpenWABackup)) {
  $bash = Join-Path ${env:ProgramFiles} 'Git\bin\bash.exe'
  if (-not (Test-Path $bash)) { Need 'bash' 'Git Bash not found - needed to run OpenWA''s restore.sh.'; $bash = 'bash' }
  $openwaDirUnix  = $OpenWADir -replace '\\','/'
  $backupPathUnix = (Resolve-Path $OpenWABackup).Path -replace '\\','/'
  & $bash -lc "cd '$openwaDirUnix' && ./scripts/restore.sh '$backupPathUnix' --force"
  if ($LASTEXITCODE -ne 0) { throw 'OpenWA restore.sh failed - see output above.' }
  Ok 'OpenWA data restored (WhatsApp session, API keys, audit log) - no QR scan needed'
} else {
  Warn 'No -OpenWABackup given. WhatsApp will need a fresh QR-code scan once the service starts.'
}

# ------------------------------------------------------------------ 7. services (NSSM)
Say '7/10  Installing Windows services'
function Reinstall-Service($name, $exe, $params, $dir) {
  if ((nssm status $name) 2>$null) { nssm stop $name 2>$null | Out-Null; nssm remove $name confirm 2>$null | Out-Null }
  nssm install $name $exe $params | Out-Null
  nssm set $name AppDirectory $dir | Out-Null
  nssm set $name Start SERVICE_AUTO_START | Out-Null
  nssm set $name AppStdout (Join-Path $dir "$name.log") | Out-Null
  nssm set $name AppStderr (Join-Path $dir "$name.err.log") | Out-Null
}

# Backend: uvicorn on localhost:BackendPort
Reinstall-Service 'RMJOneBackend' $venvPy `
  "-m uvicorn server:app --host 127.0.0.1 --port $BackendPort" $backend

# Web: serve the static build on localhost:WebPort. Run node against serve's
# entry point directly (most reliable way to service a global npm CLI).
$node    = (Get-Command node).Source
$serveJs = Join-Path (cmd /c 'npm root -g').Trim() 'serve\build\main.js'
if (-not (Test-Path $serveJs)) { $serveJs = Join-Path (cmd /c 'npm root -g').Trim() 'serve\bin\serve.js' }
Reinstall-Service 'RMJOneWeb' $node `
  "`"$serveJs`" -s dist -l $WebPort --no-clipboard" $frontend

# WhatsApp gateway: run the built Nest app directly with node, exactly how the
# shop's existing box runs it - AppDirectory + relative `dist/main`.
Reinstall-Service 'RMJOneWhatsApp' $node 'dist/main' $OpenWADir

nssm start RMJOneBackend | Out-Null
nssm start RMJOneWeb | Out-Null
nssm start RMJOneWhatsApp | Out-Null
Start-Sleep 4
Ok "RMJOneBackend -> http://localhost:$BackendPort   RMJOneWeb -> http://localhost:$WebPort   RMJOneWhatsApp -> running"

# ------------------------------------------------------------------ 8. backend smoke test
Say '8/10  Backend smoke test'
$up = $false
for ($i=1; $i -le 10; $i++) {
  try { if ((Invoke-RestMethod "http://localhost:$BackendPort/api/" -TimeoutSec 5).status -eq 'ok') { $up=$true; break } } catch {}
  Start-Sleep 2
}
if ($up) { Ok 'Backend is answering' } else { Warn "Backend not answering yet - check $backend\RMJOneBackend.err.log (often a bad .env or Mongo not started)." }

# ------------------------------------------------------------------ 9. optional DB restore
Say '9/10  Database restore (optional)'
if ($BackupZip -and (Test-Path $BackupZip)) {
  nssm stop RMJOneBackend | Out-Null
  powershell -ExecutionPolicy Bypass -File (Join-Path $RepoDir 'ops\backup\restore.ps1') -ZipPath $BackupZip
  nssm start RMJOneBackend | Out-Null
  Ok 'Restore complete'
} else {
  Warn 'No -BackupZip given. Starting fresh with seeded demo data (owner / Owner@123).'
  Warn 'To restore later: powershell -File ops\backup\restore.ps1 -ZipPath <backup.zip>'
}

# ------------------------------------------------------------------ 10. Cloudflare tunnel
Say '10/10  Cloudflare tunnel (public https)'
if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
  $tok = Read-Host 'Paste your Cloudflare Tunnel token (or press Enter to skip and do it later)'
  if ($tok.Trim()) {
    cloudflared service install $tok.Trim()
    Ok 'cloudflared installed as a service.'
    Warn 'In the Cloudflare Zero Trust dashboard, make sure this tunnel routes:'
    Warn "    api.rmj.co.in  ->  http://localhost:$BackendPort"
    Warn "    app.rmj.co.in  ->  http://localhost:$WebPort"
  } else { Warn 'Skipped. Later: cloudflared service install <TOKEN>' }
} else { Warn 'cloudflared not found - install it, then: cloudflared service install <TOKEN>' }

# ------------------------------------------------------------------ done
Say 'Setup finished - remaining MANUAL steps'
@"
  These need your accounts/logins and can't be scripted unattended:

  A) Google Drive backups (Mongo + OpenWA)
       Follow ops\backup\README.md steps 2-6 (rclone config as 'gdrive',
       then register the daily task). Backups won't run until this is done -
       and without them, a future rebuild has no -BackupZip/-OpenWABackup to
       restore from, same as this run if you skipped those params.

  B) WhatsApp session
       If you didn't pass -OpenWABackup, RMJOneWhatsApp is running but not
       paired yet - open its dashboard/QR endpoint and scan with the shop's
       phone (same phone it was paired to before, if this is a rebuild).

  C) GitHub auto-deploy runner (so future `git push` redeploys this PC)
       GitHub repo -> Settings -> Actions -> Runners -> New self-hosted runner
       (Windows). Install it into $RepoDir and run it as a service. Without
       this, redeploy manually by re-running the frontend build + service
       restarts (see .github\workflows\deploy.yml for the exact commands).

  D) MongoDB service
       winget's MongoDB Server usually registers a 'MongoDB' Windows service
       set to auto-start. Confirm with:  Get-Service MongoDB
       If it's not there, install/start it, then restart RMJOneBackend.

  E) Push notifications
       Already handled if your .env has VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
       If not: cd backend; .\.venv\Scripts\python.exe generate_vapid_keys.py
       paste the two lines into backend\.env, then restart RMJOneBackend.

  Live URLs once the tunnel + DNS are up:
     App:  https://app.rmj.co.in
     API:  https://api.rmj.co.in/api/
"@ | Write-Host -ForegroundColor Gray
Ok 'All automated steps complete.'
