# Launch BORS production server with portfolio DB under %LOCALAPPDATA%\BORS
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $env:LOCALAPPDATA "BORS"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
$env:BORS_DB_PATH = Join-Path $dataDir "portfolio.db"
$env:BORS_USER_DATA = $dataDir
Set-Location $Root
if (-not (Test-Path (Join-Path $Root "dist\server.cjs"))) {
  Write-Host "Building…"
  npm run build
}
Write-Host "BORS data: $env:BORS_DB_PATH"
npm start
