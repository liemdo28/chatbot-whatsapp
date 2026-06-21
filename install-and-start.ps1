$outFile = "C:\Ld-project\install-and-start.txt"
$projDir = "C:\Users\hoang\Downloads\source\setup-all\Bakudan\review-automation-system"

"=== Installing Dependencies + Starting App ===" | Out-File $outFile
"Time: $(Get-Date)" | Out-File $outFile -Append

# Step 1: Install all deps from pyproject.toml
"[1] Installing all dependencies..." | Out-File $outFile -Append
Push-Location $projDir
try {
    $result = pip install -e . 2>&1 | Out-String
    $result | Out-File $outFile -Append
    "pip install -e . : DONE" | Out-File $outFile -Append
} catch {
    "pip install FAILED: $($_.Exception.Message)" | Out-File $outFile -Append
}
Pop-Location

# Step 2: Also install httpx explicitly just in case
"[2] Installing httpx explicitly..." | Out-File $outFile -Append
pip install httpx 2>&1 | Out-File $outFile -Append

# Step 3: Run DB migrations
"[3] Running alembic migrations..." | Out-File $outFile -Append
Push-Location $projDir
try {
    $alembicResult = alembic upgrade head 2>&1 | Out-String
    $alembicResult | Out-File $outFile -Append
} catch {
    "Alembic: $($_.Exception.Message)" | Out-File $outFile -Append
}
Pop-Location

# Step 4: Kill any existing process on port 8000
"[4] Checking port 8000..." | Out-File $outFile -Append
try {
    $existing = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
    if ($existing) {
        "Killing existing process on port 8000" | Out-File $outFile -Append
        $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
    } else {
        "Port 8000 is free" | Out-File $outFile -Append
    }
} catch {}

# Step 5: Start uvicorn
"[5] Starting uvicorn..." | Out-File $outFile -Append
Push-Location $projDir
$proc = Start-Process -FilePath "python" -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000" -WorkingDirectory $projDir -RedirectStandardOutput "$projDir\logs\stdout.log" -RedirectStandardError "$projDir\logs\stderr.log" -NoNewWindow -PassThru
"Uvicorn PID: $($proc.Id)" | Out-File $outFile -Append
Pop-Location

# Step 6: Wait
"[6] Waiting 15s for app startup..." | Out-File $outFile -Append
Start-Sleep -Seconds 15

# Step 7: Check status
if ($proc.HasExited) {
    "Process EXITED with code: $($proc.ExitCode)" | Out-File $outFile -Append
    "STDERR:" | Out-File $outFile -Append
    if (Test-Path "$projDir\logs\stderr.log") {
        Get-Content "$projDir\logs\stderr.log" -Tail 30 -ErrorAction SilentlyContinue | Out-File $outFile -Append
    }
} else {
    "[7] Process RUNNING!" | Out-File $outFile -Append
    
    # Health check
    try {
        $health = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        "HEALTH: $($health.StatusCode) - $($health.Content)" | Out-File $outFile -Append
    } catch {
        "HEALTH FAILED: $($_.Exception.Message)" | Out-File $outFile -Append
    }
    
    "STDERR:" | Out-File $outFile -Append
    if (Test-Path "$projDir\logs\stderr.log") {
        Get-Content "$projDir\logs\stderr.log" -Tail 30 -ErrorAction SilentlyContinue | Out-File $outFile -Append
    }
    "STDOUT:" | Out-File $outFile -Append
    if (Test-Path "$projDir\logs\stdout.log") {
        Get-Content "$projDir\logs\stdout.log" -Tail 20 -ErrorAction SilentlyContinue | Out-File $outFile -Append
    }
}

"=== DONE ===" | Out-File $outFile -Append