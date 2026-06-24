@echo off
REM Unblock Antigravity Gateway (port 3456) after builds
REM Run as Administrator!
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0gateway-port-block.ps1\" -Unblock' -Verb RunAs -Wait"
pause
