# Chạy lịch (Scheduler) + Cron hệ thống

Có 2 cách chạy collection tự động:

## Cách 1 — Trong tab (đơn giản)

Mở app → view **▶ Runner** → kéo xuống **⏰ Chạy theo lịch** → Thêm lịch
(collection + phạm vi + mỗi N phút). Engine tick mỗi 15s, tự chạy khi tới giờ,
lưu 20 lần gần nhất. **Điều kiện: tab/app còn mở.**

## Cách 2 — Cron hệ thống (chạy cả khi tắt tab)

Nguyên lý: cron của hệ điều hành mở Chrome headless vào URL once-mode của app,
app tự chạy 1 lịch rồi tự đóng. Sever cron tham khảo thêm tại đây.

### Bước 1 — Dựng server 24/7

Trên máy luôn bật (PC ở nhà, NAS, VPS Windows/Linux):

```bash
cd D:\AI\postman-clone
npm run build
npm run preview -- --port 1420 --host
```

Giữ cửa sổ này chạy (hoặc chạy như service). Kiểm tra: mở
`http://<ip-may-chu>:1420/` trên máy khác thấy app là được.

> Lịch + lịch sử lưu trong **localStorage của Chrome profile** trên máy server
> (xem `--user-data-dir` ở bước 2). Tạo/sửa lịch bằng cách mở URL server trên
> trình duyệt thường **của chính máy server** 1 lần.

### Bước 2 — Lấy lệnh cron trong app

Vào **▶ Runner → ⏰ Chạy theo lịch**, mỗi lịch có mục **🖥 Lệnh cron hệ thống**:
sửa base URL thành `http://<ip-may-chu>:1420`, bấm **Mở thử** để kiểm tra
once-mode chạy OK, rồi **Copy** lệnh tương ứng.

- **Windows** (mở cmd **admin** rồi dán):
  `schtasks /create /tn "PostmanClone-<id>" /tr "<chrome> --headless=new --user-data-dir=... --virtual-time-budget=180000 "<url>"" /sc minute /mo N /f`
- **Linux**: thêm dòng crontab (`crontab -e`):
  `*/N * * * * google-chrome --headless=new --user-data-dir=... --virtual-time-budget=180000 "<url>"`

Xóa task: `schtasks /delete /tn "PostmanClone-<id>" /f`.

### Bước 3 — Kiểm tra

Đợi 1 chu kỳ → mở app → xem **Lịch sử N lần** trong lịch. Log lỗi cron:
Windows xem `Task Scheduler → Task Scheduler Library → <tên task> → History`.

## Once-mode (`?once=`)

- `GET /?once=<scheduleId>` — chạy 1 lịch, hiện màn hình kết quả.
- `&close=1` — tự `window.close()` sau 3s (cho cron).
- ID sai → báo `Không tìm thấy lịch` (thường do khác Chrome profile:
  cron phải dùng đúng `--user-data-dir` đã tạo lịch).

## Giới hạn & lưu ý

- Headless Chrome không hiện Notification (xem kết quả trong Lịch sử).
- Secrets (🔒) chỉ nằm trong RAM → cron headless dùng profile cố định nên
  RAM/profile được giữ giữa các lần chạy, nhưng nếu xóa profile phải nhập lại.
- `pm.environment.set` trong script vẫn ghi vào environment như chạy tay.
- Muốn alert Telegram/Discord khi lỗi: thêm request gọi webhook vào cuối
  collection, điều kiện bằng tests (ví dụ request health-check lỗi → request
  tiếp theo bắn webhook).
