@echo off
REM ════════════════════════════════════════════════════════════════════════════
REM  LAPTOP2 — QB-VERIFY
REM  Kiem tra QB Mirror sync log va summary tu Mi-Core
REM  Chay sau khi qb-ops-agent da heartbeat thanh cong
REM ════════════════════════════════════════════════════════════════════════════
setlocal
chcp 65001 >nul

echo.
echo ════════════════════════════════════════════════════════════════
echo   LAPTOP2 — QB MIRROR VERIFY
echo ════════════════════════════════════════════════════════════════
echo.

REM ── Nhap Mi-Core IP ──────────────────────────────────────────────────────
set /p PC_IP="Nhap Mi-Core PC IP (default: 100.118.102.113): "
if "%PC_IP%"=="" set PC_IP=100.118.102.113

REM ── Nhap Bearer Token ────────────────────────────────────────────────────
set /p TOKEN="Nhap Bearer Token (hoac Enter de dung key cua laptop1): "
if "%TOKEN%"=="" set TOKEN=b149c4783a1109ff46d01498d91766e7

set MI_CORE_URL=http://%PC_IP%:4001

echo.
echo Dang kiem tra...
echo.

REM ── Check 1: QB Mirror Sync Log ─────────────────────────────────────────
echo [1/2] Lay QB Mirror Sync Log...
echo curl -H "Authorization: Bearer %TOKEN%" "%MI_CORE_URL%/api/qb/mirror/sync-log"
echo.
curl -s -H "Authorization: Bearer %TOKEN%" "%MI_CORE_URL%/api/qb/mirror/sync-log"
echo.
echo.

REM ── Check 2: QB Mirror Summary ─────────────────────────────────────────
echo [2/2] Lay QB Mirror Summary...
echo curl -H "Authorization: Bearer %TOKEN%" "%MI_CORE_URL%/api/qb/mirror/summary"
echo.
curl -s -H "Authorization: Bearer %TOKEN%" "%MI_CORE_URL%/api/qb/mirror/summary"
echo.
echo.

echo ════════════════════════════════════════════════════════════════
echo   Hoan tat. Kiem tra ket qua o tren.
echo   Neu 401 Unauthorized -> thay TOKEN bang key dung tren Mi-Core
echo ════════════════════════════════════════════════════════════════
pause
endlocal