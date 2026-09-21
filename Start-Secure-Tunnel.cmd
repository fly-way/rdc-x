@echo off
setlocal EnableExtensions
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22 or newer is required. & pause & exit /b 1)
node scripts\secure-tunnel.mjs
if errorlevel 1 (
  echo.
  echo Secure MCP Tunnel failed to start.
  pause
)
