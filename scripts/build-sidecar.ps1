# Build the Music Scribe PyInstaller sidecar for Windows.
# Output: desktop\sidecar\ (onedir) for electron-builder extraResources.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Error "Create .venv first (.\setup.ps1), then re-run."
}

& .\.venv\Scripts\python.exe -m pip install -U pip pyinstaller

$OutDir = Join-Path $Root "desktop\sidecar"
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Path $OutDir | Out-Null

$env:PYTHONPATH = Join-Path $Root "backend"
& .\.venv\Scripts\pyinstaller.exe `
  --noconfirm `
  --clean `
  --distpath (Join-Path $Root "sidecar\dist") `
  --workpath (Join-Path $Root "sidecar\build") `
  (Join-Path $Root "sidecar\music_scribe_helper.spec")

$HelperDir = Join-Path $Root "sidecar\dist\music-scribe-helper"
if (-not (Test-Path $HelperDir)) {
    Write-Error "Expected onedir at $HelperDir"
}
Copy-Item -Recurse -Force (Join-Path $HelperDir "*") $OutDir

if (-not (Test-Path (Join-Path $OutDir "frontend"))) {
    Copy-Item -Recurse -Force (Join-Path $Root "frontend") (Join-Path $OutDir "frontend")
}

Write-Host "Sidecar ready at $OutDir"
Get-ChildItem $OutDir | Select-Object -First 20
