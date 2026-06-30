@echo off
cd /d "%~dp0"
cd ..
echo === Running Food Safety Timezone Lockdown Tests ===
echo Current Vietnam time: 
node -e "console.log(new Date().toString())"
echo.
node tests/testFoodSafetyTimezoneLockdown.js
echo.
echo === Exit code: %errorlevel% ===