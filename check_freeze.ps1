Write-Host "=== 1. KIEM TRA CAC TIEN TRINH ADB VA SCRCPY DANG CHAY ==="
$adbCount = (Get-Process -Name 'adb' -ErrorAction SilentlyContinue).Count
$scrcpyCount = (Get-Process -Name 'scrcpy' -ErrorAction SilentlyContinue).Count
Write-Host ("So luong tien trinh ADB dang chay: " + $adbCount)
Write-Host ("So luong tien trinh scrcpy dang chay: " + $scrcpyCount)

Write-Host ""
Write-Host "=== 2. KIEM TRA TIEN TRINH ADB SERVER CHINH (PORT 5037) ==="
$mainAdb = Get-Process -Name 'adb' -ErrorAction SilentlyContinue | Sort-Object CPU -Descending | Select-Object -First 3
$mainAdb | Format-Table Id, ProcessName, CPU, WorkingSet64, Responding

Write-Host "=== 3. XEM THONG TIN APP DIEU KHIEN (NODE / ELECTRON / PYTHON) ==="
$procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe', 'python.exe', 'Electron.exe', 'reqx.exe', 'postman-clone.exe') }
foreach ($p in $procs) {
    Write-Host ("PID: " + $p.ProcessId + " | Name: " + $p.Name)
    Write-Host ("  CommandLine: " + $p.CommandLine)
    Write-Host ""
}

Write-Host "=== 4. KIEM TRA ADB DEVICES (DANH SACH VA TRANG THAI CAC THIET BI) ==="
$adbPath = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $adbPath) {
    # Tim adb tu tien trinh dang chay
    $sampleAdb = Get-CimInstance Win32_Process -Filter "Name = 'adb.exe'" | Select-Object -First 1
    if ($sampleAdb) {
        $adbPath = $sampleAdb.ExecutablePath
    }
}
Write-Host ("Duong dan ADB: " + $adbPath)
if ($adbPath -and (Test-Path $adbPath)) {
    try {
        $adbDevices = & $adbPath devices
        Write-Host "Ket qua 'adb devices':"
        $adbDevices | Out-String | Write-Host
    } catch {
        Write-Host ("Loi khi chay adb devices: " + $_)
    }
} else {
    Write-Host "Khong tim thay executable cua ADB."
}
