@echo off
title ToastPOSManager - Install Laptop 2 (Stone Oak)
color 0A

echo.
echo  ================================================
echo   ToastPOSManager QB Agent
echo   Laptop 2 - Stone Oak
echo  ================================================
echo.
echo  Running installer... Please wait.
echo.

:: Run PowerShell install script with Laptop 2 settings
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install-agent.ps1" ^
    -LaptopId "qb-laptop-02" ^
    -StoreName "Stone Oak"

if errorlevel 1 (
    echo.
    echo  [ERROR] Install failed. See log at:
    echo  C:\ProgramData\ToastPOSManager\logs\install.log
    echo.
    pause
    exit /b 1
)
