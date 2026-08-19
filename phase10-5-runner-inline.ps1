$MiCoreUrl = "http://100.118.102.113:4001"
$QbApiKey = $env:QB_API_KEY
$MiApiKey = $env:MI_CORE_API_KEY
$Results = @{}
$StartTime = Get-Date

if ([string]::IsNullOrWhiteSpace($QbApiKey)) {
    throw "Set QB_API_KEY in the current environment before running this script."
}

if ([string]::IsNullOrWhiteSpace($MiApiKey)) {
    throw "Set MI_CORE_API_KEY in the current environment before running this script."
}

Write-Host ""
Write-Host ("=" * 60) -ForegroundColor DarkCyan
Write-Host "  PHASE 10.5 - DISCOVERY + FULL TEST SUITE" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor DarkCyan

# ── Step 1: List available routes ────────────────────────────────────────────
Write-Host ""
Write-Host "Discovering Mi-Core endpoints..." -ForegroundColor Cyan
$endpoints = @(
    "/api/qb-agent/ping",
    "/api/qb-agent/machines",
    "/api/qb-agent/events",
    "/api/qb-agent/heartbeat",
    "/api/qb-agent/status",
    "/api/qb-agent/event",
    "/api/doordash-agent/machines",
    "/api/doordash-agent/machines/checkin",
    "/api/doordash-agent/checkin",
    "/api/whatsapp/health",
    "/api/whatsapp/status",
    "/health",
    "/api"
)
foreach ($e in $endpoints) {
    $method = "GET"
    $useAuth = $false
    if ($e -match "heartbeat|checkin|events|status") { $method = "POST" }
    try {
        $headers = @{ "Content-Type" = "application/json" }
        if ($e -match "qb-agent/(machines|events)" -and $method -eq "GET") { $headers["x-api-key"] = $MiApiKey }
        if ($e -match "qb-agent/(heartbeat|events)" -and $method -eq "POST") { $headers["x-api-key"] = $MiApiKey }
        $body = $null
        if ($method -eq "POST" -and $e -match "heartbeat") {
            $body = '{"machine_id":"qb-laptop-01","store_code":"raw-stockton","status":"QB_NOT_OPEN","qb_open":false,"app_version":"phase10-5","uptime_seconds":0}'
        }
        $r = Invoke-WebRequest -Uri "$MiCoreUrl$e" -Method $method -Headers $headers -Body $body -TimeoutSec 10 -UseBasicParsing
        Write-Host "  [$method] $e -> $($r.StatusCode) OK" -ForegroundColor Green
    }
    catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -eq 401) { Write-Host "  [$method] $e -> 401 (needs auth)" -ForegroundColor Yellow }
        elseif ($code -eq 405) { Write-Host "  [$method] $e -> 405 (wrong method)" -ForegroundColor Yellow }
        elseif ($code -eq 404) { Write-Host "  [$method] $e -> 404 NOT FOUND" -ForegroundColor Gray }
        else { Write-Host "  [$method] $e -> $($code): $($_.Exception.Message.Substring(0, [Math]::Min(80, $_.Exception.Message.Length)))" -ForegroundColor Gray }
    }
}

# ── Step 2: Now run all 4 tests ──────────────────────────────────────────────
Write-Host ""
Write-Host ("=" * 60) -ForegroundColor DarkCyan
Write-Host "  PHASE 10.5 TESTS" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor DarkCyan

