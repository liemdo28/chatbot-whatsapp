@echo off
REM ════════════════════════════════════════════════════════════════════════════
REM  LAPTOP2 — INSTALL-ONE-CLICK
REM  Cài đặt toàn bộ Integration-QB stack giống laptop1
REM  - qb-ops-agent (port 3457 SOAP, kết nối MI giống laptop1)
REM  - mi-node-agent (port 4100, NODE_ID=laptop2)
REM  - whatsapp-ai-gateway (port 3212, food safety)
REM  - doordash-agent (port 3461)
REM ════════════════════════════════════════════════════════════════════════════
setlocal enabledelayedexpansion
chcp 65001 >nul

set ROOT=%~dp0
cd /d "%ROOT%"

echo.
echo ════════════════════════════════════════════════════════════════
echo   LAPTOP2 — INSTALL ONE-CLICK
echo   Integration-QB + Mi-Core stack
echo ════════════════════════════════════════════════════════════════
echo.

REM ── Bước 0: Kiểm tra Node.js ─────────────────────────────────────────────
echo [0/6] Kiem tra Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo   [X] KHONG TIM THAY Node.js - vui long cai Node.js 18+ tu https://nodejs.org
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo   [OK] Node.js !NODE_VER!

REM ── Bước 1: Tạo thư mục data/logs ────────────────────────────────────────
echo [1/6] Tao thu muc data/logs + copy env...
if not exist "%ROOT%qb-ops-agent\data" mkdir "%ROOT%qb-ops-agent\data"
if not exist "%ROOT%qb-ops-agent\logs" mkdir "%ROOT%qb-ops-agent\logs"
if not exist "%ROOT%mi-node-agent\logs" mkdir "%ROOT%mi-node-agent\logs"
if not exist "%ROOT%whatsapp-ai-gateway\data" mkdir "%ROOT%whatsapp-ai-gateway\data"
if not exist "%ROOT%whatsapp-ai-gateway\logs" mkdir "%ROOT%whatsapp-ai-gateway\logs"
if not exist "%ROOT%doordash-agent\data" mkdir "%ROOT%doordash-agent\data"
if not exist "%ROOT%doordash-agent\logs" mkdir "%ROOT%doordash-agent\logs"
if not exist "%ROOT%logs" mkdir "%ROOT%logs"

REM Copy env-laptop2.txt thanh .env cho moi service (neu chua ton tai)
if not exist "%ROOT%qb-ops-agent\.env" copy /Y "%ROOT%qb-ops-agent\env-laptop2.txt" "%ROOT%qb-ops-agent\.env" >nul
if not exist "%ROOT%mi-node-agent\.env" copy /Y "%ROOT%mi-node-agent\env-laptop2.txt" "%ROOT%mi-node-agent\.env" >nul
if not exist "%ROOT%whatsapp-ai-gateway\.env" copy /Y "%ROOT%whatsapp-ai-gateway\env-laptop2.txt" "%ROOT%whatsapp-ai-gateway\.env" >nul
if not exist "%ROOT%doordash-agent\.env" copy /Y "%ROOT%doordash-agent\env-laptop2.txt" "%ROOT%doordash-agent\.env" >nul
echo   [OK] data/logs directories ready + .env copied

REM ── Bước 2: Cài dependency cho qb-ops-agent ─────────────────────────────
echo [2/6] Cai dat qb-ops-agent dependencies...
cd /d "%ROOT%qb-ops-agent"
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo   [X] npm install qb-ops-agent THAT BAI
  pause
  exit /b 1
)
call npm run build
if errorlevel 1 (
  echo   [X] npm build qb-ops-agent THAT BAI
  pause
  exit /b 1
)
echo   [OK] qb-ops-agent built

REM ── Bước 3: Cài dependency cho mi-node-agent ────────────────────────────
echo [3/6] Cai dat mi-node-agent dependencies...
cd /d "%ROOT%mi-node-agent"
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo   [X] npm install mi-node-agent THAT BAI
  pause
  exit /b 1
)
call npm run build
if errorlevel 1 (
  echo   [X] npm build mi-node-agent THAT BAI
  pause
  exit /b 1
)
echo   [OK] mi-node-agent built

REM ── Bước 4: Cài dependency cho whatsapp-ai-gateway ──────────────────────
echo [4/6] Cai dat whatsapp-ai-gateway dependencies...
cd /d "%ROOT%whatsapp-ai-gateway"
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo   [X] npm install whatsapp-ai-gateway THAT BAI
  pause
  exit /b 1
)
echo   [OK] whatsapp-ai-gateway dependencies installed

REM ── Bước 5: Cài dependency cho doordash-agent + Playwright browser ──────
echo [5/6] Cai dat doordash-agent + Playwright chromium...
cd /d "%ROOT%doordash-agent"
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo   [X] npm install doordash-agent THAT BAI
  pause
  exit /b 1
)
call npx playwright install chromium
if errorlevel 1 (
  echo   [!] Playwright chromium install failed - doordash-agent se loi khi scrape
)
echo   [OK] doordash-agent ready

REM ── Bước 6: Verify sau cài đặt ───────────────────────────────────────────
echo [6/6] Kiem tra cac service co the start...
cd /d "%ROOT%"
if not exist "%ROOT%qb-ops-agent\dist\index.js" (
  echo   [X] qb-ops-agent dist\index.js khong ton tai
)
if not exist "%ROOT%mi-node-agent\dist\server.js" (
  echo   [X] mi-node-agent dist\server.js khong ton tai
)

echo.
echo ════════════════════════════════════════════════════════════════
echo   CAI DAT HOAN TAT!
echo ════════════════════════════════════════════════════════════════
echo.
echo   Cac service da san sang:
echo     - qb-ops-agent       (port 3457 SOAP + connect Mi-Core)
echo     - mi-node-agent      (port 4100, NODE_ID=laptop2)
echo     - whatsapp-ai-gateway(port 3212)
echo     - doordash-agent     (port 3461)
echo.
echo   Tiep theo:
echo     1. Kiem tra .env cac service (MI_CORE_URL, NODE_SECRET, ...)
echo     2. Chay START-ALL.bat de khoi dong toan bo stack
echo     3. Chay VERIFY-INSTALL.bat de test ket noi Mi-Core
echo.
pause
endlocal