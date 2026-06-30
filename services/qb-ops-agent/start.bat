@echo off
REM QB Ops Agent — Start (TypeScript build)
REM Silent mode: no echo, no pause, no window flash
REM Output goes to logs/stdout.log and logs/stderr.log

cd /d "%~dp0"

REM Ensure logs dir exists
if not exist "logs" mkdir logs

REM Check if .env exists
if not exist .env (
    echo [%date% %time%] [ERROR] .env file not found >> logs\start-error.log
    exit /b 1
)

REM Check node
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [%date% %time%] [ERROR] Node.js not found >> logs\start-error.log
    exit /b 1
)

REM Check if dist/ exists (compiled), build if not
if not exist "dist\index.js" (
    call npm run build > logs\build.log 2>&1
    if %ERRORLEVEL% neq 0 (
        echo [%date% %time%] [ERROR] Build failed — see logs\build.log >> logs\start-error.log
        exit /b 1
    )
)

REM Start the agent silently — output to log files
node dist\index.js >> logs\agent.stdout.log 2>> logs\agent.stderr.log