@echo off
REM ════════════════════════════════════════════════════════════════════════════
REM  LAPTOP2 — START-ALL
REM  Khởi động toàn bộ Integration-QB stack (4 services)
REM ════════════════════════════════════════════════════════════════════════════
setlocal enabledelayedexpansion
chcp 65001 >nul

set ROOT=%~dp0
cd /d "%ROOT%"

echo.
echo ════════════════════════════════════════════════════════════════
echo   LAPTOP2 — START ALL SERVICES
echo ════════════════════════════════════════════════════════════════
echo.

REM ── 1. mi-node-agent (port 4100) — start trước để Mi biết node online ──
echo [1/4] Starting mi-node-agent (port 4100)...
if not exist "%ROOT%mi-node-agent\dist\server.js" (
  echo   [X] dist\server.js khong ton tai - chay INSTALL-ONE-CLICK.bat truoc
  goto :NEXT1
)
cd /d "%ROOT%mi-node-agent"
start "mi-node-agent" /min cmd /c "node dist\server.js >> ..\logs\mi-node-agent.out.log 2>&1"
echo   [OK] mi-node-agent started
:NEXT1

REM ── 2. qb-ops-agent (port 3457 SOAP + heartbeat Mi-Core) ────────────────
echo [2/4] Starting qb-ops-agent (port 3457)...
if not exist "%ROOT%qb-ops-agent\dist\index.js" (
  echo   [X] dist\index.js khong ton tai - chay INSTALL-ONE-CLICK.bat truoc
  goto :NEXT2
)
cd /d "%ROOT%qb-ops-agent"
start "qb-ops-agent" /min cmd /c "node dist\index.js >> ..\logs\qb-ops-agent.out.log 2>&1"
echo   [OK] qb-ops-agent started
:NEXT2

REM ── 3. whatsapp-ai-gateway (port 3212) ────────────────────────────────
echo [3/4] Starting whatsapp-ai-gateway (port 3212)...
cd /d "%ROOT%whatsapp-ai-gateway"
if not exist "%ROOT%whatsapp-ai-gateway\src\index.js" (
  echo   [X] src\index.js khong ton tai - chay INSTALL-ONE-CLICK.bat truoc
  goto :NEXT3
)
start "whatsapp-ai-gateway" /min cmd /c "node src\index.js >> ..\logs\whatsapp-ai-gateway.out.log 2>&1"
echo   [OK] whatsapp-ai-gateway started
:NEXT3

REM ── 4. doordash-agent (port 3461) ──────────────────────────────────────
echo [4/4] Starting doordash-agent (port 3461)...
cd /d "%ROOT%doordash-agent"
if not exist "%ROOT%doordash-agent\src\index.js" (
  echo   [X] src\index.js khong ton tai - chay INSTALL-ONE-CLICK.bat truoc
  goto :DONE
)
start "doordash-agent" /min cmd /c "node src\index.js >> ..\logs\doordash-agent.out.log 2>&1"
echo   [OK] doordash-agent started

:DONE
echo.
echo ════════════════════════════════════════════════════════════════
echo   All services started. Cho 10s de cac service khoi dong...
echo ════════════════════════════════════════════════════════════════
echo.
echo   Log files:
echo     logs\mi-node-agent.out.log
echo     logs\qb-ops-agent.out.log
echo     logs\whatsapp-ai-gateway.out.log
echo     logs\doordash-agent.out.log
echo.
echo   Kiem tra trang thai: VERIFY-INSTALL.bat
echo   Dung tat ca service: STOP-ALL.bat
echo.
timeout /t 10 /nobreak >nul
endlocal