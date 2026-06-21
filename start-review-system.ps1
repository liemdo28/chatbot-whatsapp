$outFile = "C:\Ld-project\startup-output.txt"
$projDir = "C:\Users\hoang\Downloads\source\setup-all\Bakudan\review-automation-system"

"=== STARTING REVIEW AUTOMATION SYSTEM ===" | Out-File $outFile
"Time: $(Get-Date)" | Out-File $outFile -Append
"" | Out-File $outFile -Append

# Step 1: Start Docker containers
"[1] Starting Docker Compose..." | Out-File $outFile -Append
Push-Location $projDir
try {
    $result = & docker compose up -d 2>&1
    $result | Out-File $outFile -Append
} catch {
    "ERROR: docker compose failed - $_" | Out-File $outFile -Append
}
Pop-Location

# Step 2: Wait for containers to be healthy
"[2] Waiting 15s for containers to initialize..." | Out-File $outFile -Append
Start-Sleep -Seconds 15

# Step 3: Check container status
"[3] Container status:" | Out-File $outFile -Append
try {
    $ps = & docker ps -a --format "table {{.Names}}\t{{.Status}}" 2>&1
    $ps | Out-File $outFile -Append
} catch {
    "docker ps failed" | Out-File $outFile -Append
}

# Step 4: Install/start app
"" | Out-File $outFile -Append
"[4] Installing dependencies..." | Out-File $outFile -Append
Push-Location $projDir
try {
    $pipResult = & pip install fastapi uvicorn apscheduler sqlalchemy asyncpg psycopg2-binary pydantic-settings redis jinja2 python-multipart 2>&1
    "pip install: OK" | Out-File $outFile -Append
} catch {
    "pip install: $($_.Exception.Message)" | Out-File $outFile -Append
}

# Step 5: Start uvicorn
"" | Out-File $outFile -Append
"[5] Starting uvicorn..." | Out-File $outFile -Append
# Kill any existing uvicorn on port 8000
try {
    $existing = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
    if ($existing) {
        "Port 8000 in use, killing..." | Out-File $outFile -Append
        $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    }
} catch {}

# Start uvicorn as background job
$uvicornJob = Start-Process -FilePath "python" -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload" -WorkingDirectory $projDir -PassThru -NoNewWindow
"Uvicorn started (PID: $($uvicornJob.Id))" | Out-File $outFile -Append

# Wait for app
"[6] Waiting 10s for app to start..." | Out-File $outFile -Append
Start-Sleep -Seconds 10

# Step 7: Health check
"" | Out-File $outFile -Append
"[7] Health check:" | Out-File $outFile -Append
try {
    $health = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    "Status: $($health.StatusCode)" | Out-File $outFile -Append
    "Body: $($health.Content)" | Out-File $outFile -Append
} catch {
    "Health check FAILED: $($_.Exception.Message)" | Out-File $outFile -Append
}

"" | Out-File $outFile -Append
"[8] Final port check:" | Out-File $outFile -Append
foreach ($port in @(5432, 6379, 8000)) {
    try {
        $conn = Test-NetConnection -ComputerName localhost -Port $port -WarningAction SilentlyContinue
        "Port ${port}: $($conn.TcpTestSucceeded)" | Out-File $outFile -Append
    } catch {
        "Port ${port}: ERROR" | Out-File $outFile -Append
    }
}

"" | Out-File $outFile -Append
"=== STARTUP COMPLETE ===" | Out-File $outFile -Append