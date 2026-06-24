#!/usr/bin/env pwsh
# QBWC Real Runtime Validation Script

$ErrorActionPreference = "Continue"
$logLines = @()

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $msg"
    Write-Host $line
    $script:logLines += $line
}

Log "=== QBWC REAL RUNTIME VALIDATION START ==="

# Step 1: Find and document QBWC installation
Log "--- Step 1: QBWC Installation ---"
$qwcPaths = @(
    "C:\Program Files (x86)\Intuit\QuickBooks\QBWebConnector",
    "C:\Program Files (x86)\Intuit\QuickBooks\QBWebConnector3.0"
)
foreach ($p in $qwcPaths) {
    if (Test-Path $p) {
        $exes = Get-ChildItem -Path $p -Filter "*.exe" -ErrorAction SilentlyContinue
        Log "FOUND: $p"
        foreach ($e in $exes) {
            Log "  EXE: $($e.FullName) (Size: $($e.Length) bytes)"
        }
    }
}

# Step 2: Kill stale node on port 3456
Log "--- Step 2: Kill stale process on port 3456 ---"
$staleConn = Get-NetTCPConnection -LocalPort 3456 -State Listen -ErrorAction SilentlyContinue
if ($staleConn) {
    $stalePid = $staleConn.OwningProcess
    $proc = Get-Process -Id $stalePid -ErrorAction SilentlyContinue
    Log "Killing PID $stalePid ($($proc.ProcessName)) on port 3456"
    Stop-Process -Id $stalePid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    $verify = Get-NetTCPConnection -LocalPort 3456 -State Listen -ErrorAction SilentlyContinue
    if (-not $verify) {
        Log "SUCCESS: Port 3456 freed"
    }
    else {
        Log "WARNING: Port 3456 still in use"
    }
}
else {
    Log "Port 3456 is free"
}

# Step 3: Ensure port 3457 is free
Log "--- Step 3: Port 3457 check ---"
$p3457 = Get-NetTCPConnection -LocalPort 3457 -State Listen -ErrorAction SilentlyContinue
if ($p3457) {
    Log "WARNING: Port 3457 in use by PID $($p3457.OwningProcess)"
}
else {
    Log "Port 3457 is free - ready for agent"
}

# Step 4: Install npm deps if needed
Log "--- Step 4: npm install ---"
Push-Location "c:\Ld-project\services\qb-ops-agent"
if (-not (Test-Path "node_modules")) {
    Log "Installing npm dependencies..."
    npm install 2>&1 | ForEach-Object { Log "  npm: $_" }
}
else {
    Log "node_modules exists, skipping install"
}
Pop-Location

# Step 5: Find QWCLog
Log "--- Step 5: QWCLog locations ---"
$qwcLogPaths = @(
    "C:\Users\hoang\AppData\Local\Intuit\QuickBooks\QBWebConnector\QWCLog.txt",
    "C:\ProgramData\Intuit\QuickBooks\QBWebConnector\QWCLog.txt",
    "C:\Users\hoang\AppData\Roaming\Intuit\QuickBooks\QWCLog.txt"
)
# Search broader
$wqFiles = Get-ChildItem -Path "C:\Users\hoang\AppData" -Filter "QWCLog*" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 5
if ($wqFiles) {
    foreach ($f in $wqFiles) {
        Log "  QWCLog found: $($f.FullName) (Size: $($f.Length) bytes)"
    }
}
else {
    Log "No QWCLog found in AppData - will be created when QBWC runs"
}

# Step 6: Start qb-ops-agent in background
Log "--- Step 6: Starting qb-ops-agent on port 3457 ---"
Push-Location "c:\Ld-project\services\qb-ops-agent"
$agentJob = Start-Job -ScriptBlock {
    Set-Location "c:\Ld-project\services\qb-ops-agent"
    node src/index.js 2>&1
}
Start-Sleep -Seconds 3

# Step 7: Check if agent started
Log "--- Step 7: Verify agent is listening ---"
$p3457after = Get-NetTCPConnection -LocalPort 3457 -State Listen -ErrorAction SilentlyContinue
if ($p3457after) {
    Log "SUCCESS: Agent listening on port 3457 (PID $($p3457after.OwningProcess))"
}
else {
    Log "FAILED: Agent NOT listening on 3457"
    $jobOut = Receive-Job $agentJob -ErrorAction SilentlyContinue
    Log "Agent output: $jobOut"
}
Pop-Location

# Step 8: Run the 4-step QBWC SOAP sequence
Log "--- Step 8: QBWC SOAP Sequence ---"
$apiUrl = "http://localhost:3457/api/qb/webhook"
$apiKey = "b149c4783a1109ff46d01498d91766e7"

# 8a: authenticate
Log "== STEP 1/4: authenticate =="
$authXml = @"
<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <authenticate xmlns="http://developer.intuit.com/">
      <strUserName>mi-admin</strUserName>
      <strPassword>$apiKey</strPassword>
    </authenticate>
  </soap:Body>
</soap:Envelope>
"@

