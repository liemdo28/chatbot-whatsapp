# ============================================================
# Antigravity Gateway — Protected Start Script
# - Starts PM2 daemon + gateway process
# - Registers PID marker for watchdog identification
# - Logs all actions
# ============================================================

$ErrorActionPreference = "Continue"
$GatewayDir = "C:\Users\hoang\Downloads\antigravity-gateway\antigravity-gateway"
$LogDir = "C:\ProgramData\AntigravityGateway\logs"
$MarkerFile = "C:\ProgramData\AntigravityGateway\gateway.pid"

# Ensure directories
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
if (!(Test-Path "C:\ProgramData\AntigravityGateway")) { New-Item -ItemType Directory -Path "C:\ProgramData\AntigravityGateway" -Force | Out-Null }

$LogFile = Join-Path $LogDir "gateway-start.log"
$Pm2 = "$env:APPDATA\npm\pm2.cmd"
if (!(Test-Path $Pm2)) { $Pm2 = "pm2" }

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [START] $msg"
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

Log "=== Gateway Start Initiated ==="
Log "Gateway dir: $GatewayDir"
Log "PM2 path: $Pm2"

# 1. Ensure PM2 daemon is running
$pm2Pid = (Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        try {
            $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
            $cmdLine -match "pm2" -and $cmdLine -match "daemon"
        }
        catch { $false }
    } | Select-Object -First 1).Id

if (-not $pm2Pid) {
    Log "PM2 daemon not running, starting..."
    & $Pm2 resurrect 2>&1 | Out-Null
    Start-Sleep -Seconds 2
}

# 2. Start or reload gateway
Set-Location $GatewayDir
Log "Running pm2 startOrReload..."
& $Pm2 startOrReload ecosystem.config.cjs --update-env *> $null
if ($LASTEXITCODE -ne 0) {
    Log "startOrReload failed (code $LASTEXITCODE), trying pm2 start..."
    & $Pm2 start ecosystem.config.cjs *> $null
}

# 3. Save PM2 process list
& $Pm2 save *> $null
Log "PM2 process list saved"

# 4. Write PID marker for watchdog
$gwProcess = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match "antigravity-gateway" -and $_.CommandLine -match "server\.js" -and $_.CommandLine -notmatch "pm2"
}
if ($gwProcess) {
    Set-Content -Path $MarkerFile -Value $gwProcess.ProcessId
    Log "PID marker written: $($gwProcess.ProcessId)"
}
else {
    Log "WARNING: Could not find gateway process PID"
}

# 5. Verify health
Start-Sleep -Seconds 3
try {
    $health = Invoke-RestMethod "http://127.0.0.1:3456/health" -TimeoutSec 5
    Log "Health check OK: $($health.status)"
}
catch {
    Log "WARNING: Health check failed: $($_.Exception.Message)"
}

Log "=== Gateway Start Complete ==="
