@echo off
REM QB Ops Agent — Install & Setup
REM Run this once on laptop1 to install dependencies and configure

echo =============================================
echo  QB Ops Agent - Installation Script
echo =============================================
echo.

cd /d "%~dp0"

REM Step 1: Check Node.js
echo [1/6] Checking Node.js...
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
echo [2/6] Detecting laptop1 LAN IP...
for /f "delims=" %%i in ('powershell -Command "Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike '127.*' -and $_.InterfaceAlias -notlike '*Loopback*' -and $_.PrefixOrigin -ne 'WellKnown' } ^| Select-Object -First 1 -ExpandProperty IPAddress"') do set LAPTOP1_IP=%%i
if "%LAPTOP1_IP%"=="" (
    echo [WARN] Could not auto-detect LAN IP. Using 192.168.1.100
    set LAPTOP1_IP=192.168.1.100
)
echo [OK] LAPTOP1_IP=%LAPTOP1_IP%
echo.

REM Step 3: Install dependencies
echo [3/6] Installing npm dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm install failed!
    pause
    exit /b 1
)
echo [OK] Dependencies installed.
echo.

REM Step 4: Configure .env
echo [4/6] Configuring environment...
if not exist .env (
    echo Creating .env from .env.example...
    copy .env.example .env

    REM Generate a random 32-char API key
    for /f "tokens=*" %%i in ('node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"') do set QB_KEY=%%i

    REM Update .env with detected IP and generated key
    powershell -Command "(Get-Content '.env') -replace 'REPLACE_WITH_32_CHAR_KEY', '%QB_KEY%' -replace '192.168.1.100', '%LAPTOP1_IP%' | Set-Content '.env'"

    echo.
    echo =============================================
    echo  IMPORTANT - COPY THESE VALUES
    echo =============================================
    echo   LAPTOP1_IP: %LAPTOP1_IP%
    echo   QB_API_KEY: %QB_KEY%
    echo =============================================
    echo.
    echo [?] Open .env in Notepad to verify? (Y/N)
    set /p OPENENV=
    if /i "%OPENENV%"=="Y" notepad .env
) else (
    echo [OK] .env already exists. Showing current values:
    findstr /C:"LAPTOP1_IP" /C:"QB_API_KEY" .env
)
echo.

REM Step 5: Generate .qwc file with correct IP
echo [5/6] Generating .qwc file...
node src/generateQwc.js
echo [OK] .qwc file updated with LAPTOP1_IP=%LAPTOP1_IP%
echo.

REM Step 6: Test connection
echo [6/6] Running smoke test...
node src/testConnection.js
echo.

echo =============================================
echo  Installation complete!
echo =============================================
echo.
echo Next steps:
echo   1. Open QuickBooks Desktop on laptop1
echo   2. Open QB Web Connector, click "Add an Application"
echo   3. Select mi-core-connector.qwc
echo   4. Enter password = QB_API_KEY from above
echo   5. Check "Auto-Run" and set schedule to 6 hours
echo   6. Run: start.bat to start the agent
echo.
pause
