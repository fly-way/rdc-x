@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 22 or newer first. & pause & exit /b 1)
if not exist node_modules call npm.cmd install
if errorlevel 1 (pause & exit /b 1)
call npm.cmd run setup
if errorlevel 1 (pause & exit /b 1)
call npm.cmd run build
if errorlevel 1 (pause & exit /b 1)
node scripts\launch.mjs
if errorlevel 1 pause
