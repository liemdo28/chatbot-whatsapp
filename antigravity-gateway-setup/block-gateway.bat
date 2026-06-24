@echo off
REM Block Antigravity Gateway (port 3456) before builds
REM Run as Administrator! Uses -Force to actually kill the gateway (otherwise it keeps respawning).
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0gateway-port-block.ps1\" -Block -Force' -Verb RunAs -Wait"
pause
