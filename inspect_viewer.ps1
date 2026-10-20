Write-Host "=== KIEM TRA CHI TIET APP DIEU KHIEN D:\AI\AndroidViewer ==="
$mainProc = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*dist/main.js*" }
foreach ($p in $mainProc) {
    Write-Host ("Process: " + $p.Name + " (PID " + $p.ProcessId + ")")
    Write-Host ("  CommandLine: " + $p.CommandLine)
    Write-Host ("  Executable: " + $p.ExecutablePath)
}

Write-Host ""
Write-Host "=== KIEM TRA SCRCPY DANG CHAY CHO THIET BI NAO ==="
$scrcpyProcs = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'scrcpy.exe' }
foreach ($s in $scrcpyProcs) {
    Write-Host ("PID " + $s.ProcessId + ": " + $s.CommandLine)
}
