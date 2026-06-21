$outFile = "C:\Ld-project\health-check.txt"
"=== Health Check ===" | Out-File $outFile
"Time: $(Get-Date)" | Out-File $outFile -Append

# Check health
try {
    $health = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    "Status: $($health.StatusCode)" | Out-File $outFile -Append
    "Body: $($health.Content)" | Out-File $outFile -Append
} catch {
    "Health FAILED: $($_.Exception.Message)" | Out-File $outFile -Append
}

# Check if uvicorn is running
$procs = Get-Process python -ErrorAction SilentlyContinue | Select ProcessName, Id, StartTime
if ($procs) {
    "Python processes:" | Out-File $outFile -Append
    $procs | Out-File $outFile -Append
} else {
    "No python processes running" | Out-File $outFile -Append
}

# Check ports
"Port checks:" | Out-File $outFile -Append
foreach ($port in @(5432, 6379, 8000)) {
    $conn = Test-NetConnection -ComputerName localhost -Port $port -WarningAction SilentlyContinue
    "Port ${port}: $($conn.TcpTestSucceeded)" | Out-File $outFile -Append
}

# Docker status
"Docker containers:" | Out-File $outFile -Append
& docker ps --format "table {{.Names}}\t{{.Status}}" 2>&1 | Out-File $outFile -Append

"=== DONE ===" | Out-File $outFile -Append