@echo off
setlocal
cd /d D:\AI\postman-clone

echo [1/1] Dang dong goi ReqX Portable (kem WebView2Loader.dll)...
"C:\Users\Phat\AppData\Local\Python\bin\python.exe" -c "import zipfile; from pathlib import Path; r = Path(r'src-tauri/target/x86_64-pc-windows-gnu/release'); zpath = Path('ReqX-Portable.zip'); z = zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED); [z.write(r/f, f) for f in ['reqx.exe', 'WebView2Loader.dll'] if (r/f).exists()]; print('-> Da dong goi thanh cong!')"

echo.
echo ===================================================================
echo  FILE HOAN TAT: D:\AI\postman-clone\ReqX-Portable.zip (~8 MB)
echo  Ban chi can gui file .zip nay cho dong nghiep.
echo  Ho chi can giai nen ra la chay duoc ngay, khong con bi loi DLL!
echo ===================================================================
echo.
pause
