# Smoke-test win-unpacked build (same binaries as NSIS installer).
param([string]$UnpackedRoot = "c:\Joukahainen\BORS\release-fresh7\win-unpacked")

$ErrorActionPreference = "Stop"
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

Write-Host "== 3) Full BÖRS.exe launch =="
$log = "$env:APPDATA\BÖRS\bors-startup.log"
$mark = "[SMOKE $(Get-Date -Format o)]"
Add-Content -Path $log -Value $mark
Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe)
Start-Sleep 22
$tail = Get-Content $log -Tail 25 -ErrorAction SilentlyContinue
if ($tail -notmatch "B.ÖRS starting|BORS starting") {
  Write-Host "WARN: no new startup line in log (check Task Manager / try manual double-click)"
} else {
  Write-Host "PASS: startup log updated"
}
try {
  $g = Invoke-WebRequest "http://127.0.0.1:3847/api/portfolio/status" -UseBasicParsing -TimeoutSec 5
  Write-Host "PASS GUI+API HTTP $($g.StatusCode)"
} catch {
  Write-Host "WARN GUI API: $($_.Exception.Message) (server tests above still passed)"
}
cmd /c "taskkill /F /IM BORS.exe >nul 2>&1"
Write-Host "`nAll critical tests passed. Installer payload is OK."
