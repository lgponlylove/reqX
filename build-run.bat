@echo off
REM Tu build frontend + Tauri .exe roi chay app (nhay dup file nay la xong)
setlocal
set "PATH=%USERPROFILE%\.cargo\bin;%USERPROFILE%\mingw64\mingw64\bin;%PATH%"
cd /d D:\AI\postman-clone

echo [0/2] Tat app cu (neu dang chay, tranh khoa file)...
powershell -NoProfile -Command "Stop-Process -Name 'reqx' -Force -ErrorAction SilentlyContinue"

echo [1/2] Build frontend + Tauri...
call "C:\Program Files\nodejs\npm.cmd" exec tauri build -- --no-bundle --target x86_64-pc-windows-gnu
if errorlevel 1 (
  echo.
  echo BUILD THAT BAI - xem loi o tren.
  pause
  exit /b 1
)

echo.
echo [2/3] Tu dong tao ReqX-Portable.zip (de gui cho nguoi khac)...
"C:\Users\Phat\AppData\Local\Python\bin\python.exe" -c "import zipfile; from pathlib import Path; r = Path(r'src-tauri/target/x86_64-pc-windows-gnu/release'); zpath = Path('ReqX-Portable.zip'); z = zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED); [z.write(r/f, f) for f in ['reqx.exe', 'WebView2Loader.dll'] if (r/f).exists()];"
echo -> File chia se: D:\AI\postman-clone\ReqX-Portable.zip

echo.
echo [3/3] Chay app...
start "" "D:\AI\postman-clone\src-tauri\target\x86_64-pc-windows-gnu\release\reqx.exe"
echo XONG - cua so "ReqX" se mo.
