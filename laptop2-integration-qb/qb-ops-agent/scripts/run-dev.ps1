#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

Write-Host "=== QB Ops Agent — Dev Runner ===" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

# Load .env if exists
$envFile = Join-Path $ProjectRoot ".env"
if (Test-Path $envFile) {
    Write-Host "[ENV] Loading .env..." -ForegroundColor Gray
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2])
        }
    }
}

# Check Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "[ERROR] Node.js not found. Please install from https://nodejs.org" -ForegroundColor Red
    exit 1
}
Write-Host "[OK]   Node.js: $(node --version)" -ForegroundColor Green
Write-Host "[OK]   npm:     $(npm --version)" -ForegroundColor Green

# Ensure dependencies installed
$nodeModules = Join-Path $ProjectRoot "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host "[NPM]  Installing dependencies..." -ForegroundColor Yellow
    Push-Location $ProjectRoot
    npm install
    Pop-Location
}

# TypeScript check
$tsc = Join-Path $ProjectRoot "node_modules\.bin\tsc.cmd"
if (-not (Test-Path $tsc)) {
    Write-Host "[NPM]  Building TypeScript..." -ForegroundColor Yellow
    Push-Location $ProjectRoot
    npm run build
    Pop-Location
}

Write-Host ""
Write-Host "[RUN]  Starting qb-ops-agent in development mode..." -ForegroundColor Cyan
Write-Host ""

Push-Location $ProjectRoot
npm run dev
