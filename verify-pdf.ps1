# Dem so file .pdf tren o C va ghi vao log
$count = 0
$totalSize = 0L
try {
    $files = Get-ChildItem -Path 'C:\' -Recurse -File -Filter '*.pdf' -ErrorAction SilentlyContinue
    $count = $files.Count
    $totalSize = ($files | Measure-Object -Property Length -Sum).Sum
}
catch {}

$msg = "=== KIEM TRA FILE .pdf ==="
$msg2 = "So file .pdf tren o C: $count"
$msg3 = "Tong dung luong .pdf: $([math]::Round($totalSize/1MB,2)) MB"

$msg  | Out-File -FilePath "C:\Ld-project\clean-c-drive.log" -Append -Encoding UTF8
$msg2 | Out-File -FilePath "C:\Ld-project\clean-c-drive.log" -Append -Encoding UTF8
$msg3 | Out-File -FilePath "C:\Ld-project\clean-c-drive.log" -Append -Encoding UTF8

# In ra stdout
"$msg`n$msg2`n$msg3"