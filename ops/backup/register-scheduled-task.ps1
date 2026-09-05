<#
.SYNOPSIS
  Registers a Windows Task Scheduler job that runs backup.ps1 daily.

.DESCRIPTION
  Runs under a real user account (yours, by default) rather than SYSTEM,
  because rclone's Google Drive authorization (from `rclone config`) is
  stored per-user under that account's profile  -  a task running as SYSTEM
  wouldn't be able to see it and every upload would fail. You'll be prompted
  once for that account's Windows password so the task can run "whether
  logged on or not" (i.e. even overnight with nobody logged in).

  Run 'rclone config' as this same account BEFORE running this script.

.EXAMPLE
  .\register-scheduled-task.ps1
  .\register-scheduled-task.ps1 -Time '03:30'
#>
param(
    [string]$RepoRoot = 'E:\Rmj-One',
    [string]$Time = '02:00',
    [string]$UserName = "$env:USERDOMAIN\$env:USERNAME",
    [string]$TaskName = 'RMJ-One Daily Backup'
)

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $RepoRoot 'ops\backup\backup.ps1'
if (-not (Test-Path $scriptPath)) { throw "backup.ps1 not found at $scriptPath" }

Write-Host "This task will run as $UserName, daily at $Time, so it can use that"
Write-Host "account's rclone Google Drive authorization. Make sure you already ran"
Write-Host "'rclone config' as this same account  -  if not, Ctrl+C and do that first."
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
    -Description 'Dumps MongoDB, zips, uploads to Google Drive via rclone, keeps the last 5 backups.' `
    -Force | Out-Null

Write-Host ""
Write-Host "Registered '$TaskName' to run daily at $Time as $($cred.UserName)."
Write-Host "Test it right now with:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Then check the log at E:\Rmj-One-Backups\logs\ and the Google Drive folder."
