# WhatsApp Food Safety Bot - Auto-start script
# Called by Windows Scheduled Task at startup

$ProjectPath = "C:\Ld-project\whatsapp-ai-gateway"
Set-Location $ProjectPath

$env:CHROME_EXECUTABLE_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$env:PUPPETEER_SKIP_DOWNLOAD = "true"

npm start
