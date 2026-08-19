@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist "%ROOT%qb-ops-agent\.env" (
  echo [X] qb-ops-agent\.env khong ton tai. Chay INSTALL-ONE-CLICK.bat truoc.
  pause
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%a in ("%ROOT%qb-ops-agent\.env") do (
  set "%%a=%%b"
)

if "%MI_CORE_API_KEY%"=="" (
  echo [X] MI_CORE_API_KEY chua duoc cau hinh trong qb-ops-agent\.env
  pause
  exit /b 1
)

if "%MI_CORE_URL%"=="" (
  echo [X] MI_CORE_URL chua duoc cau hinh trong qb-ops-agent\.env
  pause
  exit /b 1
)

set PASS=0
set FAIL=0

echo.
echo ================================================================
echo   LAPTOP2 - VERIFY INSTALLATION
echo ================================================================
echo.

echo [1/8] Kiem tra Mi-Core health...
curl -s -o nul -w "  HTTP Status: %%{http_code}\n" --max-time 5 "%MI_CORE_URL%/api/health" 2>nul
if errorlevel 1 (
  echo   [X] Khong the ket noi Mi-Core
  set /a FAIL+=1
) else (
  echo   [OK] Mi-Core reachable
  set /a PASS+=1
)
echo.

echo [2/8] Kiem tra mi-node-agent (port 4100)...
netstat -aon | findstr :4100 | findstr LISTENING >nul
if errorlevel 1 (
  echo   [X] Port 4100 khong listening
  set /a FAIL+=1
) else (
  echo   [OK] Port 4100 listening
  curl -s --max-time 3 http://localhost:4100/health
  echo.
  set /a PASS+=1
)
echo.

echo [3/8] Kiem tra qb-ops-agent SOAP (port 3457)...
netstat -aon | findstr :3457 | findstr LISTENING >nul
if errorlevel 1 (
  echo   [X] Port 3457 khong listening
  set /a FAIL+=1
) else (
  echo   [OK] Port 3457 listening
  curl -s --max-time 3 http://localhost:3457/api/status
  echo.
  set /a PASS+=1
)
echo.

echo [4/8] Kiem tra whatsapp-ai-gateway (port 3212)...
netstat -aon | findstr :3212 | findstr LISTENING >nul
if errorlevel 1 (
  echo   [X] Port 3212 khong listening
  set /a FAIL+=1
) else (
  echo   [OK] Port 3212 listening
  curl -s --max-time 3 http://localhost:3212/health
  echo.
  set /a PASS+=1
)
echo.

echo [5/8] Kiem tra doordash-agent (port 3461)...
netstat -aon | findstr :3461 | findstr LISTENING >nul
if errorlevel 1 (
  echo   [X] Port 3461 khong listening
  set /a FAIL+=1
) else (
  echo   [OK] Port 3461 listening
  set /a PASS+=1
)
echo.

echo [6/8] Kiem tra qb-laptop-02 heartbeat tren Mi-Core...
curl -s --max-time 5 -H "X-API-Key: %MI_CORE_API_KEY%" "%MI_CORE_URL%/api/qb-agent/machines" 2>nul | findstr "qb-laptop-02" >nul
if errorlevel 1 (
  echo   [X] qb-laptop-02 chua xuat hien tren Mi-Core
  set /a FAIL+=1
) else (
  echo   [OK] qb-laptop-02 da heartbeat len Mi-Core
  set /a PASS+=1
)
echo.

echo [7/8] Kiem tra node laptop2 da register Mi-Core...
curl -s --max-time 5 "%MI_CORE_URL%/api/nodes/list" 2>nul | findstr "laptop2" >nul
if errorlevel 1 (
  echo   [X] laptop2 chua register Mi-Core
  echo       Kiem tra mi-node-agent\.env voi NODE_ID va NODE_SECRET
  set /a FAIL+=1
) else (
  echo   [OK] laptop2 da register Mi-Core
  set /a PASS+=1
)
echo.

echo [8/8] Kiem tra QBWC WSDL endpoint...
netstat -aon | findstr :3457 | findstr LISTENING >nul
if not errorlevel 1 (
  curl -s --max-time 3 -o nul -w "  WSDL HTTP Status: %%{http_code}\n" "http://localhost:3457/qbwc?wsdl" 2>nul
  if errorlevel 1 (
    echo   [X] WSDL khong tra ve
    set /a FAIL+=1
  ) else (
    echo   [OK] WSDL endpoint ready
    set /a PASS+=1
  )
) else (
  echo   [SKIP] Port 3457 khong listening
)
echo.

echo ================================================================
echo   TONG KET
echo ================================================================
echo   PASS: !PASS!
echo   FAIL: !FAIL!
echo ================================================================
echo.

if !FAIL! gtr 0 (
  echo Mot so check fail - xem logs\ de debug.
) else (
  echo Tat ca check pass.
)

echo.
pause
endlocal
