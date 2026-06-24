# Find QBWC executable and QWCLog
$ErrorActionPreference = "SilentlyContinue"

# Method 1: Search common paths
$searchPaths = @(
    "C:\Program Files (x86)\Intuit\QuickBooks",
    "C:\Program Files\Intuit\QuickBooks",
    "C:\Program Files (x86)\Common Files\Intuit\QuickBooks"
)
foreach ($base in $searchPaths) {
    if (Test-Path $base) {
        $qbwc = Get-ChildItem -Path $base -Filter "QBWC.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 3
        if ($qbwc) {
            foreach ($f in $qbwc) {
                Write-Host "QBWC_EXE: $($f.FullName) (Size: $($f.Length))"
            }
        }
        $qbwc3 = Get-ChildItem -Path $base -Filter "QBWebConnector.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 3
        if ($qbwc3) {
            foreach ($f in $qbwc3) {
                Write-Host "WEB_CONNECTOR_EXE: $($f.FullName) (Size: $($f.Length))"
            }
        }
    }
}

# Method 2: Search registry for uninstall info
$regPath = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
$apps = Get-ItemProperty $regPath -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*QuickBooks*Web*" }
foreach ($app in $apps) {
    Write-Host "REGISTRY: $($app.DisplayName) - $($app.InstallLocation)"
}

# Method 3: QWCLog search
$logSearch = @(
    "C:\Users\hoang\AppData\Local\Intuit\QuickBooks",
    "C:\Users\hoang\AppData\Roaming\Intuit\QuickBooks",
    "C:\ProgramData\Intuit\QuickBooks",
    "C:\Users\hoang\Documents\QuickBooks"
)
foreach ($logBase in $logSearch) {
    if (Test-Path $logBase) {
        $logs = Get-ChildItem -Path $logBase -Filter "QWCLog*" -Recurse -ErrorAction SilentlyContinue
        if ($logs) {
            foreach ($l in $logs) {
                Write-Host "QWCLOG: $($l.FullName) (Size: $($l.Length) bytes, Modified: $($l.LastWriteTime))"
            }
        }
    }
}

# Method 4: Find Web Connector via Start Menu shortcut
$startMenuPaths = @(
    "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\QuickBooks",
    "C:\Users\hoang\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\QuickBooks"
)
foreach ($sm in $startMenuPaths) {
    if (Test-Path $sm) {
        $lnks = Get-ChildItem -Path $sm -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue
        foreach ($lnk in $lnks) {
            Write-Host "SHORTCUT: $($lnk.FullName)"
        }
    }
}
