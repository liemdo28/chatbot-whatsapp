$new = 'C:\Users\hoang\Downloads\source\qb-ops-agent'
$cur = 'C:\Ld-project\services\qb-ops-agent'

function Rel($p) {
    Get-ChildItem -Path $p -Recurse -File -ErrorAction SilentlyContinue |
    ForEach-Object { $_.FullName.Substring($p.Length).TrimStart('\', '/').ToLowerInvariant() } |
    Sort-Object
}

$relNew = Rel $new
$relCur = Rel $cur

"== Files chi co trong SOURCE MOI (can merge vao project) ==" | Out-File -FilePath C:\Ld-project\__diff.txt
$onlyNew = $relNew | Where-Object { $_ -notin $relCur }
$onlyNew | ForEach-Object { Out-File -FilePath C:\Ld-project\__diff.txt -Append -InputObject "+ $_" }
"`n== Files chi co trong PROJECT HIEN TAI (giu nguyen) ==" | Out-File -FilePath C:\Ld-project\__diff.txt -Append
$onlyCur = $relCur | Where-Object { $_ -notin $relNew }
$onlyCur | ForEach-Object { Out-File -FilePath C:\Ld-project\__diff.txt -Append -InputObject "- $_" }

"`n== Thong ke ==" | Out-File -FilePath C:\Ld-project\__diff.txt -Append
"New source: $($relNew.Count) files" | Out-File -FilePath C:\Ld-project\__diff.txt -Append
"Current project: $($relCur.Count) files" | Out-File -FilePath C:\Ld-project\__diff.txt -Append
"Chi co trong new: $($onlyNew.Count)" | Out-File -FilePath C:\Ld-project\__diff.txt -Append
"Chi co trong cur: $($onlyCur.Count)" | Out-File -FilePath C:\Ld-project\__diff.txt -Append

Get-Content C:\Ld-project\__diff.txt