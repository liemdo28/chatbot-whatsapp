$outFile = "C:\Ld-project\app-start-debug.txt"
$projDir = "C:\Users\hoang\Downloads\source\setup-all\Bakudan\review-automation-system"

"=== Starting App with Debug Output ===" | Out-File $outFile
"Time: $(Get-Date)" | Out-File $outFile -Append

# Check if there's a process on 8000
$existing = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
if ($existing) {
    "Port 8000 in use, killing..." | Out-File $outFile -Append
    $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

# Try running the app directly to see errors
"Attempting uvicorn start..." | Out-File $outFile -Append
Push-Location $projDir

# Run uvicorn and capture stderr/stdout for 15 seconds
$proc = Start-Process -FilePath "python" -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000" -WorkingDirectory $projDir -RedirectStandardOutput "$projDir\logs\stdout.log" -RedirectStandardError "$projDir\logs\stderr.log" -NoNewWindow -PassThru

"Uvicorn PID: $($proc.Id)" | Out-File $outFile -Append

Start-Sleep -Seconds 15

if ($proc.HasExited) {
    "Process EXITED with code: $($proc.ExitCode)" | Out-File $outFile -Append
    if (Test-Path "$projDir\logs\stderr.log") {
        "STDERR:" | Out-File $outFile -Append
        Get-Content "$projDir\logs\stderr.log" -ErrorAction SilentlyContinue | Out-File $outFile -Append
    }
    if (Test-Path "$projDir\logs\stdout.log") {
        "STDOUT:" | Out-File $outFile -Append
        Get-Content "$projDir\logs\stdout.log" -ErrorAction SilentlyContinue | Out-File $outFile -Append
    }
} else {
    "Process still running!" | Out-File $outFile -Append
    
    # Try health check
    try {
        $health = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        "Health: $($health.StatusCode) - $($health.Content)" | Out-File $outFile -Append
    } catch {
        "Health FAILED: $($_.Exception.Message)" | Out-File $outFile -Append
    }
    
    if (Test-Path "$projDir\logs\stderr.log") {
        "STDERR (last 30 lines):" | Out-File $outFile -Append
        Get-Content "$projDir\logs\stderr.log" -Tail 30 -ErrorAction SilentlyContinue | Out-File $outFile -Append
    }
    if (Test-Path "$projDir\logs\stdout.log") {
        "STDOUT (last 30 lines):" | Out-File $outFile -Append
        Get-Content "$projDir\logs\stdout.log" -Tail 30 -ErrorAction SilentlyContinue | Out-File $outFile -Append
    }
}

Pop-Location
"=== DONE ===" | Out-File $outFile -Append