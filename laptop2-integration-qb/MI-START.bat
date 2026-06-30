@echo off
REM ════════════════════════════════════════════════════════════════════════════
REM  MI-START — chỉ khởi động mi-node-agent (port 4100)
REM ════════════════════════════════════════════════════════════════════════════
setlocal
chcp 65001 >nul

set ROOT=%~dp0
cd /d "%ROOT%mi-node-agent"

echo.
echo ════════════════════════════════════════════════════════════════
echo   MI-NODE-AGENT (Laptop2 ↔ Mi-Core)
echo ════════════════════════════════════════════════════════════════
echo   Port:     4100
echo   Node ID:  laptop2
echo   Mi-Core:  http://100.118.102.113:4001
echo ════════════════════════════════════════════════════════════════
echo.

if not exist "dist\server.js" (
  echo [X] dist\server.js khong ton tai. Chay INSTALL-ONE-CLICK.bat truoc.
  pause
  exit /b 1
)

REM Load env vars tu file .env
for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
  set "%%a=%%b"
)

if "%NODE_SECRET%"=="" (
  echo [X] NODE_SECRET chua duoc set trong .env
  echo     Mo file mi-node-agent\.env va dien NODE_SECRET
  pause
  exit /b 1
)

echo Khoi dong mi-node-agent (port 4100)...
node dist\server.js
echo.
echo mi-node-agent da thoat.
pause
endlocal