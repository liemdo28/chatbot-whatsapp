$outFile = "C:\Ld-project\docker-status.txt"
"=== Docker Status ===" | Out-File $outFile
"Time: $(Get-Date)" | Out-File $outFile -Append

try {
    $ver = & docker --version 2>&1
    "Docker CLI: $ver" | Out-File $outFile -Append
} catch {
    "Docker CLI: FAILED - $_" | Out-File $outFile -Append
}

try {
    $containers = & docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>&1
    "Containers:" | Out-File $outFile -Append
    $containers | Out-File $outFile -Append
} catch {
    "docker ps: FAILED" | Out-File $outFile -Append
}

"Port 5432:" | Out-File $outFile -Append
& netstat -an | & findstr ":5432" | Out-File $outFile -Append

"Port 6379:" | Out-File $outFile -Append
& netstat -an | & findstr ":6379" | Out-File $outFile -Append

"Port 8000:" | Out-File $outFile -Append
& netstat -an | & findstr ":8000" | Out-File $outFile -Append

"=== DONE ===" | Out-File $outFile -Append