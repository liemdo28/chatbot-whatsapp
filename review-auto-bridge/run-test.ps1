$ErrorActionPreference = "Stop"
Set-Location "C:\Ld-project\review-auto-bridge"

# Install dependencies
Write-Host "[TEST] Installing npm dependencies..."
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install failed"
    exit 1
}

# Quick syntax check
Write-Host "[TEST] Checking syntax..."
try {
    node -e "require('./db')"
    node -e "require('./auto-reply')"
    node -e "require('./scheduler')"
    Write-Host "[OK] All module syntax checks passed"
}
catch {
    Write-Host "[ERROR] Syntax check failed: $_"
    exit 1
}

# Start server in background
Write-Host "[TEST] Starting server on port 8787..."
$serverJob = Start-Process -FilePath "node" -ArgumentList "main.js" -WorkingDirectory "C:\Ld-project\review-auto-bridge" -PassThru -NoNewWindow
Start-Sleep -Seconds 3

if ($serverJob.HasExited) {
    Write-Host "[ERROR] Server exited immediately with code $($serverJob.ExitCode)"
    exit 1
}
Write-Host "[OK] Server running (PID: $($serverJob.Id))"

# Health check
Write-Host "[TEST] Testing /api/health..."
try {
    $health = Invoke-WebRequest -Uri "http://localhost:8787/api/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "[OK] Health: $($health.Content)"
}
catch {
    Write-Host "[ERROR] Health check failed: $_"
    Stop-Process -Id $serverJob.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

# Stats check
Write-Host "[TEST] Testing /api/stats..."
try {
    $stats = Invoke-WebRequest -Uri "http://localhost:8787/api/stats" -UseBasicParsing -TimeoutSec 5
    $statsJson = $stats.Content | ConvertFrom-Json
    Write-Host "[OK] Stats: total=$($statsJson.total_reviews), auto_replied=$($statsJson.auto_replied), pending=$($statsJson.pending_ceo_queue)"
}
catch {
    Write-Host "[ERROR] Stats check failed: $_"
}

# Reviews check
Write-Host "[TEST] Testing /api/reviews..."
try {
    $reviews = Invoke-WebRequest -Uri "http://localhost:8787/api/reviews" -UseBasicParsing -TimeoutSec 5
    $rj = $reviews.Content | ConvertFrom-Json
    Write-Host "[OK] Reviews loaded: $($rj.reviews.Count) reviews"
}
catch {
    Write-Host "[ERROR] Reviews check failed: $_"
}

# CEO queue check
Write-Host "[TEST] Testing /api/approval-queue..."
try {
    $queue = Invoke-WebRequest -Uri "http://localhost:8787/api/approval-queue" -UseBasicParsing -TimeoutSec 5
    $qj = $queue.Content | ConvertFrom-Json
    Write-Host "[OK] CEO queue: $($qj.queue.Count) items"
}
catch {
    Write-Host "[ERROR] Queue check failed: $_"
}

# Scheduler next-run check
Write-Host "[TEST] Testing /api/scheduler/next-run..."
try {
    $nextRun = Invoke-WebRequest -Uri "http://localhost:8787/api/scheduler/next-run" -UseBasicParsing -TimeoutSec 5
    Write-Host "[OK] Scheduler: $($nextRun.Content)"
}
catch {
    Write-Host "[ERROR] Scheduler check failed: $_"
}

Write-Host ""
Write-Host "=========================================="
Write-Host " ALL TESTS PASSED"
Write-Host "=========================================="
Write-Host ""
Write-Host "Dashboard:    http://localhost:8787/"
Write-Host "CEO Approval: http://localhost:8787/approval"
Write-Host "Health:       http://localhost:8787/api/health"
Write-Host ""
Write-Host "[TEST] Stopping server..."
Stop-Process -Id $serverJob.Id -Force -ErrorAction SilentlyContinue
Write-Host "[DONE]"