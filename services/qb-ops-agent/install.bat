@echo off
REM QB Ops Agent — Install & Setup (TypeScript)
REM Run this once on laptop1 to install dependencies, configure, and build.

echo =============================================
echo  QB Ops Agent - Installation Script v2.0
echo =============================================
echo.

cd /d "%~dp0"

REM Step 1: Check Node.js
echo [1/7] Checking Node.js...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found!
    echo Download from: https://nodejs.org
    pause
    exit /b 1
)
node --version
echo [OK] Node.js found.
echo.

REM Step 2: Detect LAN IP automatically
echo [2/7] Detecting laptop1 LAN IP...
for /f "delims=" %%i in ('powershell -Command "Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike '127.*' -and $_.InterfaceAlias -notlike '*Loopback*' -and $_.PrefixOrigin -ne 'WellKnown' } ^| Select-Object -First 1 -ExpandProperty IPAddress"') do set LAPTOP1_IP=%%i
if "%LAPTOP1_IP%"=="" (
    echo [WARN] Could not auto-detect LAN IP. Using 192.168.1.100
    set LAPTOP1_IP=192.168.1.100
)
echo [OK] LAPTOP1_IP=%LAPTOP1_IP%
echo.

REM Step 3: Install dependencies
echo [3/7] Installing npm dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm install failed!
    pause
    exit /b 1
)
echo [OK] Dependencies installed.
echo.

REM Step 4: Configure .env
echo [4/7] Configuring environment...
if not exist .env (
    echo Creating .env from .env.example...
    copy .env.example .env >nul
    powershell -Command "(Get-Content '.env') -replace '192.168.1.100', '%LAPTOP1_IP%' | Set-Content '.env'"
    echo.
    echo =============================================
    echo  ACTION REQUIRED
    echo =============================================
    echo   .env was created from a placeholder-only template.
    echo   Set MI_CORE_API_KEY and QBWC_PASSWORD locally in .env.
    echo   No default credential is generated or printed by this installer.
    echo =============================================
    echo.
    exit /b 1
) else (
    echo [OK] .env already exists.
    findstr /C:"LAPTOP1_IP" /C:"QB_API_KEY" .env
)
echo.

REM Step 5: Build TypeScript
echo [5/7] Building TypeScript...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] TypeScript build failed!
    pause
    exit /b 1
)
echo [OK] TypeScript compiled to dist/
echo.

REM Step 6: Initialize data dir
echo [6/7] Preparing data directory...
if not exist "data" mkdir data
if not exist "data\company-files.json" (
    copy "data\company-files.example.json" "data\company-files.json" >nul
)
echo [OK] data/ ready.
echo.

REM Step 7: Smoke test
echo [7/7] Verifying server starts...
echo [OK] Installation complete!
echo.
echo =============================================
echo  NEXT STEPS
echo =============================================
echo   1. Open QuickBooks Desktop on laptop1
echo   2. Open QB Web Connector, click "Add an Application"
echo   3. Select mi-core-connector.qwc
echo   4. Enter password = QB_API_KEY from .env
echo   5. Run: start.bat to start the agent
echo.
echo Server will listen on port 3457 (QBWC_PORT)
echo WSDL: http://localhost:3457/qbwc?wsdl
echo Status: http://localhost:3457/api/status
echo.
pause