# TEST 1: QB Heartbeat
Write-Host ""
Write-Host "TEST 1 - QB Heartbeat -> Mi-Core" -ForegroundColor Cyan
try {
    $qbProc = Get-Process -Name "QBW*" -ErrorAction SilentlyContinue | Select-Object -First 1
    $qbOpen = [bool]$qbProc
    $status = "QB_NOT_OPEN"
    $uptime = 0
    if ($qbOpen) { $status = "QB_READY"; $uptime = [int]((Get-Date) - $qbProc.StartTime).TotalSeconds }
    Write-Host "  [INFO] QB open: $qbOpen" -ForegroundColor Gray
    $body = @{ machine_id = "qb-laptop-01"; store_code = "raw-stockton"; status = $status; qb_open = $qbOpen; app_version = "phase10-5-runner"; uptime_seconds = $uptime; meta = @{ source = "Phase10-5"; phase = "10.5"; test_id = "TEST1_QB_HEARTBEAT"; laptop1_ip = "100.111.97.25"; timestamp = (Get-Date -Format "o") } } | ConvertTo-Json -Depth 6
    $r = Invoke-WebRequest -Uri "$MiCoreUrl/api/qb-agent/heartbeat" -Method POST -Headers @{"Content-Type" = "application/json"; "x-api-key" = $MiApiKey } -Body $body -TimeoutSec 20 -UseBasicParsing
    Write-Host "  [PASS] QB Heartbeat accepted (HTTP $($r.StatusCode))" -ForegroundColor Green
    $Results["test1"] = "PASS"
}
catch {
    Write-Host "  [FAIL] $($_.Exception.Message)" -ForegroundColor Red
    $Results["test1"] = "FAIL"
}

# TEST 2: DoorDash Checkin
Write-Host ""
Write-Host "TEST 2 - DoorDash Checkin -> Mi-Core" -ForegroundColor Cyan
try {
    $ddProc = Get-NetTCPConnection -LocalPort 3460 -ErrorAction SilentlyContinue | Select-Object -First 1
    $ddRunning = [bool]$ddProc
    Write-Host "  [INFO] DD agent running on 3460: $ddRunning" -ForegroundColor Gray
    $ddStatus = "AGENT_OFFLINE"
    if ($ddRunning) { $ddStatus = "AGENT_RUNNING" }
    $body = @{ machine_id = "laptop1-doordash-agent"; event_type = "checkin"; agent_version = "phase10-5"; store_code = "raw-stockton"; status = $ddStatus; agent_running = $ddRunning; phase = "10.5"; test_id = "TEST2_DOORDASH_CHECKIN"; laptop1_ip = "100.111.97.25"; timestamp = (Get-Date -Format "o") } | ConvertTo-Json
    $r = Invoke-WebRequest -Uri "$MiCoreUrl/api/doordash-agent/machines/checkin" -Method POST -Headers @{"Content-Type" = "application/json" } -Body $body -TimeoutSec 20 -UseBasicParsing
    Write-Host "  [PASS] DoorDash checkin accepted (HTTP $($r.StatusCode))" -ForegroundColor Green
    $Results["test2"] = "PASS"
}
catch {
    Write-Host "  [FAIL] $($_.Exception.Message)" -ForegroundColor Red
    $Results["test2"] = "FAIL"
}

# TEST 4: Failure Simulation - try multiple endpoints
Write-Host ""
Write-Host "TEST 4 - Failure Simulation (QB_OFFLINE event)" -ForegroundColor Cyan
$body = @{ machine_id = "qb-laptop-01"; store_code = "raw-stockton"; event_type = "QB_OFFLINE"; event_key = "phase10-5-failure-test"; message = "Phase 10.5 failure simulation"; severity = "critical"; occurred_at = (Get-Date -Format "o"); payload = @{ test_id = "TEST4_FAILURE_SIM"; simulated = $true; laptop1_ip = "100.111.97.25" } } | ConvertTo-Json -Depth 6
$evtEndpoints = @("/api/qb-agent/events", "/api/qb-agent/event", "/api/qb-agent/heartbeat", "/api/events", "/api/qb-agent/log")
$evtPassed = $false
foreach ($ep in $evtEndpoints) {
    try {
        Write-Host "  Trying $ep..." -ForegroundColor Gray
        $r = Invoke-WebRequest -Uri "$MiCoreUrl$ep" -Method POST -Headers @{"Content-Type" = "application/json"; "x-api-key" = $MiApiKey } -Body $body -TimeoutSec 20 -UseBasicParsing
        Write-Host "  [PASS] Failure event accepted at $ep (HTTP $($r.StatusCode))" -ForegroundColor Green
        $Results["test4"] = "PASS"
        $evtPassed = $true
        break
    }
    catch {
        $code = $_.Exception.Response.StatusCode.value__
        Write-Host "  -> $code" -ForegroundColor Gray
    }
}
if (-not $evtPassed) {
    Write-Host "  [FAIL] No working event endpoint" -ForegroundColor Red
    $Results["test4"] = "FAIL"
}

