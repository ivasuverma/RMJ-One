<#
.SYNOPSIS
  Restore the RMJ-One database from a nightly backup.
.DESCRIPTION
  Source: the newest D:\RMJ-One\mongodb\backups\rmj_one-*.gz, or the same file downloaded
  from the Google Drive folder "RMJ One Backups". Documents and photos need no restore:
  they live in Google Drive and the app fetches them on demand.
  DESTRUCTIVE: replaces the live database with the archive.
  Stop the backend first:  nssm stop RMJOneBackend
.EXAMPLE
  .\restore-nightly.ps1 -Archive D:\RMJ-One\mongodb\backups\rmj_one-2026-09-19_2301.gz
#>
param(
    [Parameter(Mandatory)][string]$Archive,
    [string]$Uri = 'mongodb://127.0.0.1:27017'
)
$ErrorActionPreference = 'Stop'
$tool = (Get-ChildItem 'D:\RMJ-One\mongodb\tools' -Recurse -Filter mongorestore.exe | Select-Object -First 1).FullName
if (-not (Test-Path $Archive)) { throw "Archive not found: $Archive" }
if ((nssm status RMJOneBackend | Out-String) -match 'RUNNING') { throw 'Stop the backend first: nssm stop RMJOneBackend' }
& $tool --uri=$Uri --gzip --archive=$Archive --drop
Write-Host 'Restored. Start the backend: nssm start RMJOneBackend'
