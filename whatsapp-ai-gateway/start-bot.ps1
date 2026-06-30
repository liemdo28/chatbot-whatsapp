# WhatsApp Food Safety Bot - Auto-start script
# Called by Windows Scheduled Task at startup

$ProjectPath = "C:\Ld-project\whatsapp-ai-gateway"
Set-Location $ProjectPath

$env:CHROME_EXECUTABLE_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$env:PUPPETEER_SKIP_DOWNLOAD = "true"

$portInUse = $false
try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $connect = $client.BeginConnect("127.0.0.1", 3211, $null, $null)
    $portInUse = $connect.AsyncWaitHandle.WaitOne(1000, $false) -and $client.Connected
    $client.Close()
} catch {
    $portInUse = $false
}

if ($portInUse) {
    New-Item -ItemType Directory -Path "$ProjectPath\logs" -Force | Out-Null
    Add-Content -Path "$ProjectPath\logs\start-bot.log" -Value "$(Get-Date -Format s) port 3211 already in use; standalone launcher skipped"
    exit 0
}

New-Item -ItemType Directory -Path "$ProjectPath\logs" -Force | Out-Null
$stdout = Join-Path $ProjectPath "logs\start-bot.stdout.log"
$stderr = Join-Path $ProjectPath "logs\start-bot.stderr.log"
$proc = Start-Process -FilePath "node.exe" `
    -ArgumentList @("src/index.js") `
    -WorkingDirectory $ProjectPath `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru
Add-Content -Path "$ProjectPath\logs\start-bot.log" -Value "$(Get-Date -Format s) started standalone hidden bot pid=$($proc.Id)"
exit 0
