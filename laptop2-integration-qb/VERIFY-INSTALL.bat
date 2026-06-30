@echo off
REM ════════════════════════════════════════════════════════════════════════════
REM  LAPTOP2 — VERIFY-INSTALL
REM  Kiểm tra kết nối Mi-Core + tất cả services
REM ════════════════════════════════════════════════════════════════════════════
setlocal enabledelayedexpansion
chcp 65001 >nul

set ROOT=%~dp0
cd /d "%ROOT%"

set MI_CORE_URL=http://100.118.102.113:4001
set MI_CORE_API_KEY=b149c4783a1109ff46d01498d91766e7
set PASS=0
set FAIL=0

echo.
echo ════════════════════════════════════════════════════════════════
echo   LAPTOP2 — VERIFY INSTALLATION
echo ════════════════════════════════════════════════════════════════
echo.

REM ── Check 1: Mi-Core PC có sống không ───────────────────────────────────
echo [1/8] Kiem tra Mi-Core PC (100.118.102.113:4001)...
curl -s -o nul -w "  HTTP Status: %%{http_code}\n" --max-time 5 "%MI_CORE_URL%/api/health" 2>nul
if errorlevel 1 (
  echo   [X] KHONG THE KET NOI Mi-Core - kiem tra mang/Tailscale
  set /a FAIL+=1
) else (
  echo   [OK] Mi-Core reachable
  set /a PASS+=1
)
echo.

REM ── Check 2: mi-node-agent port 4100 ────────────────────────────────────
echo [2/8] Kiem tra mi-node-agent (port 4100)...
netstat -aon | findstr :4100 | findstr LISTENING >nul
if errorlevel 1 (
  echo   [X] Port 4100 khong listening - service chua chay
  set /a FAIL+=1
) else (
  echo   [OK] Port 4100 listening
  curl -s --max-time 3 http://localhost:4100/health
  echo.
  set /a PASS+=1
)
echo.

REM ── Check 3: qb-ops-agent port 3457 SOAP ────────────────────────────────
echo [3/8] Kiem tra qb-ops-agent SOAP (port 3457)...
netstat -aon | findstr :3457 | findstr LISTENING >nul
if errorlevel 1 (
  echo   [X] Port 3457 khong listening - qb-ops-agent chua chay
  set /a FAIL+=1
) else (
  echo   [OK] Port 3457 listening
  curl -s --max-time 3 http://localhost:3457/api/status
  echo.
  set /a PASS+=1
)
echo.

REM ── Check 4: whatsapp-ai-gateway port 3212 ─────────────────────────────
echo [4/8] Kiem tra whatsapp-ai-gateway (port 3212)...
netstat -aon | findstr :3212 | findstr LISTENING >nul
if errorlevel 1 (
  echo   [X] Port 3212 khong listening - gateway chua chay
  set /a FAIL+=1
) else (
  echo   [OK] Port 3212 listening
  curl -s --max-time 3 http://localhost:3212/health
  echo.
  set /a PASS+=1
)
echo.

REM ── Check 5: doordash-agent port 3461 ──────────────────────────────────
echo [5/8] Kiem tra doordash-agent (port 3461)...
netstat -aon | findstr :3461 | findstr LISTENING >nul
if errorlevel 1 (
  echo   [X] Port 3461 khong listening - agent chua chay
  set /a FAIL+=1
) else (
  echo   [OK] Port 3461 listening
  set /a PASS+=1
)
echo.

REM ── Check 6: QB agent heartbeat Mi-Core ────────────────────────────────
echo [6/8] Kiem tra qb-laptop-02 heartbeat tren Mi-Core...
curl -s --max-time 5 -H "X-API-Key: %MI_CORE_API_KEY%" "%MI_CORE_URL%/api/qb-agent/machines" 2>nul | findstr "qb-laptop-02" >nul
if errorlevel 1 (
  echo   [X] qb-laptop-02 chua xuat hien tren Mi-Core (can heartbeat moi nhat)
  set /a FAIL+=1
) else (
  echo   [OK] qb-laptop-02 da heartbeat len Mi-Core
  set /a PASS+=1
)
echo.

REM ── Check 7: mi-node-agent registered ──────────────────────────────────
echo [7/8] Kiem tra node "laptop2" da register Mi-Core...
curl -s --max-time 5 "%MI_CORE_URL%/api/nodes/list" 2>nul | findstr "laptop2" >nul
if errorlevel 1 (
  echo   [X] "laptop2" chua register Mi-Core
  echo       Kiem tra .env NODE_ID=laptop2 va NODE_SECRET
  set /a FAIL+=1
) else (
  echo   [OK] "laptop2" da register Mi-Core
  set /a PASS+=1
)
echo.

REM ── Check 8: file QBWC WSDL có sẵn sàng cho QuickBooks Web Connector ───
echo [8/8] Kiem tra QBWC WSDL endpoint...
netstat -aon | findstr :3457 | findstr LISTENING >nul
if not errorlevel 1 (
  curl -s --max-time 3 -o nul -w "  WSDL HTTP Status: %%{http_code}\n" "http://localhost:3457/qbwc?wsdl" 2>nul
  if errorlevel 1 (
    echo   [X] WSDL khong tra ve - QuickBooks Web Connector se khong ket noi duoc
    set /a FAIL+=1
  ) else (
    echo   [OK] WSDL endpoint ready - QuickBooks Web Connector co the ket noi
    set /a PASS+=1
  )
) else (
  echo   [SKIP] Port 3457 khong listening - bo qua
)
echo.

REM ── Tổng kết ────────────────────────────────────────────────────────────
echo ════════════════════════════════════════════════════════════════
echo   TONG KET
echo ════════════════════════════════════════════════════════════════
echo   PASS: !PASS!
echo   FAIL: !FAIL!
echo ════════════════════════════════════════════════════════════════
echo.
if !FAIL! gtr 0 (
  echo Mot so check FAIL - xem log trong folder logs\
) else (
  echo TAT CA CHECK PASS! Laptop2 da san sang ket noi Mi-Core.
)
echo.
pause
endlocal