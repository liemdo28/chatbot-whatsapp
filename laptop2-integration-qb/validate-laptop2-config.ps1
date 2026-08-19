param(
    [Parameter(Mandatory = $true)]
    [string]$Root
)

$ErrorActionPreference = "Stop"

function Read-EnvFile {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        throw "Missing file: $Path"
    }

    $map = @{}
    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed -split "=", 2
        if ($parts.Count -ne 2) { continue }
        $map[$parts[0].Trim()] = $parts[1].Trim()
    }
    return $map
}

function Test-PlaceholderValue {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
    if ($Value -match '^<REQUIRED') { return $true }
    if ($Value -match '^REPLACE_') { return $true }
    if ($Value -match '^CHANGE_ME') { return $true }
    if ($Value -match '^your[_-]') { return $true }
    if ($Value -match '^TODO') { return $true }
    return $false
}

$requirements = @(
    @{
        Name = "qb-ops-agent"
        Path = Join-Path $Root "qb-ops-agent\.env"
        Vars = @("MI_CORE_URL", "MI_CORE_API_KEY", "MACHINE_ID", "QBWC_PASSWORD")
    },
    @{
        Name = "mi-node-agent"
        Path = Join-Path $Root "mi-node-agent\.env"
        Vars = @("NODE_ID", "NODE_SECRET", "MI_CORE_URL")
    },
    @{
        Name = "doordash-agent"
        Path = Join-Path $Root "doordash-agent\.env"
        Vars = @(
            "DD_B1_EMAIL", "DD_B1_PASS",
            "DD_B2_EMAIL", "DD_B2_PASS",
            "DD_B3_EMAIL", "DD_B3_PASS",
            "DD_RAW_EMAIL", "DD_RAW_PASS"
        )
    }
)

$missing = @()

foreach ($service in $requirements) {
    $values = Read-EnvFile -Path $service.Path
    foreach ($name in $service.Vars) {
        $value = $values[$name]
        if (Test-PlaceholderValue $value) {
            $missing += "$($service.Name):$name"
        }
    }
}

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "Missing required local configuration:" -ForegroundColor Red
    foreach ($item in $missing) {
        Write-Host "  - $item" -ForegroundColor Yellow
    }
    exit 1
}

Write-Host "Configuration validation passed." -ForegroundColor Green
