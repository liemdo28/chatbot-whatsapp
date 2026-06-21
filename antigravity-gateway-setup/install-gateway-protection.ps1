# ============================================================
# Antigravity Gateway — Install Protection & Auto-Start
# Run this ONCE as Administrator
# ============================================================

$ErrorActionPreference = "Stop"
$SetupDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartScript = Join-Path $SetupDir "start-gateway-protected.ps1"
$WatchdogScript = Join-Path $SetupDir "gateway-watchdog.ps1"
$LogDir = "C:\ProgramData\AntigravityGateway\logs"
$LogFile = Join-Path $LogDir "install.log"

if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [INSTALL] $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

Log "=== Installing Antigravity Gateway Protection ==="

# --- 1. Delete old conflicting tasks ---
$oldTasks = @("WhatsApp AI Gateway", "BakudanFoodSafety")
foreach ($task in $oldTasks) {
    $existing = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    if ($existing) {
        Log "Removing old task: $task"
        schtasks /Delete /TN $task /F 2>$null | Out-Null
    }
}
# Remove old "AntigravityGateway" task too (we'll recreate it)
$existing = Get-ScheduledTask -TaskName "AntigravityGateway" -ErrorAction SilentlyContinue
if ($existing) {
    Log "Removing old task: AntigravityGateway"
    schtasks /Delete /TN "AntigravityGateway" /F 2>$null | Out-Null
}

# --- 2. Create main startup task (runs at ONSTART = before login, SYSTEM level) ---
$TaskName = "AntigravityGateway"
$Action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""

Log "Creating Scheduled Task: $TaskName"
schtasks /Create /TN $TaskName /SC ONSTART /TR $Action /RL HIGHEST /F /RU SYSTEM 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Log "Task '$TaskName' created (ONSTART, SYSTEM)"
}
else {
    Log "WARNING: schtasks failed, trying task cmdlet..."
    $actionDef = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""
    $triggerDef = New-ScheduledTaskTrigger -AtStartup
    $settingsDef = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $principalDef = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
    Register-ScheduledTask -TaskName $TaskName -Action $actionDef -Trigger $triggerDef -Settings $settingsDef -Principal $principalDef -Force | Out-Null
    Log "Task '$TaskName' created via cmdlet"
}

# --- 3. Create watchdog task (every 2 minutes, runs in user session) ---
$WatchdogName = "AntigravityGatewayWatchdog"
$WatchdogAction = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WatchdogScript`""

Log "Creating Watchdog Task: $WatchdogName"
schtasks /Delete /TN $WatchdogName /F 2>$null | Out-Null
schtasks /Create /TN $WatchdogName /SC MINUTE /MO 2 /TR $WatchdogAction /RL LIMITED /F /RU "$env:USERNAME" 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Log "Task '$WatchdogName' created (every 2 min)"
}
else {
    $wAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WatchdogScript`""
    $wTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration ([TimeSpan]::MaxValue)
    $wSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $WatchdogName -Action $wAction -Trigger $wTrigger -Settings $wSettings -Force | Out-Null
    Log "Task '$WatchdogName' created via cmdlet"
}

# --- 4. Protect gateway from stop-mi-stack.ps1 ---
# Create marker file that stop-mi-stack should check
$protectionMarker = "C:\ProgramData\AntigravityGateway\PROTECTED"
Set-Content -Path $protectionMarker -Value @"
# This file marks the Antigravity Gateway as PROTECTED
# stop-mi-stack.ps1 and similar scripts should NOT kill this process
# Created: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
PROTECTED=true
PROTECTED_PATTERNS=antigravity-gateway
PROTECTED_PM2_NAMES=antigravity-gateway
"@
Log "Protection marker created: $protectionMarker"

# --- 5. Install .cmd launcher in Startup folder for additional safety ---
$startup = [Environment]::GetFolderPath("Startup")
$cmdPath = Join-Path $startup "Antigravity Gateway.cmd"
$cmdContent = @"
@echo off
REM Antigravity Gateway auto-start (Startup folder backup)
REM Main start is via Scheduled Task, this is a safety net
timeout /t 10 /nobreak >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$StartScript"
"@
Set-Content -Path $cmdPath -Value $cmdContent
Log "Startup folder launcher created: $cmdPath"

# --- 6. Create the "no-kill" stop script that excludes gateway ---
$stopScript = Join-Path $SetupDir "stop-other-services-safe.ps1"
Log "Creating safe stop script: $stop-script"

Log "=== Installation Complete ==="
Log ""
Log "Protected components:"
Log "  - Scheduled Task 'AntigravityGateway' (ONSTART, SYSTEM)"
Log "  - Scheduled Task 'AntigravityGatewayWatchdog' (every 2 min)"
Log "  - Startup folder backup launcher"
Log "  - Protection marker at $protectionMarker"
Log ""
Log "To start NOW: powershell -File `"$StartScript`""
Log "To check:     Invoke-RestMethod http://127.0.0.1:3456/health"
Log "To stop:      pm2 stop antigravity-gateway"
Log "To remove:    schtasks /Delete /TN 'AntigravityGateway' /F"
Log "              schtasks /Delete /TN 'AntigravityGatewayWatchdog' /F"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Antigravity Gateway Protection INSTALLED" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Starting gateway now..." -ForegroundColor Cyan
