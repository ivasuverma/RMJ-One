<#
.SYNOPSIS
  Restore the RMJ-One database (and optionally the document files) from a nightly backup.
.DESCRIPTION
  Sources: D:\RMJ-One\mongodb\backups\rmj_one-*.gz (local) or the same files in
  OneDrive\RMJ-One-Backup\database. DESTRUCTIVE: replaces the live database
  with the archive. Stop the backend first:  nssm stop RMJOneBackend
.EXAMPLE
  .\restore-nightly.ps1 -Archive D:\RMJ-One\mongodb\backups\rmj_one-2026-09-19_2227.gz
  .\restore-nightly.ps1 -Archive <file> -Files C:\Users\Administrator\OneDrive\RMJ-One-Backup\files\documents
#>
param(
    [Parameter(Mandatory)][string]$Archive,
    [string]$Files,                       # optional: folder of document files to copy back
    [string]$Uri = 'mongodb://127.0.0.1:27017'
)
$ErrorActionPreference = 'Stop'
$tool = (Get-ChildItem 'D:\RMJ-One\mongodb\tools' -Recurse -Filter mongorestore.exe | Select-Object -First 1).FullName
if (-not (Test-Path $Archive)) { throw "Archive not found: $Archive" }
if ((nssm status RMJOneBackend | Out-String) -match 'RUNNING') { throw 'Stop the backend first: nssm stop RMJOneBackend' }
& $tool --uri=$Uri --gzip --archive=$Archive --drop
if ($Files) { robocopy $Files 'D:\RMJ-One\RMJ-One\backend\data\doc_cache' /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null }
Write-Host 'Restored. Start the backend: nssm start RMJOneBackend'
