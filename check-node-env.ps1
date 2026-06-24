$envVars = @(
    "USE_VISION_LLM_PIPELINE",
    "VISION_LLM_HOST",
    "VISION_LLM_PORT",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY"
)
Write-Host "=== Node Environment Variables ==="
foreach ($v in $envVars) {
    $val = [System.Environment]::GetEnvironmentVariable($v, "Process")
    if ($v -eq "GEMINI_API_KEY" -or $v -eq "OPENAI_API_KEY") {
        Write-Host "$v = $($val.Substring(0, [Math]::Min(8, $val.Length)))..." -ForegroundColor Green
    }
    else {
        Write-Host "$v = $val" -ForegroundColor $(if ($val -eq "true") { "Green" } else { "Yellow" })
    }
}
Write-Host ""
Write-Host "=== Python Vision Server Status ==="
$tcp = New-Object System.Net.Sockets.TcpClient
try {
    $result = $tcp.BeginConnect("127.0.0.1", 5502, $null, $null)
    $wait = $result.AsyncWaitHandle.WaitOne(2000, $false)
    if ($wait -and $tcp.Connected) { Write-Host "Port 5502: RUNNING" -ForegroundColor Green }
    else { Write-Host "Port 5502: NOT REACHABLE" -ForegroundColor Red }
    $tcp.Close()
}
catch {
    Write-Host "Port 5502: ERROR - $($_.Exception.Message)" -ForegroundColor Red
}
