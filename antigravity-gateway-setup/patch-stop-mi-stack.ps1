# ============================================================
# Patch stop-mi-stack.ps1 to EXCLUDE Antigravity Gateway
# Adds protection check at the top of the kill logic
# ============================================================

$stopScript = "C:\Users\hoang\Downloads\source\setup-all\stop-mi-stack.ps1"

if (!(Test-Path $stopScript)) {
    Write-Host "stop-mi-stack.ps1 not found at $stopScript" -ForegroundColor Red
    exit 1
}

$original = Get-Content $stopScript -Raw
$content = $original

# Check if already patched
if ($content -match "antigravity-gateway.*PROTECTED") {
    Write-Host "stop-mi-stack.ps1 is already patched" -ForegroundColor Green
    exit 0
}

# Backup original
$backup = "$stopScript.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $stopScript $backup -Force
Write-Host "Backup created: $backup" -ForegroundColor Cyan

# Add protection logic before the kill patterns
$protectionBlock = @'

# === ANTI GRAVITY GATEWAY PROTECTION (added by install-gateway-protection.ps1) ===
# NEVER kill antigravity-gateway processes — they run under PM2 independently
$antigravityProtected = $true
$antigravityPatterns = @("antigravity-gateway")

# === END PROTECTION ===

'@

# Find the kill patterns array and inject protection
$patterns = '$patterns = @('
$idx = $content.IndexOf($patterns)
if ($idx -ge 0) {
    $content = $content.Substring(0, $idx) + $protectionBlock + "`n" + $content.Substring($idx)
}

# Modify the kill filter to skip protected patterns
$killFilter = '($_.Name -match "node|npm|cmd|powershell|python|pythonw") -and'
$replacementFilter = '($_.Name -match "node|npm|cmd|powershell|python|pythonw") -and
        # Skip antigravity-gateway (PROTECTED)
        -not ($cmdline -match "antigravity-gateway") -and'
$content = $content.Replace($killFilter, $replacementFilter)

# Also protect port 3456
$portLine = 'Get-NetTCPConnection -LocalPort 4100,3211,4400,4300 -State Listen'
if ($content.Contains($portLine)) {
    $portReplacement = "Get-NetTCPConnection -LocalPort 4100,3211,4400,4300,3456 -State Listen | Where-Object { `$_.LocalPort -ne 3456 }"
    $content = $content.Replace($portLine, $portReplacement)
}

Set-Content -Path $stopScript -Value $content -NoNewline
Write-Host "stop-mi-stack.ps1 patched successfully" -ForegroundColor Green
Write-Host "Gateway (port 3456, PM2 name: antigravity-gateway) is now protected from kill" -ForegroundColor Green
