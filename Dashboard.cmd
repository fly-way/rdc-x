@echo off
cd /d "%~dp0"
node scripts\dashboard.mjs
if errorlevel 1 pause
