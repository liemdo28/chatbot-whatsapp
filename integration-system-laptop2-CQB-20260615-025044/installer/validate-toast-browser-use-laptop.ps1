param(
    [string]$LaptopName = $env:COMPUTERNAME,
    [string]$Store = "",
    [string]$BusinessDate = "",
    [bool]$InstallBrowserUse = $true
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$DesktopApp = Join-Path $Root "desktop-app"
$ReportsDir = Join-Path $Root "reports"
$EvidenceDir = Join-Path $ReportsDir "evidence\toast-browser-use-laptop"
$ReportPath = Join-Path $ReportsDir "TOAST_BROWSER_USE_REAL_LAPTOP_FINAL_VALIDATION.md"
$Python = Join-Path $DesktopApp ".venv\Scripts\python.exe"
$Pip = Join-Path $DesktopApp ".venv\Scripts\pip.exe"

New-Item -ItemType Directory -Force $ReportsDir | Out-Null
New-Item -ItemType Directory -Force $EvidenceDir | Out-Null

function Run-Step {
    param(
        [string]$Name,
        [scriptblock]$Block
    )
    Write-Host "== $Name ==" -ForegroundColor Cyan
    try {
        & $Block 2>&1 | Tee-Object -Variable output
        return @{
            name = $Name
            ok = $LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE
            output = ($output -join "`n")
        }
    } catch {
        return @{
            name = $Name
            ok = $false
            output = $_.Exception.ToString()
        }
    }
}

$results = @()
$results += Run-Step "Environment" {
    Write-Output "LaptopName=$LaptopName"
    Write-Output "Windows=$([System.Environment]::OSVersion.VersionString)"
    Write-Output "Root=$Root"
    Write-Output "DesktopAppExists=$(Test-Path $DesktopApp)"
    Write-Output "PythonExists=$(Test-Path $Python)"
}

if ($InstallBrowserUse) {
    $requirements = Join-Path $DesktopApp "requirements-browser-use.txt"
    $results += Run-Step "Install browser-use" {
        & $Pip install -r $requirements
    }
}

$results += Run-Step "Verify browser-use import" {
    & $Python -c "import browser_use; print('browser-use installed')"
}

$results += Run-Step "App startup proof" {
    Push-Location $DesktopApp
    try {
        $env:PYTHONPATH = $DesktopApp
        @"
from app import App
app = App(runtime_mode='gui', start_hidden=True, headless_downloads=None)
print('APP_CREATED_OK')
print('HAS_TOAST_DOWNLOAD_PANEL=', hasattr(app, 'toast_download_panel'))
print('TOAST_FRAME_EXISTS=', 'toast_download' in app._tab_frames)
app.destroy()
"@ | & $Python -
    } finally {
        Pop-Location
    }
}

$installOk = ($results | Where-Object { $_.name -eq "Verify browser-use import" } | Select-Object -First 1).ok
$startupOk = ($results | Where-Object { $_.name -eq "App startup proof" } | Select-Object -First 1).ok
$verdict = if ($installOk -and $startupOk) { "PASS WITH WARNINGS" } else { "FAIL" }

$body = @()
$body += "# Toast Browser-Use Real Laptop Final Validation"
$body += ""
$body += "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$body += ""
$body += "## Laptop"
$body += ""
$body += "- Laptop name: $LaptopName"
$body += "- Windows version: $([System.Environment]::OSVersion.VersionString)"
$body += "- Root: $Root"
$body += ""
$body += "## Evidence Folder"
$body += ""
$body += '```text'
$body += $EvidenceDir
$body += '```'
$body += ""
$body += "Expected screenshots:"
$body += ""
$body += "- 01-ui-panel.png"
$body += "- 02-toast-profile-login.png"
$body += "- 03-downloaded-report-folder.png"
$body += "- 04-report-validation.png"
$body += "- 05-mi-core-event.png"
$body += "- 06-google-sheet-toast-row.png"
$body += ""
foreach ($r in $results) {
    $body += "## $($r.name)"
    $body += ""
    $body += "Result: " + ($(if ($r.ok) { "PASS" } else { "FAIL" }))
    $body += ""
    $body += '```text'
    $body += $r.output
    $body += '```'
    $body += ""
}
$body += "## Manual Live Checks"
$body += ""
$body += "| Check | Result | Notes |"
$body += "|---|---|---|"
$body += "| UI panel screenshot | PENDING | Capture 01-ui-panel.png |"
$body += "| Toast profile/login | PENDING | PASS or HUMAN_REQUIRED |"
$body += "| Real report download | PENDING | Capture downloaded folder and validation |"
$body += "| Mi-core event | PENDING | Capture dashboard/event proof |"
$body += "| Google Sheet row | PENDING | Capture Toast Downloads row |"
$body += "| Failure mode | PENDING | Login expired/MFA/report invalid safe handling |"
$body += ""
$body += "## Final Verdict"
$body += ""
$body += '```text'
$body += $verdict
$body += '```'
$body += ""
$body += "FULL PASS requires the manual live checks above to pass."

$body -join "`n" | Set-Content -Path $ReportPath -Encoding UTF8
Write-Host "Report written: $ReportPath" -ForegroundColor Green
Write-Host "Evidence folder: $EvidenceDir" -ForegroundColor Green
exit $(if ($installOk -and $startupOk) { 0 } else { 1 })
