# ============================================================
# Antigravity Gateway - Port Block / Unblock for Dev Builds
#
# PURPOSE: Temporarily block port 3456 via Windows Firewall
#          so that builds inside Ld-project are not affected
#          by the gateway's background activity.
#
# USAGE:
#   .\gateway-port-block.ps1 -Block      # Block port 3456
#   .\gateway-port-block.ps1 -Unblock    # Unblock port 3456
#   .\gateway-port-block.ps1 -Status     # Check current status
#
# NOTE: This script does NOT kill the gateway process.
#       It only blocks inbound/outbound TCP on port 3456.
#       The gateway keeps running; it just can't receive traffic.
# ============================================================

param(
    [switch]$Block,
    [switch]$Unblock,
    [switch]$Status
)

$RuleNameIn = "Antigravity-Gateway-BLOCK-IN"
$RuleNameOut = "Antigravity-Gateway-BLOCK-OUT"
$Port = 3456

function Show-Status {
    $inRule = Get-NetFirewallRule -DisplayName $RuleNameIn -ErrorAction SilentlyContinue
    $outRule = Get-NetFirewallRule -DisplayName $RuleNameOut -ErrorAction SilentlyContinue

    if ($inRule -and $inRule.Enabled -eq "True" -and $outRule -and $outRule.Enabled -eq "True") {
        Write-Host ""
        Write-Host "  Status: BLOCKED" -ForegroundColor Red
        Write-Host "  Port $Port is blocked by Windows Firewall" -ForegroundColor Yellow
        Write-Host ""
        return $true
    }
    elseif ($inRule -or $outRule) {
        Write-Host ""
        Write-Host "  Status: PARTIALLY RULED" -ForegroundColor DarkYellow
        Write-Host "  Firewall rules exist but may be disabled" -ForegroundColor Yellow
        Write-Host ""
        return $false
    }
    else {
        Write-Host ""
        Write-Host "  Status: UNBLOCKED" -ForegroundColor Green
        Write-Host "  Port $Port is open (gateway is accessible)" -ForegroundColor Gray
        Write-Host ""
        return $false
    }
}

function Block-Port {
    Write-Host ""
    Write-Host "=== Blocking Antigravity Gateway (port $Port) ===" -ForegroundColor Cyan
    Write-Host ""

    Remove-NetFirewallRule -DisplayName $RuleNameIn -ErrorAction SilentlyContinue
    Remove-NetFirewallRule -DisplayName $RuleNameOut -ErrorAction SilentlyContinue

    New-NetFirewallRule -DisplayName $RuleNameIn `
        -Direction Inbound `
        -Action Block `
        -Protocol TCP `
        -LocalPort $Port `
        -Profile Any `
        -Description "Temporarily block Antigravity Gateway port $Port during dev builds. Remove with: gateway-port-block.ps1 -Unblock" `
    | Out-Null

    New-NetFirewallRule -DisplayName $RuleNameOut `
        -Direction Outbound `
        -Action Block `
        -Protocol TCP `
        -RemotePort $Port `
        -Profile Any `
        -Description "Temporarily block outbound to Antigravity Gateway port $Port during dev builds." `
    | Out-Null

    $watchdog = Get-ScheduledTask -TaskName "AntigravityGatewayWatchdog" -ErrorAction SilentlyContinue
    if ($watchdog) {
        Disable-ScheduledTask -TaskName "AntigravityGatewayWatchdog" -ErrorAction SilentlyContinue | Out-Null
        Write-Host "  Watchdog scheduled task DISABLED" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "  DONE: Port $Port is now BLOCKED" -ForegroundColor Green
    Write-Host "  Gateway process is still running but unreachable" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  To restore:  .\gateway-port-block.ps1 -Unblock" -ForegroundColor White
    Write-Host ""
}

function Unblock-Port {
    Write-Host ""
    Write-Host "=== Unblocking Antigravity Gateway (port $Port) ===" -ForegroundColor Cyan
    Write-Host ""

    Remove-NetFirewallRule -DisplayName $RuleNameIn -ErrorAction SilentlyContinue
    Remove-NetFirewallRule -DisplayName $RuleNameOut -ErrorAction SilentlyContinue

    $watchdog = Get-ScheduledTask -TaskName "AntigravityGatewayWatchdog" -ErrorAction SilentlyContinue
    if ($watchdog -and $watchdog.State -ne "Ready") {
        Enable-ScheduledTask -TaskName "AntigravityGatewayWatchdog" -ErrorAction SilentlyContinue | Out-Null
        Write-Host "  Watchdog scheduled task RE-ENABLED" -ForegroundColor Green
    }

    $pm2 = "$env:APPDATA\npm\pm2.cmd"
    if (!(Test-Path $pm2)) { $pm2 = "pm2" }

    Write-Host "  Restarting gateway via PM2..." -ForegroundColor Gray
    Set-Location "C:\Users\hoang\Downloads\antigravity-gateway\antigravity-gateway" -ErrorAction SilentlyContinue
    & $pm2 restart antigravity-gateway *> $null 2>&1

    Start-Sleep -Seconds 3
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:3456/health" -TimeoutSec 5 -ErrorAction Stop
        Write-Host "  Gateway health: $($health.status)" -ForegroundColor Green
    }
    catch {
        Write-Host "  Gateway still starting up..." -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "  DONE: Port $Port is now UNBLOCKED" -ForegroundColor Green
    Write-Host ""
}

# --- Main ---
Write-Host ""
Write-Host "Antigravity Gateway Port Blocker v1.0" -ForegroundColor DarkGray

if ($Status) {
    Show-Status
}
elseif ($Block) {
    Block-Port
}
elseif ($Unblock) {
    Unblock-Port
}
else {
    Write-Host ""
    Write-Host "  Usage:" -ForegroundColor White
    Write-Host "    .\gateway-port-block.ps1 -Block     " -ForegroundColor Gray -NoNewline
    Write-Host "# Block port $Port" -ForegroundColor DarkGray
    Write-Host "    .\gateway-port-block.ps1 -Unblock   " -ForegroundColor Gray -NoNewline
    Write-Host "# Unblock port $Port" -ForegroundColor DarkGray
    Write-Host "    .\gateway-port-block.ps1 -Status    " -ForegroundColor Gray -NoNewline
    Write-Host "# Check status" -ForegroundColor DarkGray
    Write-Host ""
    Show-Status
}
