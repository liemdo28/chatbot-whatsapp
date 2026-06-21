# Background health check - runs every 5 minutes via Scheduled Task
# Checks bot is alive, restarts if down

$logDir = "C:\ProgramData\BakudanFoodSafety\logs"
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir "bot-health.log"

function Log($msg) {
    $line = "$(Get-Date -Format o) $msg"
    Add-Content -Path $logFile -Value $line
    Write-Output $line
}

try {
    $status = Invoke-RestMethod "http://127.0.0.1:3211/api/whatsapp/session" -TimeoutSec 5
    Log "OK $($status.status)"
}
catch {
    Log "DOWN - restarting bot"
    Start-Process "wscript.exe" "C:\Ld-project\whatsapp-ai-gateway\start-bot-hidden.vbs"
    Log "Restart triggered"
}
