@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [RDC-X] Checking Node.js...
where node >nul 2>nul || goto :missing_node
for /f "delims=" %%V in ('node -p "Number(process.versions.node.split('.')[0])" 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto :missing_node
if %NODE_MAJOR% LSS 22 (
  echo [RDC-X] Node.js 22 or newer is required. Current major version: %NODE_MAJOR%
  goto :failed
)

echo [RDC-X] Synchronizing dependencies...
call npm.cmd install --prefer-offline --no-audit --no-fund
if errorlevel 1 (
  echo [RDC-X] npm install failed.
  goto :failed
)

echo [RDC-X] Preparing local configuration...
call npm.cmd run setup
if errorlevel 1 (
  echo [RDC-X] setup failed.
  goto :show_log
)

echo [RDC-X] Building...
call npm.cmd run build
if errorlevel 1 (
  echo [RDC-X] build failed.
  goto :failed
)

echo [RDC-X] Starting RDC-X and opening the Secure Tunnel sign-in page...
node scripts\launch.mjs
if errorlevel 1 goto :show_log
exit /b 0

:missing_node
echo [RDC-X] Node.js 22 or newer was not found in PATH.
echo Install/update Node.js, reopen this window, then run Start-All.cmd again.
goto :failed

:show_log
echo.
echo [RDC-X] Startup diagnostics:
if exist ".rdc\server.log" (
  powershell.exe -NoLogo -NoProfile -NonInteractive -Command "Get-Content -LiteralPath '.rdc\server.log' -Tail 80" 2>nul
) else (
  echo No .rdc\server.log file was created.
)

:failed
echo.
echo [RDC-X] Start failed. The window will stay open so the error can be read.
pause
exit /b 1
