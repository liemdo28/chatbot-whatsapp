# start-vision-llm.ps1 — Start Vision LLM Bridge Server alongside WhatsApp Gateway
# Run this BEFORE starting the main gateway when USE_VISION_LLM_PIPELINE=true
#
# Usage:
#   .\start-vision-llm.ps1
#
# This starts the Python Vision LLM server on port 5502.
# The gateway (node src/index.js) connects to it automatically when USE_VISION_LLM_PIPELINE=true.

$ErrorActionPreference = "Stop"

# Set GEMINI_API_KEY if not already set
if (-not $env:GEMINI_API_KEY) {
    $env:GEMINI_API_KEY = Read-Host "Enter GEMINI_API_KEY"
}

# Model selection (default: gemini-2.5-flash)
if (-not $env:VISION_LLM_MODEL) {
    $env:VISION_LLM_MODEL = "gemini-2.5-flash"
}

$pivotDir = Join-Path $PSScriptRoot "..\handwriting-pivot"
if (-not (Test-Path $pivotDir)) {
    $pivotDir = "C:\Ld-project\handwriting-pivot"
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Vision LLM Bridge Server" -ForegroundColor Cyan
Write-Host " Port: 5502" -ForegroundColor Cyan
Write-Host " Model: $env:VISION_LLM_MODEL" -ForegroundColor Cyan
Write-Host " Dir: $pivotDir" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

Set-Location $pivotDir
python server.py --port 5502
