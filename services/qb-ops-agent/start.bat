@echo off
REM QB Ops Agent — Start (TypeScript build)
REM Run this on laptop1 to start the QBWC SOAP server + workflow engine

echo [QB Ops Agent] Starting...
cd /d "%~dp0"

REM Check if .env exists
if not exist .env (
    echo [ERROR] .env file not found. Copy .env.example to .env and configure.
    pause
    exit /b 1
)

REM Check node
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

REM Check if dist/ exists (compiled), build if not
if not exist "dist\index.js" (
    echo [QB Ops Agent] dist/ not found. Building TypeScript...
    call npm run build
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Build failed. Run "npm install" first if missing dependencies.
        pause
        exit /b 1
    )
)

REM Start the agent
node dist/index.js
pause
