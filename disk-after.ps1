$c = Get-PSDrive C
$usedGB = [math]::Round(($c.Used / 1GB), 2)
$freeGB = [math]::Round(($c.Free / 1GB), 2)
$totalGB = [math]::Round((($c.Used + $c.Free) / 1GB), 2)
$usedPct = [math]::Round(($c.Used / ($c.Used + $c.Free) * 100), 1)

"=== O C SAU KHI DON ===" | Out-File -FilePath "C:\Ld-project\clean-c-drive.log" -Append -Encoding UTF8
"Total: $totalGB GB | Used: $usedGB GB ($usedPct%) | Free: $freeGB GB" | Out-File -FilePath "C:\Ld-project\clean-c-drive.log" -Append -Encoding UTF8
"Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -FilePath "C:\Ld-project\clean-c-drive.log" -Append -Encoding UTF8

"Total: $totalGB GB | Used: $usedGB GB ($usedPct%) | Free: $freeGB GB"