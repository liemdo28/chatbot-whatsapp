# build_installer.ps1
# Builds the ToastPOSManager Inno Setup installer.
# Prerequisites:
#   - Inno Setup 6 installed (default path: C:\Program Files (x86)\Inno Setup 6\ISCC.exe)
#   - EXE already built: cd ..\desktop-app && .\build_release.ps1

param(
    [string]$InnoSetupPath = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    [string]$AltInnoSetupPath = "C:\Program Files\Inno Setup 6\ISCC.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir

Write-Host "=== ToastPOSManager Installer Build ===" -ForegroundColor Cyan
Write-Host "Repo root: $RepoRoot"

# Locate ISCC
$iscc = $null
if (Test-Path $InnoSetupPath)          { $iscc = $InnoSetupPath }
elseif (Test-Path $AltInnoSetupPath)   { $iscc = $AltInnoSetupPath }
else {
    # Try PATH
    $found = Get-Command iscc -ErrorAction SilentlyContinue
    if ($found) { $iscc = $found.Source }
}

if (-not $iscc) {
    Write-Error @"
Inno Setup 6 not found.
Install from: https://jrsoftware.org/isdl.php
Or pass -InnoSetupPath 'C:\path\to\ISCC.exe'
"@
    exit 1
}
Write-Host "Using ISCC: $iscc" -ForegroundColor Green

# Verify main EXE was built
$exePath = Join-Path $RepoRoot "dist\ToastPOSManager.exe"
if (-not (Test-Path $exePath)) {
    Write-Warning "dist\ToastPOSManager.exe not found — building now..."
    Push-Location (Join-Path $RepoRoot "desktop-app")
    & .\build_release.ps1
    Pop-Location
}

# Ensure release dir exists
$releaseDir = Join-Path $RepoRoot "release"
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

# Ensure icon exists (create placeholder if missing)
$iconDir = Join-Path $RepoRoot "desktop-app\assets"
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
$iconPath = Join-Path $iconDir "icon.ico"
if (-not (Test-Path $iconPath)) {
    Write-Warning "icon.ico not found at $iconPath — installer will use default icon"
    # Remove icon references from .iss if no icon
    $issPath = Join-Path $ScriptDir "ToastPOSManager.iss"
    (Get-Content $issPath) -replace '^SetupIconFile=.*', '; SetupIconFile=(not found)' `
                            -replace '^WizardSmallImageFile=.*', '; WizardSmallImageFile=(not found)' `
                            -replace '^UninstallDisplayIcon=.*', '; UninstallDisplayIcon=(not found)' |
        Set-Content "$issPath.tmp"
    $issFile = "$issPath.tmp"
} else {
    $issFile = Join-Path $ScriptDir "ToastPOSManager.iss"
}

# Run ISCC
Write-Host "Running Inno Setup compiler..." -ForegroundColor Yellow
& $iscc $issFile
if ($LASTEXITCODE -ne 0) {
    Write-Error "ISCC failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

$outputExe = Join-Path $releaseDir "ToastPOSManagerSetup.exe"
if (Test-Path $outputExe) {
    $size = [math]::Round((Get-Item $outputExe).Length / 1MB, 1)
    Write-Host ""
    Write-Host "=== BUILD SUCCESS ===" -ForegroundColor Green
    Write-Host "Installer: $outputExe ($size MB)" -ForegroundColor Green
} else {
    Write-Error "Expected output not found: $outputExe"
    exit 1
}
