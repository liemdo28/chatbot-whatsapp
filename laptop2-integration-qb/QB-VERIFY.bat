@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist "%ROOT%qb-ops-agent\.env" (
  echo [X] qb-ops-agent\.env khong ton tai. Chay INSTALL-ONE-CLICK.bat truoc.
  pause
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%a in ("%ROOT%qb-ops-agent\.env") do (
  set "%%a=%%b"
)

if "%MI_CORE_API_KEY%"=="" (
  echo [X] MI_CORE_API_KEY chua duoc cau hinh trong qb-ops-agent\.env
  pause
  exit /b 1
)

if "%MI_CORE_URL%"=="" (
  echo [X] MI_CORE_URL chua duoc cau hinh trong qb-ops-agent\.env
  pause
  exit /b 1
)

echo.
echo ================================================================
echo   LAPTOP2 - QB MIRROR VERIFY
echo ================================================================
echo.

echo [1/2] Lay QB Mirror Sync Log...
curl -s -H "Authorization: Bearer %MI_CORE_API_KEY%" "%MI_CORE_URL%/api/qb/mirror/sync-log"
echo.
echo.

echo [2/2] Lay QB Mirror Summary...
curl -s -H "Authorization: Bearer %MI_CORE_API_KEY%" "%MI_CORE_URL%/api/qb/mirror/summary"
echo.
echo.

echo ================================================================
echo   Hoan tat.
echo ================================================================
pause
endlocal