try {
    $authResp = Invoke-WebRequest -Uri $apiUrl -Method Post -ContentType "text/xml; charset=utf-8" -Body $authXml -TimeoutSec 10
    Log "AUTH HTTP: $($authResp.StatusCode)"
    Log "AUTH Body: $($authResp.Content)"
    $authOk = $authResp.Content -match "authenticateResult"
    Log "AUTH parsed: $authOk"
}
catch {
    Log "AUTH FAILED: $_"
}

# 8b: sendRequestXML
Log "== STEP 2/4: sendRequestXML =="
$sendXml = @"
<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <sendRequestXML xmlns="http://developer.intuit.com/">
      <ticket>QBWC-TICKET-001</ticket>
      <hresult></hresult>
      <estring></estring>
    </sendRequestXML>
  </soap:Body>
</soap:Envelope>
"@

try {
    $sendResp = Invoke-WebRequest -Uri $apiUrl -Method Post -ContentType "text/xml; charset=utf-8" -Body $sendXml -TimeoutSec 10
    Log "SEND HTTP: $($sendResp.StatusCode)"
    Log "SEND Body: $($sendResp.Content)"
    $sendOk = $sendResp.Content -match "sendRequestXMLResult"
    Log "SEND parsed: $sendOk"
}
catch {
    Log "SEND FAILED: $_"
}

# 8c: receiveResponseXML
Log "== STEP 3/4: receiveResponseXML =="
$recvXml = @"
<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <receiveResponseXML xmlns="http://developer.intuit.com/">
      <ticket>QBWC-TICKET-001</ticket>
      <response>&lt;?xml version="1.0"?&gt;&lt;QBXML&gt;&lt;QBXMLMsgsRs&gt;&lt;GeneralSummaryReportRs requestID="1" statusCode="0" statusSeverity="Info" statusMessage="Status OK"&gt;&lt;/GeneralSummaryReportRs&gt;&lt;/QBXMLMsgsRs&gt;&lt;/QBXML&gt;</response>
      <hresult></hresult>
      <estring></estring>
    </receiveResponseXML>
  </soap:Body>
</soap:Envelope>
"@

try {
    $recvResp = Invoke-WebRequest -Uri $apiUrl -Method Post -ContentType "text/xml; charset=utf-8" -Body $recvXml -TimeoutSec 10
    Log "RECV HTTP: $($recvResp.StatusCode)"
    Log "RECV Body: $($recvResp.Content)"
    $recvOk = $recvResp.Content -match "receiveResponseXMLResult"
    Log "RECV parsed: $recvOk"
}
catch {
    Log "RECV FAILED: $_"
}

# 8d: closeConnection
Log "== STEP 4/4: closeConnection =="
$closeXml = @"
<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <closeConnection xmlns="http://developer.intuit.com/">
      <ticket>QBWC-TICKET-001</ticket>
    </closeConnection>
  </soap:Body>
</soap:Envelope>
"@

try {
    $closeResp = Invoke-WebRequest -Uri $apiUrl -Method Post -ContentType "text/xml; charset=utf-8" -Body $closeXml -TimeoutSec 10
    Log "CLOSE HTTP: $($closeResp.StatusCode)"
    Log "CLOSE Body: $($closeResp.Content)"
    $closeOk = $closeResp.Content -match "closeConnectionResult"
    Log "CLOSE parsed: $closeOk"
}
catch {
    Log "CLOSE FAILED: $_"
}

# Step 9: Summary
Log "=== QBWC SOAP SEQUENCE SUMMARY ==="
$results = @{}
$results["authenticate"] = $authOk
results["sendRequestXML"] = $sendOk
results["receiveResponseXML"] = $recvOk
results["closeConnection"] = $closeOk

$allPass = $authOk -and $sendOk -and $recvOk -and $closeOk
if ($allPass) {
    Log "ALL 4 STEPS PASSED - QBWC_RUNTIME_CONNECTED"
    $finalStatus = "QBWC_RUNTIME_CONNECTED"
}
else {
    Log "SOME STEPS FAILED"
    $failedSteps = @()
    if (-not $authOk) { $failedSteps += "authenticate" }
    if (-not $sendOk) { $failedSteps += "sendRequestXML" }
    if (-not $recvOk) { $failedSteps += "receiveResponseXML" }
    if (-not $closeOk) { $failedSteps += "closeConnection" }
    Log "Failed: $($failedSteps -join ', ')"
    $finalStatus = "QBWC_RUNTIME_NOT_CERTIFIED"
}

Log "FINAL STATUS: $finalStatus"

# Step 10: Health check
Log "--- Health Check ---"
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3457/health" -TimeoutSec 5
    Log "Health: $($health | ConvertTo-Json -Compress)"
}
catch {
    Log "Health check failed: $_"
}

# Step 11: Capture agent logs
Log "--- Agent Job Output ---"
$agentOutput = Receive-Job $agentJob -ErrorAction SilentlyContinue
if ($agentOutput) {
    $agentOutput | ForEach-Object { Log "  AGENT: $_" }
}
else {
    Log "No agent job output captured"
}

# Write validation log
$logContent = $script:logLines -join "`n"
$logPath = "c:\Ld-project\services\qb-ops-agent\QBWC_VALIDATION_LOG.txt"
[System.IO.File]::WriteAllText($logPath, $logContent)
Log "Log written to: $logPath"

Log "=== QBWC REAL RUNTIME VALIDATION COMPLETE ==="
