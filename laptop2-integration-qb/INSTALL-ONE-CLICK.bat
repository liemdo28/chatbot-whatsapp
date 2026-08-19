@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo.
echo ================================================================
echo   LAPTOP2 - INSTALL ONE-CLICK
echo   Integration-QB + Mi-Core stack
echo ================================================================
echo.

echo [0/7] Kiem tra Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo   [X] Khong tim thay Node.js. Cai Node.js 18+ roi chay lai.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set "NODE_VER=%%v"
echo   [OK] Node.js !NODE_VER!

echo [1/7] Tao thu muc data/logs + seed placeholder .env...
if not exist "%ROOT%qb-ops-agent\data" mkdir "%ROOT%qb-ops-agent\data"
if not exist "%ROOT%qb-ops-agent\logs" mkdir "%ROOT%qb-ops-agent\logs"
if not exist "%ROOT%mi-node-agent\logs" mkdir "%ROOT%mi-node-agent\logs"
if not exist "%ROOT%whatsapp-ai-gateway\data" mkdir "%ROOT%whatsapp-ai-gateway\data"
if not exist "%ROOT%whatsapp-ai-gateway\logs" mkdir "%ROOT%whatsapp-ai-gateway\logs"
if not exist "%ROOT%doordash-agent\data" mkdir "%ROOT%doordash-agent\data"
if not exist "%ROOT%doordash-agent\logs" mkdir "%ROOT%doordash-agent\logs"
if not exist "%ROOT%logs" mkdir "%ROOT%logs"
call :seed_env "qb-ops-agent" "env-laptop2.example.txt"
call :seed_env "mi-node-agent" "env-laptop2.example.txt"
call :seed_env "whatsapp-ai-gateway" "env-laptop2.example.txt"
call :seed_env "doordash-agent" "env-laptop2.example.txt"

echo [2/7] Validate required configuration...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%validate-laptop2-config.ps1" -Root "%ROOT%"
if errorlevel 1 (
  echo.
  echo   [X] Missing required production configuration.
  echo   [X] Edit the generated .env files locally, then rerun this installer.
  pause
  exit /b 1
)

echo [3/7] Cai dat qb-ops-agent dependencies...
cd /d "%ROOT%qb-ops-agent"
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo   [X] npm install qb-ops-agent that bai
  pause
  exit /b 1
)
call npm run build
if errorlevel 1 (
  echo   [X] npm build qb-ops-agent that bai
  pause
  exit /b 1
)
echo   [OK] qb-ops-agent built

echo [4/7] Cai dat mi-node-agent dependencies...
cd /d "%ROOT%mi-node-agent"
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo   [X] npm install mi-node-agent that bai
  pause
  exit /b 1
)
call npm run build
if errorlevel 1 (
  echo   [X] npm build mi-node-agent that bai
  pause
  exit /b 1
)
echo   [OK] mi-node-agent built

echo [5/7] Cai dat whatsapp-ai-gateway dependencies...
cd /d "%ROOT%whatsapp-ai-gateway"
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo   [X] npm install whatsapp-ai-gateway that bai
  pause
  exit /b 1
)
echo   [OK] whatsapp-ai-gateway dependencies installed

echo [6/7] Cai dat doordash-agent + Playwright chromium...
cd /d "%ROOT%doordash-agent"
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo   [X] npm install doordash-agent that bai
  pause
  exit /b 1
)
call npx playwright install chromium
if errorlevel 1 (
  echo   [!] Playwright chromium install failed - doordash-agent se loi khi scrape
)
echo   [OK] doordash-agent ready

echo [7/7] Verify artifacts...
cd /d "%ROOT%"
if not exist "%ROOT%qb-ops-agent\dist\index.js" (
  echo   [X] qb-ops-agent dist\index.js khong ton tai
  exit /b 1
)
if not exist "%ROOT%mi-node-agent\dist\server.js" (
  echo   [X] mi-node-agent dist\server.js khong ton tai
  exit /b 1
)

echo.
echo ================================================================
echo   CAI DAT HOAN TAT
echo ================================================================
echo.
echo   Tiep theo:
echo     1. Chay START-ALL.bat
echo     2. Chay VERIFY-INSTALL.bat
echo     3. Provision WhatsApp auth/session state outside Git
echo.
pause
exit /b 0

:seed_env
set "SERVICE=%~1"
set "TEMPLATE=%~2"
if not exist "%ROOT%%SERVICE%\.env" (
  copy /Y "%ROOT%%SERVICE%\%TEMPLATE%" "%ROOT%%SERVICE%\.env" >nul
  echo   [INFO] Tao %SERVICE%\.env tu %TEMPLATE%
) else (
  echo   [OK] %SERVICE%\.env da ton tai
)
exit /b 0
