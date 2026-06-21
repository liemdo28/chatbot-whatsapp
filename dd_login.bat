@echo off
rem === DoorDash Auto Login Trigger ===
rem Triggers login API for all 4 stores sequentially
rem Screenshots captured automatically by the login endpoint

cd /d "c:\Ld-project\doordash-campaign-agent"
npx tsx src/recovery/session-recovery.ts
echo DONE
pause