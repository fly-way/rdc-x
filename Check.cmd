@echo off
cd /d "%~dp0"
call npm.cmd run check
call npm.cmd test
call npm.cmd run doctor
pause
