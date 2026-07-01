# Smoke-test win-unpacked build (same binaries as NSIS installer).
param(
  [string]$UnpackedRoot = (Join-Path $PSScriptRoot "..\release\win-unpacked")
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $UnpackedRoot)) {
  throw "Unpacked build not found at $UnpackedRoot — run npm run electron:build first."
}

cmd /c "taskkill /F /IM BORS.exe >nul 2>&1"
Start-Sleep 2

$exe = (Get-ChildItem "$UnpackedRoot\B*.exe" | Where-Object { $_.Name -notmatch 'elevate' } | Select-Object -First 1).FullName
$server = "$UnpackedRoot\resources\app.asar.unpacked\dist\server.cjs"
$asar = "$UnpackedRoot\resources\app.asar"
$nm = "$UnpackedRoot\resources\app.asar.unpacked\node_modules"
$sqlite = "$nm\better-sqlite3"

Write-Host "== 1) SQLite native module (Electron ABI) =="
$env:ELECTRON_RUN_AS_NODE = "1"
$sqlOut = & $exe -e "const db=require(process.argv[1]); new db(':memory:'); console.log('PASS sqlite ABI='+process.versions.modules)" $sqlite 2>&1
$sqlOut = "$sqlOut"
if ($sqlOut -notmatch "PASS sqlite") { throw "SQLite test failed: $sqlOut" }
Write-Host $sqlOut

Write-Host "== 2) API server (bundled server.cjs) =="
$db = "$env:TEMP\bors-smoke.db"
Remove-Item $db -ErrorAction SilentlyContinue
$env:NODE_ENV = "production"
$env:BORS_QUIET = "1"
$env:PORT = "3847"
$env:BORS_LISTEN_HOST = "127.0.0.1"
$env:BORS_APP_ROOT = $asar
$env:BORS_DIST_ROOT = Split-Path $server
$env:BORS_DB_PATH = $db
$env:BORS_USER_DATA = "$env:TEMP\bors-smoke"
$env:NODE_PATH = $nm
$p = Start-Process -FilePath $exe -ArgumentList "`"$server`"" -WorkingDirectory (Split-Path $server) -PassThru -WindowStyle Hidden
Start-Sleep 6
$status = Invoke-WebRequest "http://127.0.0.1:3847/api/portfolio/status" -UseBasicParsing -TimeoutSec 10
if ($status.StatusCode -ne 200) { throw "API status $($status.StatusCode)" }
Write-Host "PASS API $($status.StatusCode) $($status.Content)"
$home = Invoke-WebRequest "http://127.0.0.1:3847/" -UseBasicParsing -TimeoutSec 10
if ($home.StatusCode -ne 200 -or $home.Content -notmatch 'id="root"') { throw "UI failed" }
Write-Host "PASS UI HTTP $($home.StatusCode)"
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue

Write-Host "`nPackaged app smoke tests passed."