# TEST 5: Revenue Objective - reuse same endpoint
Write-Host ""
Write-Host "TEST 5 - Revenue Objective (Raw Sushi 10%)" -ForegroundColor Cyan
$body = @{ machine_id = "qb-laptop-01"; store_code = "raw-stockton"; event_type = "REVENUE_OBJECTIVE_REQUEST"; event_key = "phase10-5-revenue-objective"; message = "CEO Directive: Increase Raw Sushi Revenue 10%"; severity = "high"; occurred_at = (Get-Date -Format "o"); payload = @{ test_id = "TEST5_REVENUE_OBJECTIVE"; objective_title = "Increase Raw Sushi Revenue 10%"; target_store = "raw-stockton"; target_increase = 0.10; laptop1_ip = "100.111.97.25"; data_sources = @("QuickBooks", "DoorDash"); current_qb_status = $Results["test1"]; current_dd_status = $Results["test2"]; note = "Phase 10.5 certification test" } } | ConvertTo-Json -Depth 8
$objPassed = $false
foreach ($ep in $evtEndpoints) {
    try {
        Write-Host "  Trying $ep..." -ForegroundColor Gray
        $r = Invoke-WebRequest -Uri "$MiCoreUrl$ep" -Method POST -Headers @{"Content-Type" = "application/json"; "x-api-key" = $MiApiKey } -Body $body -TimeoutSec 20 -UseBasicParsing
        Write-Host "  [PASS] Revenue objective accepted at $ep (HTTP $($r.StatusCode))" -ForegroundColor Green
        $Results["test5"] = "PASS"
        $objPassed = $true
        break
    }
    catch {
        $code = $_.Exception.Response.StatusCode.value__
        Write-Host "  -> $code" -ForegroundColor Gray
    }
}
if (-not $objPassed) {
    Write-Host "  [FAIL] No working objective endpoint" -ForegroundColor Red
    $Results["test5"] = "FAIL"
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host ("=" * 60) -ForegroundColor DarkCyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor DarkCyan
Write-Host "  T1 QB Heartbeat -> Mi-Core: $($Results['test1'])" -ForegroundColor $(if ($Results["test1"] -eq "PASS") { "Green" }else { "Red" })
Write-Host "  T2 DoorDash Checkin:        $($Results['test2'])" -ForegroundColor $(if ($Results["test2"] -eq "PASS") { "Green" }else { "Red" })
Write-Host "  T4 Failure Event:           $($Results['test4'])" -ForegroundColor $(if ($Results["test4"] -eq "PASS") { "Green" }else { "Red" })
Write-Host "  T5 Revenue Objective:       $($Results['test5'])" -ForegroundColor $(if ($Results["test5"] -eq "PASS") { "Green" }else { "Red" })

$pass = ($Results.Values | Where-Object { $_ -eq "PASS" }).Count
$fail = ($Results.Values | Where-Object { $_ -eq "FAIL" }).Count
Write-Host ""
Write-Host "  Pass: $pass / 4  |  Fail: $fail / 4" -ForegroundColor White
if ($fail -eq 0) { Write-Host "  STATUS: LAPTOP1 OPERATIONAL" -ForegroundColor Green }
elseif ($pass -ge 3) { Write-Host "  STATUS: LAPTOP1 PARTIAL" -ForegroundColor Yellow }
else { Write-Host "  STATUS: LAPTOP1 DEGRADED" -ForegroundColor Red }

$elapsed = [int]((Get-Date) - $StartTime).TotalSeconds
Write-Host ""
Write-Host "  Runtime: ${elapsed}s" -ForegroundColor Gray
Write-Host ""
Write-Host "=== JSON Results ===" -ForegroundColor Cyan
$Results | ConvertTo-Json -Depth 4
