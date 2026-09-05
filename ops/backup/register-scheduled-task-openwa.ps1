<#
.SYNOPSIS
  Registers a Windows Task Scheduler job that runs backup-openwa.ps1 daily.

.DESCRIPTION
  Same rationale as register-scheduled-task.ps1 (for the Mongo backup): runs
  under a real user account rather than SYSTEM, because rclone's Google
  Drive authorization is stored per-user. If you already ran 'rclone config'
  for the Mongo backup, it's the SAME remote  -  nothing more to configure
  there, this just adds a second scheduled job a few minutes apart so the
  two backups don't contend for the same rclone/network resources.

  Run 'rclone config' as this same account BEFORE running this script, if
  you haven't already for the Mongo backup task.

.EXAMPLE
  .\register-scheduled-task-openwa.ps1
  .\register-scheduled-task-openwa.ps1 -Time '02:20'
#>
param(
    [string]$RepoRoot = 'E:\Rmj-One',
    [string]$Time = '02:20',
    [string]$UserName = "$env:USERDOMAIN\$env:USERNAME",
    [string]$TaskName = 'OpenWA Daily Backup'
)

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $RepoRoot 'ops\backup\backup-openwa.ps1'
if (-not (Test-Path $scriptPath)) { throw "backup-openwa.ps1 not found at $scriptPath" }

Write-Host "This task will run as $UserName, daily at $Time, so it can use that"
Write-Host "account's rclone Google Drive authorization. Make sure you already ran"
Write-Host "'rclone config' as this same account  -  if not, Ctrl+C and do that first."
Write-Host "(If you already registered the Mongo backup task, it's the same rclone"
Write-Host "config  -  you don't need to run 'rclone config' again.)"
Write-Host ""
$cred = Get-Credential -UserName $UserName -Message "Windows password for $UserName (needed to run the task even when logged out)"

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -WakeToRun

Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $trigger -Settings $settings `
    -User $cred.UserName -Password $cred.GetNetworkCredential().Password `
    -RunLevel Highest `
    -Description 'Runs OpenWA''s own backup.sh (WhatsApp session, API keys, audit log) and uploads it to Google Drive via rclone, keeps the last 5.' `
    -Force | Out-Null

Write-Host ""
Write-Host "Registered '$TaskName' to run daily at $Time as $($cred.UserName)."
Write-Host "Test it right now with:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Then check the log at E:\OpenWA\backups\logs\ and the Google Drive folder."
