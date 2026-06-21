# start-vision-server.ps1 - Start Vision LLM Bridge Server
# Run before gateway to enable Vision LLM pipeline.

$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line -split "=", 2
            $name = $parts[0].Trim()
            $value = $parts[1].Trim().Trim('"').Trim("'")
            if ($name -and -not [Environment]::GetEnvironmentVariable($name, "Process")) {
                [Environment]::SetEnvironmentVariable($name, $value, "Process")
            }
        }
    }
}

if (-not $env:GEMINI_API_KEY) {
    Write-Error "GEMINI_API_KEY is not set. Set it in your user environment or a local .env file."
    exit 1
}

if (-not $env:VISION_LLM_MODEL) {
    $env:VISION_LLM_MODEL = "gemini-2.5-flash"
}

Write-Host "Starting Vision LLM Bridge Server on port 5502..." -ForegroundColor Green
Write-Host "Model: $env:VISION_LLM_MODEL"

Set-Location "$PSScriptRoot"
python server.py --port 5502
