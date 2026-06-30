Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object {
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
    [PSCustomObject]@{PID = $_.Id; Command = $cmd }
}
