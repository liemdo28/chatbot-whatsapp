Start-Sleep -Seconds 5
$port = 5502
$tcp = New-Object System.Net.Sockets.TcpClient
try {
    $result = $tcp.BeginConnect("127.0.0.1", $port, $null, $null)
    $wait = $result.AsyncWaitHandle.WaitOne(3000, $false)
    if ($wait -and $tcp.Connected) {
        Write-Host "OK - Vision server is running on port $port"
    } else {
        Write-Host "FAIL - Server not reachable after 5s"
    }
    $tcp.Close()
} catch {
    Write-Host "FAIL - $($_.Exception.Message)"
}
