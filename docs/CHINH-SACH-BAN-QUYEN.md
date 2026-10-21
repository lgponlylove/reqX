# Chính sách bản quyền ReqX

## 1. Dùng thử 60 ngày — full tính năng, không cần key

- Lần chạy đầu tiên, app tự ghi mốc `reqx_trial_start` và đếm 60 ngày.
- Trong thời gian trial, mọi tính năng (AI, Key test, CLI, Scheduler...) dùng đầy đủ như bản Pro.
- Gần hết trial (còn ≤ 14 ngày) app hiện banner nhắc; hết 60 ngày hiện banner amber.
- Hết trial app **vẫn chạy full tính năng** — banner chỉ nhắc nhập key Pro để ủng hộ tác giả.

## 2. Một key = một máy (node-locked)

- Key Pro khóa theo **mã máy** (`machine_id`, xem trong modal Bản quyền → Sao chép mã máy).
- Đổi máy, cài lại Windows, hoặc xóa thư mục cấu hình `~/.reqx` làm đổi mã máy
  → key cũ báo "không hợp lệ trên thiết bị hiện tại".
- Cấp lại key miễn phí **tối đa 1 lần/năm** cho trường hợp đổi máy chính đáng.
- Key bị phát hiện dùng chung nhiều máy sẽ bị khóa (từ chối kích hoạt key mới cho email đó).

## 3. Lên version mới có cần kích hoạt lại không?

- **Không**, nếu cùng máy + cùng user Windows. Key không gắn version app.
- Bản portable: giải nén đè đúng folder cũ thì file `reqx.lic` còn nguyên.
  Giải nén ra folder mới → chép `reqx.lic` sang folder mới, hoặc nhập lại key cũ
  (cùng máy thì vẫn hợp lệ, không tốn lượt).
- Bản cài Program Files: `reqx.lic` nằm ở `~/.reqx/`, update không mất.

## 4. Cơ chế kiểm tra cập nhật

- App đọc `latest.json` trên GitHub (`raw.githubusercontent.com/lgponlylove/reqX/main/latest.json`)
  tối đa 1 lần/ngày, timeout 8s, lỗi mạng/offline thì im lặng bỏ qua.
- Có bản mới → banner xanh dưới header: bấm **Tải về** mở trang Releases,
  tải zip về chép đè folder cũ (giữ lại `reqx.lic`). Bấm **Để sau** thì không nhắc lại version đó.
- Quy trình release cho tác giả:
  1. Đổi `version` trong `package.json` + `src-tauri/tauri.conf.json` + `src-tauri/Cargo.toml` + `APP_VERSION` (`src/lib/update-check.ts`).
  2. Build portable zip, đăng GitHub Releases.
  3. Sửa `latest.json` ở branch main: `{"latest": "<version>", "url": "<link trang tag>", "notes": "<điểm mới ngắn gọn>", "assets": {...}}`.
     `url` trỏ trang tag của version đó (đủ file mọi OS, phòng khi dò OS sai).
     `assets` liệt kê đúng tên file workflow vừa build (Windows: `ReqX_<ver>_x64-setup.exe` + `ReqX_<ver>_x64_en-US.msi`;
     mac: `ReqX_<ver>_aarch64.dmg` + `ReqX_<ver>_x64.dmg`; Linux: `reqx_<ver>_amd64.AppImage` + `reqx_<ver>_amd64.deb`).
     Sau khi build xong, mở thử link `.../releases/download/v<ver>/<tên file>` để chắc không 404 rồi mới push `latest.json`.
