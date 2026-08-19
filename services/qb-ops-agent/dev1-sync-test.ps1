# Dev1 - QBWC SOAP Sync Test Script
# Run on Laptop1 after starting qb-ops-agent

$ErrorActionPreference = 'Continue'
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "============================================="
Write-Host "  Dev1 QBWC SOAP Sync Test"
Write-Host ("  " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Write-Host "============================================="
Write-Host ""

$outDir = "C:\Ld-project\services\qb-ops-agent"
$logFile = Join-Path $outDir "dev1-sync-test-results.txt"

"" | Set-Content -Path $logFile -Encoding UTF8
Add-Content -Path $logFile -Value ("Dev1 QBWC SOAP Sync Test - " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Add-Content -Path $logFile -Value ("=" * 60)

# Step 1: GET /api/status
Write-Host "[1/5] GET http://localhost:3457/api/status" -ForegroundColor Cyan
try {
    $status = Invoke-WebRequest -Uri "http://localhost:3457/api/status" -UseBasicParsing -TimeoutSec 5
    $body = $status.Content
    Write-Host "  HTTP $($status.StatusCode) OK" -ForegroundColor Green
    Write-Host "  Body: $body"
    Add-Content -Path $logFile -Value "[1/5] GET /api/status - HTTP $($status.StatusCode)"
    Add-Content -Path $logFile -Value "      Body: $body"
    # Check requests_received
    $statusObj = $body | ConvertFrom-Json
    if ($statusObj.requests_received -ge 3) {
        Write-Host "  ** requests_received: $($statusObj.requests_received) - QBWC sync detected! **" -ForegroundColor Green
    }
    else {
        Write-Host "  requests_received: $($statusObj.requests_received) (need 3 for full sync)" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Add-Content -Path $logFile -Value "[1/5] GET /api/status - FAILED: $($_.Exception.Message)"
    Add-Content -Path $logFile -Value ""
    Add-Content -Path $logFile -Value "ACTION: Is the agent running? Try: cd C:\Ld-project\services\qb-ops-agent ; start.bat"
    Write-Host ""
    Write-Host "Copy this entire output and send to mi-core." -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# Step 2: GET /qbwc (WSDL)
Write-Host "[2/5] GET http://localhost:3457/qbwc (WSDL)" -ForegroundColor Cyan
try {
    $wsdl = Invoke-WebRequest -Uri "http://localhost:3457/qbwc" -UseBasicParsing -TimeoutSec 5
    $wsdlBody = $wsdl.Content
    $firstLine = ($wsdlBody -split "`n")[0]
    $hasEnvelope = $wsdlBody.Contains('soap:Envelope') -or $wsdlBody.Contains('definitions')
    Write-Host "  HTTP $($wsdl.StatusCode) - WSDL valid: $hasEnvelope" -ForegroundColor Green
    Write-Host "  First 80 chars: $($firstLine.Substring(0, [Math]::Min(80, $firstLine.Length)))"
    Add-Content -Path $logFile -Value "[2/5] GET /qbwc (WSDL) - HTTP $($wsdl.StatusCode), valid=$hasEnvelope"
}
catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Add-Content -Path $logFile -Value "[2/5] GET /qbwc - FAILED: $($_.Exception.Message)"
}
Write-Host ""

# Step 3: GET /api/qb/financial (CEO dashboard endpoint)
Write-Host "[3/5] GET http://localhost:3457/api/qb/financial" -ForegroundColor Cyan
try {
    $finResp = Invoke-WebRequest -Uri "http://localhost:3457/api/qb/financial" -UseBasicParsing -TimeoutSec 5
    $finBody = $finResp.Content
    Write-Host "  HTTP $($finResp.StatusCode)" -ForegroundColor Green
    $finObj = $finBody | ConvertFrom-Json
    if ($finObj.status -eq 'no_data') {
        Write-Host "  status: no_data - QBWC sync not completed yet" -ForegroundColor Yellow
        Write-Host "  message: $($finObj.message)"
    }
    else {
        Write-Host "  status: ok - financial data available!" -ForegroundColor Green
        if ($finObj.financial.summary) {
            $s = $finObj.financial.summary
            Write-Host "  Summary:" -ForegroundColor White
            Write-Host "    Revenue (30d):   $($s.total_revenue_30d)"
            Write-Host "    Sales Receipts:  $($s.total_sales_receipts_30d)"
            Write-Host "    Invoices (30d):  $($s.total_invoices_30d)"
            Write-Host "    Outstanding AR:  $($s.total_invoices_outstanding)"
            Write-Host "    Income Accounts: $($s.total_income_accounts) (balance: $($s.total_income_balance))"
            Write-Host "    Expense Accts:   $($s.total_expense_accounts) (balance: $($s.total_expense_balance))"
            Write-Host "    Net Income 30d:  $($s.net_income_30d)"
            Write-Host "    Transactions:    $($s.transaction_count)"
        }
    }
    Add-Content -Path $logFile -Value "[3/5] GET /api/qb/financial - HTTP $($finResp.StatusCode)"
    Add-Content -Path $logFile -Value "      Body (first 2000 chars): $($finBody.Substring(0, [Math]::Min(2000, $finBody.Length)))"
}
catch {
    $errCode = $_.Exception.Response.StatusCode.value__
    Write-Host "  HTTP $errCode - pre-sync expected" -ForegroundColor Yellow
    Add-Content -Path $logFile -Value "[3/5] GET /api/qb/financial - HTTP $errCode"
}
Write-Host ""

# Step 4: GET /api/qb/financial/summary
Write-Host "[4/5] GET http://localhost:3457/api/qb/financial/summary" -ForegroundColor Cyan
try {
    $sumResp = Invoke-WebRequest -Uri "http://localhost:3457/api/qb/financial/summary" -UseBasicParsing -TimeoutSec 5
    Write-Host "  HTTP $($sumResp.StatusCode)" -ForegroundColor Green
    Write-Host "  $($sumResp.Content.Substring(0, [Math]::Min(500, $sumResp.Content.Length)))"
    Add-Content -Path $logFile -Value "[4/5] GET /api/qb/financial/summary - HTTP $($sumResp.StatusCode)"
}
catch {
    $errCode = $_.Exception.Response.StatusCode.value__
    Write-Host "  HTTP $errCode - pre-sync expected" -ForegroundColor Yellow
    Add-Content -Path $logFile -Value "[4/5] GET /api/qb/financial/summary - HTTP $errCode"
}
Write-Host ""

# Step 5: Instructions
Write-Host "[5/5] Trigger QBWC sync manually" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1. Open QuickBooks Desktop on Laptop1"
Write-Host "  2. Open company file: MI_CEO.qbw (must be active)"
Write-Host "  3. Open QuickBooks Web Connector (Start menu)"
Write-Host "  4. Verify 'mi-core-connector' is in the list:"
Write-Host "     - App URL: http://localhost:3457/qbwc"
Write-Host "     - Password source: QBWC_PASSWORD from the local ignored .env"
Write-Host "  5. Click 'Update Selected'"
Write-Host "  6. Wait for QBWC to complete the sync"
Write-Host "  7. After sync completes, run this script again"
Write-Host ""
Add-Content -Path $logFile -Value "[5/5] Manual step: trigger QBWC sync via Web Connector UI"
Add-Content -Path $logFile -Value ""
Add-Content -Path $logFile -Value "After sync completes, re-run this script and send the new file to mi-core."

Write-Host "============================================="
Write-Host "  Results saved to: $logFile"
Write-Host "  Send that file to mi-core."
Write-Host "============================================="
