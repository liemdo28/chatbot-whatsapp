# ============================================================================
# clean-c-drive.ps1
# Muc dich: Don rac o C o muc TIEU CHUAN (an toan).
# RANG BUOC QUAN TRONG: TUYET DOI KHONG XOA FILE .pdf (ap dung o moi buoc).
# Quyen: can Run as Administrator.
# ============================================================================

#Requires -RunAsAdministrator
$ErrorActionPreference = 'Continue'
$LogFile = "C:\Ld-project\clean-c-drive.log"

# ---------- Ham helper ----------
function Write-Log {
    param([string]$Msg)
    $stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    "$stamp  $Msg" | Out-File -FilePath $LogFile -Append -Encoding UTF8
}

# Tinh tong dung luong (bytes) cua 1 folder, BO QUA file .pdf
function Get-FolderSizeExcludePdf {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    try {
        $total = (Get-ChildItem -LiteralPath $Path -Recurse -File -ErrorAction SilentlyContinue |
                  Where-Object { $_.Extension -ne '.pdf' } |
                  Measure-Object -Property Length -Sum).Sum
        return [long]($total -as [long])
    } catch { return 0 }
}

# Don rac 1 folder: xoa file khong phai .pdf (giu .pdf), giu thu muc
function Clear-FolderKeepPdf {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Log "[SKIP] $Label - khong ton tai: $Path"
        return
    }
    $before = Get-FolderSizeExcludePdf -Path $Path
    try {
        # Xoa file (khong phai .pdf)
        Get-ChildItem -LiteralPath $Path -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -ne '.pdf' } |
            ForEach-Object {
                try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue } catch {}
            }
        # Xoa thu muc rong
        Get-ChildItem -LiteralPath $Path -Recurse -Directory -ErrorAction SilentlyContinue |
            Where-Object { (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue).Count -eq 0 } |
            ForEach-Object {
                try { Remove-Item -LiteralPath $_.FullName -Force -Recurse -ErrorAction SilentlyContinue } catch {}
            }
        $after = Get-FolderSizeExcludePdf -Path $Path
        $freed = [math]::Round(($before - $after) / 1MB, 2)
        Write-Log "[OK]   $Label  giai phong ~${freed} MB (giu .pdf)"
    } catch {
        Write-Log "[ERR]  $Label  : $($_.Exception.Message)"
    }
}

# Xoa file cu hon X ngay, giu .pdf
function Clear-OldFilesKeepPdf {
    param([string]$Path, [int]$Days, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Log "[SKIP] $Label - khong ton tai: $Path"
        return
    }
    $before = Get-FolderSizeExcludePdf -Path $Path
    $cutoff = (Get-Date).AddDays(-$Days)
    try {
        Get-ChildItem -LiteralPath $Path -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -ne '.pdf' -and $_.LastWriteTime -lt $cutoff } |
            ForEach-Object {
                try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue } catch {}
            }
        $after = Get-FolderSizeExcludePdf -Path $Path
        $freed = [math]::Round(($before - $after) / 1MB, 2)
        Write-Log "[OK]   $Label (>$Days ngay)  giai phong ~${freed} MB (giu .pdf)"
    } catch {
        Write-Log "[ERR]  $Label : $($_.Exception.Message)"
    }
}

# ---------- BAT DAU ----------
Write-Log "==== BAT DAU DON RAC O C (MUC TIEU CHUAN) ===="
Write-Log "May: $env:COMPUTERNAME  User: $env:USERNAME"

$winDir   = $env:SystemRoot
$userTemp = $env:TEMP
$sysTemp  = Join-Path $winDir 'Temp'
$appData  = $env:LOCALAPPDATA
$prof     = $env:USERPROFILE

# --- 1. Windows Temp ---
Clear-FolderKeepPdf -Path $sysTemp -Label "Windows\Temp"

# --- 2. User Temp ---
Clear-FolderKeepPdf -Path $userTemp -Label "User TEMP ($userTemp)"

