#Requires -RunAsAdministrator

param(
    [string]$ServiceName = "QB Ops Agent"
)

$ErrorActionPreference = "Stop"

Write-Host "=== QB Ops Agent — Windows Service Uninstaller ===" -ForegroundColor Cyan
Write-Host "Service Name : $ServiceName"
Write-Host ""

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

if (-not $svc) {
    Write-Host "[SKIP] Service '$ServiceName' does not exist." -ForegroundColor Yellow
    exit 0
}

if ($svc.Status -eq 'Running') {
    Write-Host "[STOP] Stopping service..." -ForegroundColor Yellow
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

Write-Host "[DELETE] Removing service..." -ForegroundColor Yellow
& sc.exe delete $ServiceName | Out-Null

Write-Host ""
Write-Host "[OK] Service '$ServiceName' uninstalled successfully." -ForegroundColor Green
Write-Host ""
