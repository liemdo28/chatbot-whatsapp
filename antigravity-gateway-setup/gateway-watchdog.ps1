# ============================================================
# Antigravity Gateway Watchdog — Guardian Service
# Runs via Scheduled Task every 2 minutes
# - Checks health endpoint
# - If dead, restarts via PM2
# - Logs all restart actions
# - EXCLUDES itself from any "mi-stack" kill operations
# ============================================================

$ErrorActionPreference = "Continue"
$LogDir = "C:\ProgramData\AntigravityGateway\logs"
$LogFile = Join-Path $LogDir "watchdog.log"
$Pm2 = "$env:APPDATA\npm\pm2.cmd"
$HealthUrl = "http://127.0.0.1:3456/health"

if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
if (!(Test-Path $Pm2)) { $Pm2 = "pm2" }

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [WATCHDOG] $msg"
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

# Rotate log if > 5MB
if (Test-Path $LogFile) {
    $size = (Get-Item $LogFile).Length
    if ($size -gt 5MB) {
        $backup = $LogFile -replace '\.log$', "-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
        Move-Item $LogFile $backup -Force -ErrorAction SilentlyContinue
        Log "Log rotated (was $([math]::Round($size/1MB,1))MB)"
    }
}

# Check if PM2 has the process
$pm2List = & $Pm2 jlist 2>&1
if ($LASTEXITCODE -ne 0) {
    Log "PM2 not responding, resurrecting..."
    & $Pm2 resurrect *> $null
    Start-Sleep -Seconds 3
    $pm2List = & $Pm2 jlist 2>&1
}

# Check health
$healthy = $false
try {
    $response = Invoke-RestMethod $HealthUrl -TimeoutSec 5 -ErrorAction Stop
    if ($response.status -eq "ok") {
        $healthy = $true
    }
}
catch {
    # Health check failed
}

if ($healthy) {
    # Gateway is alive - all good, silent exit
    exit 0
}

# Gateway is down - attempt restart
Log "HEALTH CHECK FAILED — restarting gateway"

try {
    Set-Location "C:\Users\hoang\Downloads\antigravity-gateway\antigravity-gateway"
    & $Pm2 restart antigravity-gateway *> $null
    if ($LASTEXITCODE -ne 0) {
        Log "pm2 restart failed, trying pm2 start..."
        & $Pm2 start ecosystem.config.cjs *> $null
    }
    & $Pm2 save *> $null
    Log "Restart triggered via PM2"
}
catch {
    Log "ERROR during restart: $($_.Exception.Message)"
}

# Verify recovery after 5 seconds
Start-Sleep -Seconds 5
try {
    $recovery = Invoke-RestMethod $HealthUrl -TimeoutSec 5 -ErrorAction Stop
    Log "Recovery verified: status=$($recovery.status), uptime=$([math]::Round($recovery.uptime))s"
}
catch {
    Log "WARNING: Health still down after restart attempt"
}
