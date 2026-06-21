# build-deploy-zips.ps1
# Creates two deploy ZIPs:
#   release/deploy-qb-laptop-01.zip  (Bandera)
#   release/deploy-qb-laptop-02.zip  (Stone Oak)
# Each ZIP is self-contained: copy to laptop + double-click INSTALL-laptop-XX.bat

$Root      = Split-Path -Parent $PSScriptRoot
$ReleaseDir = Join-Path $Root "release"
New-Item -ItemType Directory -Force $ReleaseDir | Out-Null

# Folders/files to include (relative to $Root)
$IncludeDirs = @(
    "desktop-app\services",
    "desktop-app\ui",
    "desktop-app\config-templates",
    "desktop-app\Map",
    "desktop-app\content",
    "desktop-app\models",
    "desktop-app\scripts",
    "desktop-app\assets",
    "installer"
)

$IncludeFiles = @(
    "desktop-app\main.py",
    "desktop-app\background_agent.py",
    "desktop-app\app.py",
    "desktop-app\app_paths.py",
    "desktop-app\app_shared.py",
    "desktop-app\launch.bat",
    "desktop-app\requirements.txt",
    "desktop-app\requirements-browser-use.txt",
    "desktop-app\version.json",
    "desktop-app\qb-mapping.json",
    "desktop-app\.env.example",
    "desktop-app\.env.qb.example",
    "desktop-app\.env.agent.example",
    "desktop-app\local-config.example.json",
    "INSTALL-ONE-CLICK-HIDDEN.bat",
    "INSTALL-laptop-01.bat",
    "INSTALL-laptop-02.bat",
    "DEPLOYMENT_GUIDE.md"
)

# Additional desktop-app .py files at root level
$ExtraAppFiles = Get-ChildItem (Join-Path $Root "desktop-app") -Filter "*.py" -File |
    Where-Object { $_.Name -notin @("main.py","background_agent.py","app.py","app_paths.py","app_shared.py") } |
    ForEach-Object { "desktop-app\$($_.Name)" }

$AllFiles = $IncludeFiles + $ExtraAppFiles

function Build-Zip($zipName, $laptopId) {
    $zipPath  = Join-Path $ReleaseDir $zipName
    $stagingDir = Join-Path $env:TEMP "toast-deploy-$laptopId"

    # Clean staging
    if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force }
    New-Item -ItemType Directory -Force $stagingDir | Out-Null

    Write-Host "Building $zipName..." -ForegroundColor Cyan

    # Copy dirs
    foreach ($rel in $IncludeDirs) {
        $src = Join-Path $Root $rel
        $dst = Join-Path $stagingDir $rel
        if (Test-Path $src) {
            # Exclude .venv, __pycache__, dist, build, *.pyc, .pytest_cache
            $exclude = @("*.pyc","*.pyo",".venv","__pycache__","dist","build",".pytest_cache","*.db","*.log")
            Copy-Item $src $dst -Recurse -Force
            # Remove junk in staging
            Get-ChildItem $dst -Recurse -Directory | Where-Object { $_.Name -in @("__pycache__",".venv","dist","build",".pytest_cache") } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
            Get-ChildItem $dst -Recurse -Filter "*.pyc" | Remove-Item -Force -ErrorAction SilentlyContinue
        }
    }

    # Copy individual files
    foreach ($rel in $AllFiles) {
        $src = Join-Path $Root $rel
        $dst = Join-Path $stagingDir $rel
        if (Test-Path $src) {
            $dstDir = Split-Path $dst -Parent
            New-Item -ItemType Directory -Force $dstDir | Out-Null
            Copy-Item $src $dst -Force
        }
    }

    # Remove old ZIP if exists
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

    # Compress
    Compress-Archive -Path "$stagingDir\*" -DestinationPath $zipPath -CompressionLevel Optimal
    Remove-Item $stagingDir -Recurse -Force

    $sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
    Write-Host "  Created: $zipPath ($sizeMB MB)" -ForegroundColor Green
}

Build-Zip "deploy-qb-laptop-01.zip" "laptop01"
Build-Zip "deploy-qb-laptop-02.zip" "laptop02"

Write-Host ""
Write-Host "====================================" -ForegroundColor Green
Write-Host " Deploy ZIPs ready in: $ReleaseDir" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green
Write-Host ""
Write-Host " Laptop 1 (Bandera)   : deploy-qb-laptop-01.zip" -ForegroundColor White
Write-Host " Laptop 2 (Stone Oak) : deploy-qb-laptop-02.zip" -ForegroundColor White
Write-Host ""
Write-Host " Instructions for each laptop:" -ForegroundColor Yellow
Write-Host " 1. Copy ZIP to laptop" -ForegroundColor Yellow
Write-Host " 2. Extract to C:\ToastPOSManager\" -ForegroundColor Yellow
Write-Host " 3. Double-click INSTALL-laptop-0X.bat" -ForegroundColor Yellow
Write-Host " 4. Edit QB file path when prompted" -ForegroundColor Yellow
