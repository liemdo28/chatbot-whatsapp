@echo off
REM QB Ops Agent — Start
REM Run this on laptop1 to start the QBWC webhook listener

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

REM Start the agent
node src/index.js
pause