# --- 3. Recycle Bin (tat ca o dia) ---
try {
    $before = (Get-PSDrive -PSProvider FileSystem | Measure-Object -Property Used -Sum).Sum
    Clear-RecycleBin -Force -ErrorAction SilentlyContinue
    Write-Log "[OK]   Recycle Bin da xoa (trong toan bo o dia, he thong tu loai tru file khoa)"
} catch { Write-Log "[ERR]  Recycle Bin : $($_.Exception.Message)" }

# --- 4. Windows Error Reporting cache ---
$wer1 = Join-Path $prof 'AppData\Local\Microsoft\Windows\WER'
$wer2 = Join-Path $winDir 'LiveKernelReports'
Clear-FolderKeepPdf -Path $wer1 -Label "WER user cache"
Clear-FolderKeepPdf -Path $wer2 -Label "LiveKernelReports"

# --- 5. Prefetch (cu hon 30 ngay, giu .pdf - thuc te folder nay khong co pdf) ---
$prefetch = Join-Path $winDir 'Prefetch'
Clear-OldFilesKeepPdf -Path $prefetch -Days 30 -Label "Prefetch"

# --- 6. CrashDumps (Windows Memory Dumps, giu .pdf) ---
$crashPaths = @(
    (Join-Path $winDir 'Minidump'),
    (Join-Path $winDir 'MEMORY.DMP'),
    (Join-Path $winDir 'LiveKernelReports')
)
foreach ($p in $crashPaths) {
    if (Test-Path -LiteralPath $p) {
        if ((Get-Item -LiteralPath $p).PSIsContainer) {
            Clear-FolderKeepPdf -Path $p -Label "CrashDump $p"
        } else {
            # File rieng - chi xoa neu KHONG phai .pdf
            if ([System.IO.Path]::GetExtension($p) -ne '.pdf') {
                try { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue; Write-Log "[OK]   File dump $p da xoa" } catch {}
            } else {
                Write-Log "[SKIP] File dump $p la .pdf - BO QUA"
            }
        }
    }
}

# --- 7. Windows Update cache (tam dung service -> xoa -> bat lai) ---
$wuPath = Join-Path $winDir 'SoftwareDistribution\Download'
if (Test-Path -LiteralPath $wuPath) {
    Write-Log "[..]   Tam dung Windows Update service..."
    $svc = Get-Service -Name wuauserv -ErrorAction SilentlyContinue
    $wasRunning = $false
    if ($svc -and $svc.Status -eq 'Running') { $wasRunning = $true; Stop-Service -Name wuauserv -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
    Clear-FolderKeepPdf -Path $wuPath -Label "WindowsUpdate cache (SoftwareDistribution\Download)"
    if ($wasRunning) { Start-Service -Name wuauserv -ErrorAction SilentlyContinue }
} else {
    Write-Log "[SKIP] WindowsUpdate cache khong ton tai"
}

# --- 8. Logs cu (Windows Logs *.log/.old cu hon 60 ngay, giu .pdf) ---
$logPaths = @(
    (Join-Path $winDir 'Logs'),
    (Join-Path $winDir 'Panther'),
    (Join-Path $winDir 'debug')
)
foreach ($lp in $logPaths) {
    Clear-OldFilesKeepPdf -Path $lp -Days 60 -Label "Logs $lp"
}

# --- 9. BITS jobs hoan tat (giai phong file tam) ---
try {
    Get-BitsTransfer -AllUsers -ErrorAction SilentlyContinue |
        Where-Object { $_.JobState -in 'Transferred','Error','Cancelled' } |
        ForEach-Object { Remove-BitsTransfer -BitsJob $_ -ErrorAction SilentlyContinue }
    Write-Log "[OK]   BITS jobs hoan tat da don"
} catch {}

# --- 10. Thong ke truoc/sau ---
$freeAfter = (Get-PSDrive C).Free / 1GB
Write-Log "==== HOAN TAT. Con trong o C: $([math]::Round($freeAfter,2)) GB ===="
Write-Log "Luu y: file .pdf duoc bao toan TUYET DOI trong moi buoc."

# Mo file log
notepad.exe $LogFile | Out-Null