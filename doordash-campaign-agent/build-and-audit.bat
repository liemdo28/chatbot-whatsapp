@echo off
cd /d "%~dp0"
echo [BUILD] Compiling TypeScript...
call npx tsc --noEmit 2>&1
if errorlevel 1 (
    echo [BUILD] TypeScript errors found. Attempting build anyway...
    call npx tsc
) else (
    echo [BUILD] TypeScript OK.
)
echo [BUILD] Build complete.
echo.
echo [AUDIT] Running DoorDash Campaign Audit...
node --loader ts-node/esm src/audit/run-campaign-audit.ts 2>&1
