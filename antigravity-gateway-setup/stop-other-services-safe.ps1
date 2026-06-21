# ============================================================
# Safe Stop Script — Stops all services EXCEPT Antigravity Gateway
# Use this instead of stop-mi-stack.ps1
# ============================================================

$ErrorActionPreference = "Continue"

# Protected patterns — NEVER kill these
$protectedPatterns = @(
    "antigravity-gateway"
)

# Protected PM2 process names — NEVER kill these
$protectedPm2Names = @(
    "antigravity-gateway"
)

# Patterns to kill (other services)
$killPatterns = @(
    "setup-all\mi-node-agent",
    "setup-all\whatsapp-ai-gateway",
    "Agent\doordash-compaigns",
    "Bakudan\review-automation-system",
    "Bakudan\integration-system"
)

# Protected ports — NEVER force-kill these
$protectedPorts = @(3456)

# Ports to check for other services
$killPorts = @(4100, 4400, 4300)

Write-Host "=== Safe Service Stop ===" -ForegroundColor Cyan
Write-Host "Protecting: Antigravity Gateway (port 3456)" -ForegroundColor Green
Write-Host ""

$currentPid = $PID
$procs = Get-CimInstance Win32_Process | Where-Object {
    $cmdline = $_.CommandLine
    $name = $_.Name

    # Never kill our own process
    if ($_.ProcessId -eq $currentPid) { return $false }

    # Check if it matches any kill pattern
    $matchesKill = ($killPatterns | Where-Object { $cmdline -like "*$_*" })
    if (-not $matchesKill) { return $false }

    # Check if it matches any protected pattern
    $isProtected = ($protectedPatterns | Where-Object { $cmdline -like "*$_*" })
    if ($isProtected) {
        Write-Host "  PROTECTED: PID $($_.ProcessId) - $name (gateway)" -ForegroundColor Green
        return $false
    }

    # Only target relevant process types
    return ($name -match "node|npm|cmd|powershell|python|pythonw")
}

foreach ($proc in $procs) {
    Write-Host "  Stopping: PID $($proc.ProcessId) - $($proc.Name) (cmd: $($proc.CommandLine.Substring(0, [Math]::Min(80, $proc.CommandLine.Length))))" -ForegroundColor Yellow
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

# Check kill ports but skip protected ports
$listenConns = Get-NetTCPConnection -LocalPort ($killPorts + $protectedPorts) -State Listen -ErrorAction SilentlyContinue
foreach ($conn in $listenConns) {
    if ($conn.LocalPort -in $protectedPorts) {
        Write-Host "  PROTECTED PORT $($conn.LocalPort): PID $($conn.OwningProcess) — SKIPPED" -ForegroundColor Green
    }
    else {
        Write-Host "  PORT $($conn.LocalPort): PID $($conn.OwningProcess) — killing" -ForegroundColor Yellow
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

# Verify gateway is still alive
Start-Sleep -Seconds 2
try {
    $health = Invoke-RestMethod "http://127.0.0.1:3456/health" -TimeoutSec 3
    Write-Host ""
    Write-Host "✓ Antigravity Gateway confirmed alive (status: $($health.status))" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "⚠ Gateway health check failed — restarting..." -ForegroundColor Red
    $pm2 = "$env:APPDATA\npm\pm2.cmd"
    & $pm2 restart antigravity-gateway *> $null
    & $pm2 save *> $null
    Start-Sleep -Seconds 3
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:3456/health" -TimeoutSec 3
        Write-Host "✓ Gateway recovered (status: $($health.status))" -ForegroundColor Green
    }
    catch {
        Write-Host "✗ Gateway still down after restart" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
