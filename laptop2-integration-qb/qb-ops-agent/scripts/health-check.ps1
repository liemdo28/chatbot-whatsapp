#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

Write-Host "=== QB Ops Agent — Health Check ===" -ForegroundColor Cyan

$checks = @()
$pass = $true

function Test-Check($name, $condition, $detail = "") {
    if ($condition) {
        Write-Host "[PASS] $name" -ForegroundColor Green
        $script:checks += @{ name = $name; status = "PASS"; detail = $detail }
    } else {
        Write-Host "[FAIL] $name" -ForegroundColor Red
        if ($detail) { Write-Host "       $detail" -ForegroundColor Yellow }
        $script:checks += @{ name = $name; status = "FAIL"; detail = $detail }
        $script:pass = $false
    }
}

# 1. Node.js
$nodeVersion = node --version 2>$null
Test-Check "Node.js installed" ($null -ne $nodeVersion) $nodeVersion

# 2. npm install
$nodeModules = Join-Path $ProjectRoot "node_modules"
Test-Check "npm install complete" (Test-Path $nodeModules)

# 3. TypeScript build
$distIndex = Join-Path $ProjectRoot "dist\index.js"
Test-Check "npm run build succeeds" (Test-Path $distIndex)

# 4. Machine token
$tokenFile = Join-Path $ProjectRoot ".machine_token"
$hasToken = (Test-Path $tokenFile) -or (-not [string]::IsNullOrEmpty($env:MACHINE_TOKEN))
Test-Check "Machine token present" $hasToken

# 5. QuickBooks process detection
$qbRunning = Get-Process -Name "QBW32" -ErrorAction SilentlyContinue
Test-Check "QuickBooks process (QBW32.exe)" ($null -ne $qbRunning)

# 6. Windows hostname
$hostname = $env:COMPUTERNAME
Test-Check "Windows hostname" ($null -ne $hostname) $hostname

# 7. SQLite DB
$dbPath = Join-Path $ProjectRoot "data\qb-ops-agent.sqlite"
$dbExists = Test-Path $dbPath
Test-Check "Local SQLite DB created" $dbExists

# 8. Log file
$logFile = Join-Path $ProjectRoot "logs\agent.log"
$logDirExists = Test-Path (Split-Path $logFile)
Test-Check "Logs directory" $logDirExists

# 9. Configured company files
$dataDir = Join-Path $ProjectRoot "data"
$cfFile = Join-Path $dataDir "company-files.json"
Test-Check "Company files config" (Test-Path $cfFile)

# 10. Service registration
$svc = Get-Service -Name "QB Ops Agent" -ErrorAction SilentlyContinue
Test-Check "Windows service installed" ($null -ne $svc)

Write-Host ""
if ($pass) {
    Write-Host "=== ALL CHECKS PASSED ===" -ForegroundColor Green
    exit 0
} else {
    Write-Host "=== SOME CHECKS FAILED ===" -ForegroundColor Red
    exit 1
}
