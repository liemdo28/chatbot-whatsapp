import subprocess
# Run powershell to check raw bytes of the problematic lines
result = subprocess.run([
    'powershell.exe', '-Version', '5.1', '-ExecutionPolicy', 'Bypass', '-Command',
    r'''
$content = Get-Content -LiteralPath 'e:\Project\Master\Bakudan\integration-system\desktop-app\build_release.ps1' -Raw -Encoding Default
$bytes = [System.Text.Encoding]::Default.GetBytes($content)
$lines = $content -split "`n"
# Show lines 270-280 with byte-level inspection
for ($i = 269; $i -lt 280; $i++) {
    $line = $lines[$i]
    $hex = [BitConverter]::ToString($bytes[$i..($i+10)]) -replace '-',' '
    Write-Host "Line $($i+1): $line"
    Write-Host "  Hex: $hex"
}
'''
], capture_output=True, text=True)
print("STDOUT:", result.stdout[:3000])
print("STDERR:", result.stderr[:3000])