# merge-qb-ops.ps1
# Merge source moi vao project hien tai (KHONG mat data/running config)
# Chay voi quyen Admin de tranh loi Chan thay doi

$ErrorActionPreference = 'Stop'
$source = 'C:\Users\hoang\Downloads\source\qb-ops-agent'
$target = 'C:\Ld-project\services\qb-ops-agent'

$log = "C:\Ld-project\__merge-log.txt"
function Log { param($m) $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; "$stamp  $m" | Out-File -FilePath $log -Append -Encoding UTF8; Write-Host "$stamp  $m" }

Log "=== BAT DAU MERGE qb-ops-agent ==="
Log "Source: $source"
Log "Target: $target"

# === 1. Copy docs/ (tu source moi, bo sung them) ===
$docsNew = Join-Path $source 'docs'
if (Test-Path $docsNew) {
    $docFiles = Get-ChildItem -Path $docsNew -File -ErrorAction SilentlyContinue
    Log "[1] Copy $($docFiles.Count) files vao docs/"
    New-Item -Path (Join-Path $target 'docs') -ItemType Directory -Force | Out-Null
    New-Item -Path (Join-Path $target 'scripts') -ItemType Directory -Force | Out-Null
    New-Item -Path (Join-Path $target 'reports') -ItemType Directory -Force | Out-Null
    foreach ($f in $docFiles) {
        $dest = Join-Path $target "docs\$($f.Name)"
        Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
        Log "  + docs\$($f.Name)"
    }
}
else { Log "[1] SKIP - khong co docs" }

# === 2. Copy scripts/ (tu source moi, bo sung them) ===
$scriptsNew = Join-Path $source 'scripts'
if (Test-Path $scriptsNew) {
    $scrFiles = Get-ChildItem -Path $scriptsNew -File -ErrorAction SilentlyContinue
    Log "[2] Copy $($scrFiles.Count) files vao scripts/"
    foreach ($f in $scrFiles) {
        $dest = Join-Path $target "scripts\$($f.Name)"
        Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
        Log "  + scripts\$($f.Name)"
    }
}
else { Log "[2] SKIP - khong co scripts" }

# === 3. Copy reports/ (tu source moi, chi lay QA report) ===
$reportsNew = Join-Path $source 'reports'
if (Test-Path $reportsNew) {
    $repFiles = Get-ChildItem -Path $reportsNew -File -ErrorAction SilentlyContinue
    Log "[3] Copy $($repFiles.Count) files vao reports/"
    foreach ($f in $repFiles) {
        $dest = Join-Path $target "reports\$($f.Name)"
        Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
        Log "  + reports\$($f.Name)"
    }
}
else { Log "[3] SKIP - khong co reports" }

# === 4. Copy .env.example (neu khac voi hien tai) ===
$envExampleSrc = Join-Path $source '.env.example'
$envExampleDst = Join-Path $target '.env.example'
if (Test-Path $envExampleSrc) {
    $srcHash = (Get-FileHash -LiteralPath $envExampleSrc -Algorithm SHA256).Hash
    $dstHash = if (Test-Path $envExampleDst) { (Get-FileHash -LiteralPath $envExampleDst -Algorithm SHA256).Hash } else { $null }
    if ($srcHash -ne $dstHash) {
        Copy-Item -LiteralPath $envExampleSrc -Destination $envExampleDst -Force
        Log "[4] + Cap nhat .env.example (noi dung khac)"
    }
    else {
        Log "[4] = .env.example giong nhau, bo qua"
    }
}
else { Log "[4] SKIP - khong co .env.example" }

# === 5. KHONG copy dist/ (source moi la v1.0.0 cu, project dang chay v2.0.0) ===
Log "[5] BO QUA dist/ - source moi la v1.0.0 cu hon project hien tai v2.0.0"

# === 6. KHONG copy node_modules/ (se chay npm install lai) ===
Log "[6] BO QUA node_modules/ - se chay npm install de lay dung dependencies"

# === 7. KHONG copy 26 file .ts trung (vi source moi la v1 cu) ===
Log "[7] BO QUA 26 file .ts trung lap - source moi v1.0.0 cu hon project v2.0.0"

# === 8. KHONG copy package.json (project v2.0.0 co express+xml2js can thiet) ===
Log "[8] BO QUA package.json - project v2.0.0 co express/xml2js, source v1.0.0 khong co"

Log ""
Log "=== XAC NHAN DATA/LOG/RUNTIME BI GIU NGUYEN ==="
$preserveList = @(
    'data',
    'logs',
    '.env',
    '.machine_token',
    '.qwc',
    'start.bat',
    'start-hidden.vbs',
    'install.bat',
    'open-firewall-3457.bat',
    'test-authenticate.xml',
    'QBWC_AUTH_SOAP_FIX_REPORT.md',
    'QBWC_REAL_RUNTIME_VALIDATION.md',
    'QBWC_VALIDATION_LOG.txt',
    'DEPLOY_V2_SOAP_UPGRADE_REPORT.md',
    'DEV1_QUICKBOOKS_SETUP_COMPLETION_REPORT.md',
    'DEV1_SYNC_TEST_RESULTS.txt',
    'DEV1_SYNC_TEST.ps1',
    '_FIND_QBWC.ps1',
    '_QBWC_VAL.ps1',
    '_AGENT.STDOUT.LOG',
    '_AGENT.STDERR.LOG',
    'AGENT.LOG',
    'AGENT.ERR.LOG'
)
foreach ($p in $preserveList) {
    $full = Join-Path $target $p
    if (Test-Path $full) { Log "  OK  $p" }
    else { Log "  ??  $p (khong ton tai - co the OK)" }
}

Log ""
Log "=== HOAN TAT MERGE ==="
Log "Tiep theo can chay: cd C:\Ld-project\services\qb-ops-agent; npm install; npx tsc"
Log "Moi that se chay: node dist\index.js"
notepad.exe $log | Out-Null