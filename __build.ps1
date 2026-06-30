$proj = 'C:\Ld-project\services\qb-ops-agent'
Set-Location $proj
$log = 'C:\Ld-project\__build.log'
"=== BUILD qb-ops-agent $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File $log
"Working dir: $(Get-Location)" | Out-File $log -Append
"Node: $(node --version)  npm: $(npm --version)" | Out-File $log -Append
"--- npx tsc ---" | Out-File $log -Append
$npx = npx tsc 2>&1
$npx | Out-File $log -Append
"--- EXIT CODE: $LASTEXITCODE ---" | Out-File $log -Append
Get-Content $log