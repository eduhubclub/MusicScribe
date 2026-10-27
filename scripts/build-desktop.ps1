# Package the Windows Electron app (NSIS + portable).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $Root "desktop")

if (-not (Test-Path "node_modules")) {
    npm install
}

$exe = Join-Path "sidecar" "music-scribe-helper.exe"
if (-not (Test-Path $exe)) {
    Write-Error "Missing desktop\sidecar\music-scribe-helper.exe. Run scripts\build-sidecar.ps1 first."
}

npm run dist:win
Write-Host "Artifacts under desktop\dist\"
Get-ChildItem dist
