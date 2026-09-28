# Postman Clone — API Client

Bản MVP web (Tauri-ready): gửi HTTP, collections, environments `{{var}}`, history, import/export Postman Collection v2.1.

## Chạy

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" run dev
```

Mở http://localhost:1420 — thử `GET {{baseUrl}}/users` (môi trường Dev có sẵn).

> Lưu ý PowerShell của bạn chặn file `npm.ps1`, nên phải gọi `npm.cmd` như trên.

## Lên Tauri (cần Rust)

Xem `docs/CAI-DAT-RUST.md`. Sau khi có `cargo`:

```powershell
& "C:\Program Files\nodejs\npm.cmd" install @tauri-apps/cli --save-dev
& "C:\Program Files\nodejs\npx.cmd" tauri init
& "C:\Program Files\nodejs\npx.cmd" tauri dev
```

## Cấu trúc

- `src/types/api.ts` — mô hình Request/Response/Collection/Environment
- `src/lib/http-client.ts` — gửi HTTP (fetch, bản Tauri sẽ thay bằng Rust)
- `src/lib/variables.ts` — thay `{{var}}`
- `src/lib/postman-io.ts` — import/export Postman v2.1
- `src/stores/` — Zustand state
- `src/components/` — Sidebar, RequestBar, ResponseViewer
- `docs/KE-HOACH.md` — kế hoạch chi tiết
