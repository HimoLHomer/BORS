# Smoke-test win-unpacked build (same binaries as NSIS installer).
param(
  [string]$UnpackedRoot = (Join-Path $PSScriptRoot "..\release\win-unpacked")
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $UnpackedRoot)) {
  throw "Unpacked build not found at $UnpackedRoot - run npm run electron:build first."
}
$UnpackedRoot = (Resolve-Path -LiteralPath $UnpackedRoot).Path

$exeItem = Get-ChildItem -Path $UnpackedRoot -Filter "*.exe" -File |
  Where-Object { $_.Name -notmatch 'elevate' } |
  Select-Object -First 1
if (-not $exeItem) {
  throw "No packaged exe found under $UnpackedRoot"
}
$exe = $exeItem.FullName

Stop-Process -Name ($exeItem.BaseName) -Force -ErrorAction SilentlyContinue
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $exe } |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

$server = Join-Path $UnpackedRoot "resources\app.asar.unpacked\dist\server.cjs"
$asar = Join-Path $UnpackedRoot "resources\app.asar"
$nm = Join-Path $UnpackedRoot "resources\app.asar.unpacked\node_modules"
$sqlite = (Resolve-Path -LiteralPath (Join-Path $nm "better-sqlite3")).Path

if (-not (Test-Path $server)) { throw "Bundled server not found at $server" }
if (-not (Test-Path $sqlite)) { throw "better-sqlite3 not found at $sqlite" }

Write-Host "== 1) SQLite native module (Electron ABI) =="
$sqlOut = cmd /c "set ELECTRON_RUN_AS_NODE=1&& `"$exe`" -e `"const db=require(process.argv[1]); new db(':memory:'); console.log('PASS sqlite ABI='+process.versions.modules)`" `"$sqlite`"" 2>&1
$sqlOut = "$sqlOut"
if ($sqlOut -notmatch "PASS sqlite") { throw "SQLite test failed: $sqlOut" }
Write-Host $sqlOut

Write-Host "== 2) API server (bundled server.cjs) =="
$db = Join-Path $env:TEMP "bors-smoke.db"
Remove-Item $db -ErrorAction SilentlyContinue
$env:NODE_ENV = "production"
$env:BORS_QUIET = "1"
$env:PORT = "3847"
$env:BORS_LISTEN_HOST = "127.0.0.1"
$env:BORS_APP_ROOT = $asar
$env:BORS_DIST_ROOT = Split-Path $server
$env:BORS_DB_PATH = $db
$env:BORS_USER_DATA = Join-Path $env:TEMP "bors-smoke"
$env:NODE_PATH = $nm
$p = Start-Process -FilePath $exe -ArgumentList "`"$server`"" -WorkingDirectory (Split-Path $server) -PassThru -WindowStyle Hidden
Start-Sleep 6
$status = Invoke-WebRequest "http://127.0.0.1:3847/api/portfolio/status" -UseBasicParsing -TimeoutSec 10
if ($status.StatusCode -ne 200) { throw "API status $($status.StatusCode)" }
Write-Host "PASS API $($status.StatusCode) $($status.Content)"
$uiRes = Invoke-WebRequest "http://127.0.0.1:3847/" -UseBasicParsing -TimeoutSec 10
if ($uiRes.StatusCode -ne 200 -or $uiRes.Content -notmatch 'id="root"') { throw "UI failed" }
Write-Host "PASS UI HTTP $($uiRes.StatusCode)"
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue

Write-Host "== 3) App icon embedded in packaged exe =="
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
if (-not $icon) { throw "No icon resource on $exe" }
if ($icon.Width -lt 16 -or $icon.Height -lt 16) { throw "Icon on $exe looks invalid ($($icon.Width)x$($icon.Height))" }
Write-Host "PASS icon $($icon.Width)x$($icon.Height) on $($exeItem.Name)"
$icon.Dispose()

Write-Host "`nPackaged app smoke tests passed."
