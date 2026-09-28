# Rust + build Tauri (Windows) — ĐÃ BUILD THÀNH CÔNG ✅

File chạy: `src-tauri\target\x86_64-pc-windows-gnu\release\postman-clone.exe`
(~20MB, đã smoke test: cửa sổ "Postman Clone" mở, WebView2 render OK).

## Đã cài gì (ngày 2026-09-18)

- **Rust 1.98.1** qua winget: `winget install --id Rustlang.Rustup -e --silent`
  rồi `rustup toolchain install stable --profile minimal` (`%USERPROFILE%\.cargo\bin`).
- **Windows SDK 10.0.26100** qua winget (`Microsoft.WindowsSDK.10.0.26100`).
- **MinGW-w64 (WinLibs, gcc 16.2, UCRT)** giải nén tay vào `%USERPROFILE%\mingw64`
  (không cần admin) — để lấy `dlltool.exe`/`ld.exe` cho toolchain GNU.
- Icons: vẽ `src-tauri/icon-src.png` (512px, code .NET) → `npm exec tauri icon ...`.

## Vì sao dùng toolchain GNU (quan trọng)

Máy có VS 2026 Community nhưng workload C++ thiếu **CRT libs/headers**
(`lib\x64\msvcrt.lib` không tồn tại) → link MSVC lỗi `LNK1104`. Cài thêm
workload cần **quyền admin** (UAC) nên chưa làm được. Giải pháp: build bằng
`stable-x86_64-pc-windows-gnu` + MinGW — Tauri v2 build OK (1 warning benign
về manifest `.rsrc merge`, bỏ qua được).

Đã ghim cho thư mục này: `rustup override set stable-x86_64-pc-windows-gnu`
(trong `src-tauri`). Muốn về MSVC sau khi đủ workload: `rustup override unset`.

## Build lại

Mỗi terminal mới phải nạp PATH (đóng/mở terminal mất PATH đã thêm):

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:USERPROFILE\mingw64\mingw64\bin;" + $env:PATH
cd D:\AI\postman-clone
& "C:\Program Files\nodejs\npm.cmd" exec tauri build -- --no-bundle --target x86_64-pc-windows-gnu
```

`--no-bundle` = chỉ lấy `.exe`, bỏ qua WiX/NSIS (chưa cài). Muốn bộ cài đặt:
cài WiX Toolset + NSIS rồi chạy `tauri build` đầy đủ (target mặc định MSVC
sau khi có admin cài workload C++).

## Muốn dùng MSVC chuẩn (cần admin, làm 1 lần)

Mở terminal **admin** (chuột phải → Run as administrator), Chạy
trong cmd hoặc PowerShell:

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vs_installer.exe" modify --installPath "C:\Program Files\Microsoft Visual Studio\18\Community" --add Microsoft.VisualStudio.Workload.NativeDesktop --passive --norestart
```

Xong thì trong `src-tauri`: `rustup override unset`, mở "Developer Command
Prompt" của VS rồi `npm exec tauri build` (không cần `--target`).

## Scaffold (đã xong từ trước)

- `src-tauri/tauri.conf.json` — app `Postman Clone`, devUrl `http://localhost:1420`, dist `../dist`
- `Cargo.toml` + `src/main.rs` + `build.rs` (Tauri v2), `capabilities/default.json`
- `@tauri-apps/cli@2` (`npx tauri --version` → 2.11.4)
- Scripts: `npm run tauri:dev` / `npm run tauri:build` (chưa gắn target GNU — dùng lệnh ở trên)
