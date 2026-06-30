@echo off
title Review Auto-Bridge
cd /d "%~dp0"
echo Installing dependencies...
call npm install --silent
echo.
echo Starting Review Auto-Bridge...
echo Dashboard:    http://localhost:8787
echo CEO Approval: http://localhost:8787/approval
echo.
node main.js