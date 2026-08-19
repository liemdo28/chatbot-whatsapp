# ============================================================
#  ToastPOSManager QB Agent — Silent Installer
#  Usage (called by INSTALL-laptop-XX.bat):
#    install-agent.ps1 -LaptopId "qb-laptop-01" -StoreName "Bandera"
# ============================================================
param(
    [Parameter(Mandatory=$true)][string]$LaptopId,
    [Parameter(Mandatory=$true)][string]$StoreName,
    [string]$ApiKey  = $env:MI_CORE_API_KEY,
    [string]$MiCoreUrl = "http://100.118.102.113:4001",
    [switch]$NoPrompt
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$AppRoot   = Split-Path -Parent $ScriptDir          # integration-system root
$AppDir    = Join-Path $AppRoot "desktop-app"
$VenvDir   = Join-Path $AppDir ".venv"
$VenvPy    = Join-Path $VenvDir "Scripts\python.exe"
$VenvPyW   = Join-Path $VenvDir "Scripts\pythonw.exe"
$DataDir   = "C:\ProgramData\ToastPOSManager"
$LogFile   = Join-Path $DataDir "logs\install.log"
$TaskName  = "ToastPOSManager-Background"

if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    Write-Host "ERROR: MI_CORE_API_KEY is required. Set it in the current environment or pass -ApiKey." -ForegroundColor Red
    exit 1
}

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $msg"
    Write-Host $line
    try { Add-Content $LogFile $line -ErrorAction SilentlyContinue } catch {}
}

function Step($n, $total, $msg) {
    Write-Host ""
    Write-Host "[$n/$total] $msg" -ForegroundColor Cyan
}

function Invoke-LoggedCommand($exe, [string[]]$arguments, $description) {
    Log "$description`: $exe $($arguments -join ' ')"
    & $exe @arguments 2>&1 | ForEach-Object {
        $line = "$_"
        if ($line.Trim()) { Log $line }
    }
    if ($LASTEXITCODE -ne 0) {
        throw "$description failed with exit code $LASTEXITCODE"
    }
}

function Bootstrap-Venv($reset) {
    if ($reset -and (Test-Path $VenvDir)) {
        Log "Removing broken venv: $VenvDir"
        Remove-Item -LiteralPath $VenvDir -Recurse -Force
    }
    if (-not (Test-Path $VenvPy)) {
        Invoke-LoggedCommand "python" @("-m", "venv", $VenvDir) "Create venv"
        Log "Created venv at $VenvDir"
    }
    Invoke-LoggedCommand $VenvPy @("-m", "ensurepip", "--upgrade") "Bootstrap pip"
    Invoke-LoggedCommand $VenvPy @("-m", "pip", "install", "--no-cache-dir", "--force-reinstall", "--upgrade", "pip", "setuptools", "wheel") "Upgrade pip tooling"
    Invoke-LoggedCommand $VenvPy @("-m", "pip", "install", "--no-cache-dir", "-r", "requirements.txt") "Install requirements"
}

