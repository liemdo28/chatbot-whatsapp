@echo off
REM ════════════════════════════════════════════════════════════════════════════
REM  QB-START — chỉ khởi động qb-ops-agent (port 3457)
REM ════════════════════════════════════════════════════════════════════════════
setlocal
chcp 65001 >nul

set ROOT=%~dp0
cd /d "%ROOT%qb-ops-agent"

echo.
echo ════════════════════════════════════════════════════════════════
echo   QB-OPS-AGENT (Integration-QB → Mi-Core)
echo ════════════════════════════════════════════════════════════════
echo   Port:     3457 (SOAP / QBWC)
echo   Mi-Core:  http://100.118.102.113:4001
echo   Machine:  qb-laptop-02
echo ════════════════════════════════════════════════════════════════
echo.

if not exist "dist\index.js" (
  echo [X] dist\index.js khong ton tai. Chay INSTALL-ONE-CLICK.bat truoc.
  pause
  exit /b 1
)

if not exist ".env" (
  echo [X] .env khong ton tai. Copy env-laptop2.example.txt thanh .env hoac chay INSTALL-ONE-CLICK.bat.
  pause
  exit /b 1
)

REM Load env vars tu file .env
for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
  set "%%a=%%b"
)

if "%MI_CORE_API_KEY%"=="" (
  echo [X] MI_CORE_API_KEY chua duoc set trong qb-ops-agent\.env
  pause
  exit /b 1
)

if "%QBWC_PASSWORD%"=="" (
  echo [X] QBWC_PASSWORD chua duoc set trong qb-ops-agent\.env
  pause
  exit /b 1
)

echo Khoi dong qb-ops-agent (port 3457)...
node dist\index.js
echo.
echo qb-ops-agent da thoat.
pause
endlocal
