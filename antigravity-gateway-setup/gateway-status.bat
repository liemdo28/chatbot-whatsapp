@echo off
REM Check Antigravity Gateway port status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0gateway-port-block.ps1" -Status
pause