# ── Create data dirs early so log works ──────────────────────────────────────
foreach ($d in @(
    "$DataDir\config",
    "$DataDir\runtime\reporting-outbox",
    "$DataDir\logs\qb-activity",
    "$DataDir\logs\reporting-events",
    "$DataDir\db",
    "$DataDir\backups",
    "$DataDir\updates"
)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  ToastPOSManager QB Agent - Install ($LaptopId)" -ForegroundColor Green
Write-Host "  Store: $StoreName" -ForegroundColor Green
Write-Host "  Mi-core: $MiCoreUrl" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green

# ── STEP 1: Python ────────────────────────────────────────────────────────────
Step 1 7 "Checking Python..."
try {
    $pyVer = & python --version 2>&1
    Log "Python found: $pyVer"
} catch {
    Write-Host "  ERROR: Python not found!" -ForegroundColor Red
    Write-Host "  Please install Python 3.11+ from https://python.org" -ForegroundColor Yellow
    Write-Host "  Make sure to check 'Add Python to PATH' during install" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# ── STEP 2: Set MI_CORE_API_KEY system env var ────────────────────────────────
Step 2 7 "Setting MI_CORE_API_KEY environment variable..."
try {
    [System.Environment]::SetEnvironmentVariable("MI_CORE_API_KEY", $ApiKey, "Machine")
    [System.Environment]::SetEnvironmentVariable("AGENT_CODING_API_KEY", $ApiKey, "Machine")
    Log "API keys set at Machine scope"
} catch {
    [System.Environment]::SetEnvironmentVariable("MI_CORE_API_KEY", $ApiKey, "User")
    [System.Environment]::SetEnvironmentVariable("AGENT_CODING_API_KEY", $ApiKey, "User")
    Log "Machine-scope env failed; API keys set at User scope: $_"
}
$env:MI_CORE_API_KEY = $ApiKey
$env:AGENT_CODING_API_KEY = $ApiKey

# ── STEP 3: Copy config template ──────────────────────────────────────────────
Step 3 7 "Copying config for $LaptopId..."
$templateName = "laptop-01-local-config.json"
if ($LaptopId -eq "qb-laptop-02") { $templateName = "laptop-02-local-config.json" }

$templateSrc  = Join-Path $AppDir "config-templates\$templateName"
$configDest   = Join-Path $DataDir "config\local-config.json"
$configDestLegacy = Join-Path $AppDir "local-config.json"   # app also reads from here

if (Test-Path $configDest) {
    $backup = "$configDest.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $configDest $backup
    Log "Existing config backed up to $backup"
}

Copy-Item $templateSrc $configDest -Force
Copy-Item $templateSrc $configDestLegacy -Force
Log "Config copied from $templateName"

foreach ($cfgPath in @($configDest, $configDestLegacy)) {
    try {
        $raw = Get-Content $cfgPath -Raw
        $raw = $raw.Replace("REPLACE_WITH_USERNAME", $env:USERNAME)
        $json = $raw | ConvertFrom-Json
        if ($json.mi_core) {
            $json.mi_core.base_url = $MiCoreUrl
            $json.mi_core.api_key_env = "MI_CORE_API_KEY"
        }
        $json | ConvertTo-Json -Depth 20 | Set-Content $cfgPath -Encoding UTF8
    } catch {
        Log "Config normalization warning for $cfgPath`: $_"
    }
}

$NeedsQbPath = $false
$ConfiguredQbFile = ""
try {
    $normalizedRaw = Get-Content $configDest -Raw
    $NeedsQbPath = $normalizedRaw.Contains("REPLACE_WITH_ACTUAL_PATH")
    if (-not $NeedsQbPath) {
        $normalizedJson = $normalizedRaw | ConvertFrom-Json
        if ($normalizedJson.quickbooks -and $normalizedJson.quickbooks.company_file) {
            $ConfiguredQbFile = [string]$normalizedJson.quickbooks.company_file
        } elseif ($normalizedJson.qbw_paths) {
            $firstPath = $normalizedJson.qbw_paths.PSObject.Properties | Select-Object -First 1
            if ($firstPath) { $ConfiguredQbFile = [string]$firstPath.Value }
        }
    }
} catch {
    Log "Config post-check warning: $_"
}

if ($NeedsQbPath) {
    Write-Host "  NOTE: You still need to fill in the QB company file path!" -ForegroundColor Yellow
    Write-Host "  Edit: $configDest" -ForegroundColor Yellow
    Write-Host "  Change: REPLACE_WITH_ACTUAL_PATH" -ForegroundColor Yellow
} elseif ($ConfiguredQbFile) {
    Write-Host "  QB company file path configured: $ConfiguredQbFile" -ForegroundColor Green
    Log "QB company file path configured: $ConfiguredQbFile"
} else {
    Write-Host "  Config copied. No QB path placeholder found." -ForegroundColor Green
}

# ── STEP 4: Install Python dependencies ───────────────────────────────────────
Step 4 7 "Creating venv and installing Python packages (this may take 1-2 minutes)..."
Set-Location $AppDir
try {
    Bootstrap-Venv $false
    Log "venv pip install completed"
} catch {
    Write-Host "  WARNING: first pip install failed. Rebuilding venv once..." -ForegroundColor Yellow
    Log "First venv install failed: $_"
    try {
        Bootstrap-Venv $true
        Log "venv pip install completed after rebuild"
    } catch {
        Write-Host "  ERROR: Python package install failed after venv rebuild." -ForegroundColor Red
        Write-Host "  See log: $LogFile" -ForegroundColor Yellow
        Log "Fatal venv install failure: $_"
        exit 1
    }
}

# ── STEP 5: Test Mi-core connectivity ─────────────────────────────────────────
Step 5 7 "Testing connection to Mi-core ($MiCoreUrl)..."
try {
    $headers = @{ "Authorization" = "Bearer $ApiKey" }
    $resp = Invoke-RestMethod -Uri "$MiCoreUrl/api/qb-agent/ping" -Headers $headers -TimeoutSec 5
    if ($resp.ok) {
        Write-Host "  Mi-core connection OK!" -ForegroundColor Green
        Log "Mi-core ping: OK"
    }
} catch {
    Write-Host "  WARNING: Cannot reach Mi-core at $MiCoreUrl" -ForegroundColor Yellow
    Write-Host "  Make sure CEO PC is on and Mi-core is running." -ForegroundColor Yellow
    Write-Host "  The agent will keep retrying automatically." -ForegroundColor Yellow
    Log "Mi-core ping failed: $_"
}

# ── STEP 6: Register Windows Scheduled Task ────────────────────────────────────
Step 6 7 "Registering background agent scheduled task..."
$bgScript = Join-Path $AppDir "background_agent.py"

# Use venv pythonw.exe (no console window); fallback to venv python.exe if pythonw is missing.
$pythonwExe = $VenvPyW
if (-not (Test-Path $pythonwExe)) { $pythonwExe = $VenvPy }

Log "Using Python: $pythonwExe (no-console mode)"

# Remove old task if exists
$oldPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$deleteOutput = & schtasks.exe /Delete /TN $TaskName /F 2>&1
$deleteExit = $LASTEXITCODE
$ErrorActionPreference = $oldPreference
if ($deleteExit -eq 0) {
    Log "Existing scheduled task '$TaskName' removed"
} else {
    Log "No existing scheduled task '$TaskName' to remove: $deleteOutput"
}

# Create new task at ONLOGON
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>ToastPOSManager QB Agent Background Service</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <Delay>PT1M</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Hidden>true</Hidden>
    <RestartOnFailure>
      <Interval>PT5M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$pythonwExe</Command>
      <Arguments>"$bgScript" --background</Arguments>
      <WorkingDirectory>$AppDir</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

$xmlFile = "$env:TEMP\toast-task.xml"
[System.IO.File]::WriteAllText($xmlFile, $xml, [System.Text.Encoding]::Unicode)
schtasks /Create /TN $TaskName /XML $xmlFile /F 2>&1 | Out-Null
Remove-Item $xmlFile -Force -ErrorAction SilentlyContinue
Log "Scheduled task '$TaskName' registered"
Write-Host "  Task '$TaskName' registered (runs 1 min after login, auto-restart on crash)" -ForegroundColor Green

# Start background agent RIGHT NOW (don't wait for reboot)
Write-Host "  Starting background agent now..." -ForegroundColor Cyan
Start-Process $pythonwExe -ArgumentList "`"$bgScript`" --background" -WorkingDirectory $AppDir -WindowStyle Hidden
Start-Sleep -Seconds 2
Write-Host "  Background agent started (running hidden)" -ForegroundColor Green
Log "Background agent started immediately after install"

# ── STEP 7: Create Desktop Shortcut ───────────────────────────────────────────
Step 7 7 "Creating Desktop shortcut..."
try {
    $desktopDir = [Environment]::GetFolderPath("Desktop")
    if ([string]::IsNullOrWhiteSpace($desktopDir)) {
        $desktopDir = Join-Path $env:USERPROFILE "Desktop"
    }
    New-Item -ItemType Directory -Force -Path $desktopDir | Out-Null

    $WshShell = New-Object -ComObject WScript.Shell
    $shortcut = $WshShell.CreateShortcut((Join-Path $desktopDir "ToastPOSManager.lnk"))
    $shortcut.TargetPath  = Join-Path $AppDir "launch.bat"
    $shortcut.Arguments   = ""
    $shortcut.WorkingDirectory = $AppDir
    $shortcut.Description = "ToastPOSManager QB Agent"
    $shortcut.Save()
    Log "Desktop shortcut created at $desktopDir"
} catch {
    Write-Host "  WARNING: Could not create Desktop shortcut. Background agent is already installed." -ForegroundColor Yellow
    Log "Desktop shortcut warning: $_"
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  INSTALL COMPLETE!" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Machine ID : $LaptopId" -ForegroundColor White
Write-Host "  Store      : $StoreName" -ForegroundColor White
Write-Host "  Mi-core    : $MiCoreUrl" -ForegroundColor White
Write-Host "  API Key    : [SET]" -ForegroundColor White
if ($ConfiguredQbFile) {
    Write-Host "  QB File    : $ConfiguredQbFile" -ForegroundColor White
}
Write-Host ""
if ($NeedsQbPath) {
    Write-Host "  NEXT STEP:" -ForegroundColor Yellow
    Write-Host "  Edit QB file path in:" -ForegroundColor Yellow
    Write-Host "  $configDest" -ForegroundColor Yellow
} else {
    Write-Host "  Config:" -ForegroundColor Yellow
    Write-Host "  $configDest" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Then double-click 'ToastPOSManager' on Desktop to launch." -ForegroundColor Yellow
Write-Host ""
Log "Install complete for $LaptopId"

if (-not $NoPrompt) {
    Read-Host "Press Enter to open config file for editing"
    notepad $configDest
}
