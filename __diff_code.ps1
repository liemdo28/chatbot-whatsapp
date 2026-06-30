$new = 'C:\Users\hoang\Downloads\source\qb-ops-agent'
$cur = 'C:\Ld-project\services\qb-ops-agent'

# Lay danh sach file CODE (khong tinh node_modules) tu source moi
$newCode = Get-ChildItem -Path $new -Recurse -File -ErrorAction SilentlyContinue |
Where-Object { $_.FullName -notmatch '[\\\/]node_modules[\\\/]' } |
ForEach-Object { $_.FullName.Substring($new.Length).TrimStart('\', '/').ToLowerInvariant() }

# Lay danh sach file CODE tu project hien tai (tru data, logs, dist)
$curCode = Get-ChildItem -Path $cur -Recurse -File -ErrorAction SilentlyContinue |
Where-Object { $_.FullName -notmatch '[\\\/](node_modules|data|logs|dist|reports|docs)[\\\/]' } |
ForEach-Object { $_.FullName.Substring($cur.Length).TrimStart('\', '/').ToLowerInvariant() }

"== SOURCE MOI - File code (tru node_modules) ==" | Out-File -FilePath C:\Ld-project\__diff_code.txt
$newCode | ForEach-Object { Out-File -FilePath C:\Ld-project\__diff_code.txt -Append -InputObject $_ }
"`n== PROJECT HIEN TAI - File code (tru data/logs/dist) ==" | Out-File -FilePath C:\Ld-project\__diff_code.txt -Append
$curCode | ForEach-Object { Out-File -FilePath C:\Ld-project\__diff_code.txt -Append -InputObject $_ }

"`n== Trung lap (source moi co, project cung co - can MERGE) ==" | Out-File -FilePath C:\Ld-project\__diff_code.txt -Append
$overlap = $newCode | Where-Object { $_ -in $curCode }
$overlap | ForEach-Object { Out-File -FilePath C:\Ld-project\__diff_code.txt -Append -InputObject $_ }

"`n== Thong ke ==" | Out-File -FilePath C:\Ld-project\__diff_code.txt -Append
"New code files: $($newCode.Count)" | Out-File -FilePath C:\Ld-project\__diff_code.txt -Append
"Cur code files: $($curCode.Count)" | Out-File -FilePath C:\Ld-project\__diff_code.txt -Append
"Overlap (can merge): $($overlap.Count)" | Out-File -FilePath C:\Ld-project\__diff_code.txt -Append

Get-Content C:\Ld-project\__diff_code.txt