# Simple screenshot counter
$stores = @('bakudan-the-rim', 'bakudan-stone-oak', 'bakudan-bandera', 'raw-sushi-bar')
$base = 'c:\Ld-project\doordash-campaign-agent\data\screenshots'
foreach ($s in $stores) {
    $p = Join-Path $base $s
    if (Test-Path $p) {
        $imgs = Get-ChildItem $p -Filter *.png
        Write-Host "$s : $($imgs.Count) screenshots"
    }
    else {
        Write-Host "$s : NO_DIR"
    }
}
# Check DD agent
try {
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/health' -TimeoutSec 5
    Write-Host "DD Agent: OK"
}
catch {
    Write-Host "DD Agent: FAIL"
}
Write-Host "Done."