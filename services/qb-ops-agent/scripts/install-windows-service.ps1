#Requires -RunAsAdministrator

param(
    [string]$ServiceName = "QB Ops Agent",
    [string]$BinaryPath = "",
    [string]$Description = "QuickBooks Desktop monitoring agent for Agent OS",
    [string]$DisplayName = "QB Ops Agent",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not $BinaryPath) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $ProjectRoot = Split-Path -Parent $ScriptDir
    $BinaryPath = "node ""$ProjectRoot\dist\index.js"""
}

Write-Host "=== QB Ops Agent — Windows Service Installer ===" -ForegroundColor Cyan
Write-Host "Service Name : $ServiceName"
Write-Host "Binary Path  : $BinaryPath"
Write-Host ""

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

if ($existing -and -not $Force) {
    Write-Host "[SKIP] Service '$ServiceName' already exists. Use -Force to reinstall." -ForegroundColor Yellow
    exit 0
}

if ($existing) {
    Write-Host "[STOP] Stopping existing service..." -ForegroundColor Yellow
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

# Create the service
$createOut = & sc.exe create $ServiceName binPath= $BinaryPath DisplayName= $DisplayName start= auto
Write-Host "[CREATE] $createOut" -ForegroundColor Cyan

# Set recovery options
& sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null

# Set description
& sc.exe description $ServiceName $Description | Out-Null

# Ensure Node.js is in PATH (use full path to node.exe if available)
$nodedir = Split-Path (Get-Command node -ErrorAction SilentlyContinue).Source -Parent
if ($nodedir) {
    $env:Path = "$nodedir;$env:Path"
}

Write-Host ""
Write-Host "[OK] Service '$ServiceName' installed successfully." -ForegroundColor Green
Write-Host "     To start: Start-Service -Name '$ServiceName'" -ForegroundColor White
Write-Host "     To view : Get-Service -Name '$ServiceName'" -ForegroundColor White
Write-Host ""
