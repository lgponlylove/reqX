# Project Context — ReqX

## 1. Tổng quan & Mục tiêu
- **Mục tiêu:** App test API kiểu Postman (desktop Windows): Builder, Runner collection, Flow chain nối request, Scheduler chạy lịch, WS/gRPC tester, tab trợ lý AI.
- **Trạng thái hiện tại:** Tính năng chính đã chạy ổn định, exe build ra dùng hàng ngày. Mới xong module AI multi-provider + layout sidebar gọn. Tab mới thường làm tiếp: vá lỗi, thêm provider AI, gọn UI.

## 2. Tech Stack & Thư viện chính
- **Frontend:** Vite + React 18 + TypeScript + TailwindCSS + Zustand (persist localStorage).
- **Desktop:** Tauri v2 (Rust: `src-tauri/src/main.rs`), target `x86_64-pc-windows-gnu`, exe tại `src-tauri/target/x86_64-pc-windows-gnu/release/reqx.exe`.
- **AI:** Module dùng chung `src/lib/ai/` (copy sang project khác được): `ai-providers.ts` (chain 5 hãng), `gemini.ts`, `openai-chat.ts`. Test bằng Vitest (`npm test`).
- **Toolchain:** Node 24, npm gọi qua `& "C:\Program Files\nodejs\npm.cmd"` (PS chặn npm.ps1). Rust GNU + MinGW ở `%USERPROFILE%\mingw64` — shell mới phải thêm PATH MinGW trước khi build exe.

## 3. Cấu trúc thư mục & Quy ước quan trọng
- `src/components/`: UI theo tab (Sidebar, RequestBar, ResponseViewer, Flow, AiAssistant...).
- `src/stores/`: `app.ts` (collections/requests/env/history/AI chain), `request.ts` (tabs), `flow.ts`, `schedule.ts`. Thêm field vào store → bump version + migrate.
- `src/lib/`: logic thuần (flow/runner/http-client/scripts/postman-io/backup/secrets/codegen...). Ưu tiên hàm thuần để test được.
- **Quy tắc bất khả xâm phạm:**
  - Tauri identifier `com.postmanclone.app` và mọi key storage/persist KHÔNG được đổi (đổi là user mất dữ liệu).
  - Secrets (token/password/biến 🔒) chỉ giữ RAM, không persist, không paste lên chat.
  - Build exe: `Stop-Process reqx` trước (không thì lỗi os error 5); smoke 1 process, đợi ~12–15s check title ReqX.
  - Sửa UI xong phải build cả web + exe (`tauri build -- --no-bundle --target x86_64-pc-windows-gnu`).

## 4. Nhiệm vụ của phiên làm việc hiện tại
- (Cập nhật mỗi tab mới — vd: "Thêm provider X vào AI chain" / "Sửa lỗi kéo-thả sidebar".)
- Không tự ý đổi identifier, key storage, target build hay thư viện lớn trừ khi được yêu cầu.
