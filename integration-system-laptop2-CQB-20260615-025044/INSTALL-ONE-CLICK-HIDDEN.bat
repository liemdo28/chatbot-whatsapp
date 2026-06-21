@echo off
setlocal
title ToastPOSManager QB Agent - One Click Hidden Install

set "LAPTOP_ID=qb-laptop-01"
set "STORE_NAME=Bandera"
set "MI_CORE_URL=http://100.118.102.113:4001"

if not "%~1"=="" set "LAPTOP_ID=%~1"
if not "%~2"=="" set "STORE_NAME=%~2"
if not "%~3"=="" set "MI_CORE_URL=%~3"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install-agent.ps1" ^
    -LaptopId "%LAPTOP_ID%" ^
    -StoreName "%STORE_NAME%" ^
    -MiCoreUrl "%MI_CORE_URL%" ^
    -NoPrompt

if errorlevel 1 (
    echo.
    echo [ERROR] Install failed. See log:
    echo C:\ProgramData\ToastPOSManager\logs\install.log
    echo.
    pause
    exit /b 1
)

echo.
echo Install complete. Background agent is running hidden.
echo.
pause
exit /b 0
