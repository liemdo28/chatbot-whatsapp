@echo off
REM ════════════════════════════════════════════════════════════════════════════
REM  LAPTOP2 — STOP-ALL
REM  Dừng tất cả service đang chạy
REM ════════════════════════════════════════════════════════════════════════════
setlocal
chcp 65001 >nul

echo.
echo ════════════════════════════════════════════════════════════════
echo   LAPTOP2 — STOP ALL SERVICES
echo ════════════════════════════════════════════════════════════════
echo.

echo [1/4] Stopping mi-node-agent (port 4100)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4100 ^| findstr LISTENING') do (
  echo   Killing PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

echo [2/4] Stopping qb-ops-agent (port 3457)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3457 ^| findstr LISTENING') do (
  echo   Killing PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

echo [3/4] Stopping whatsapp-ai-gateway (port 3212)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3212 ^| findstr LISTENING') do (
  echo   Killing PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

echo [4/4] Stopping doordash-agent (port 3461)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3461 ^| findstr LISTENING') do (
  echo   Killing PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

REM Cleanup bang title cua so
taskkill /F /FI "WINDOWTITLE eq mi-node-agent*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq qb-ops-agent*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq whatsapp-ai-gateway*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq doordash-agent*" >nul 2>&1

echo.
echo ════════════════════════════════════════════════════════════════
echo   Tat ca service da dung.
echo ═════════════════════���══════════════════════════════════════════
timeout /t 3 >nul
endlocal