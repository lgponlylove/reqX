# HD-AI — Trợ lý AI (tab ✨ AI)

Trợ lý chat tiếng Việt, gọi được tools trong app: liệt kê collection/request/flow,
mở request, gửi request, chạy flow, đọc body từng step, đổi env/biến, tạo request,
nhập collection/flow từ JSON dán vào chat.

## 1. Module dùng chung `src/lib/ai/`

Copy nguyên thư mục này sang project khác được (không import gì từ app):

| File | Nội dung |
|------|----------|
| `ai-providers.ts` | Định nghĩa 5 provider + chain xoay vòng/failover (`pickOrder`) |
| `gemini.ts` | Client Gemini, `sanitizeContents`, `isQuotaError` / `isRetryableError` |
| `openai-chat.ts` | Client OpenAI-compatible, convert tools/history, `fetchProviderModels` |
| `__tests__/` | Test vitest cho chain + convert + lấy models |

## 2. Providers có sẵn

| Provider | Kiểu gọi | Ghi chú |
|----------|----------|---------|
| Google Gemini | riêng (`/v1beta`) | Free rộng, nên để đầu chain |
| Groq | OpenAI-compatible | Nhanh; `max_tokens` bị trần 16384 (tự giới hạn); gói free 8000 TPM chỉ hợp chat lẻ |
| Mistral (La Plateforme) | OpenAI-compatible | Dùng model chat (devstral/mistral-small...); model realtime/embed/ocr bị lọc khỏi danh sách |
| OpenRouter | OpenAI-compatible | Một key gọi nhiều model; thêm header Referer/Title tự động |
| Cloudflare Workers AI | OpenAI-compatible | Cần thêm **Account ID**; không có API liệt kê model |

## 3. Chain: vừa xoay vòng vừa backup

- Mỗi nấc = provider + model + key (+ Account ID nếu Cloudflare), có công tắc bật/tắt, nút ↑↓ xếp thứ tự, chọn bậc 🆓/💰.
- Chiến lược gọi: `Tiết kiệm` (free trước, tràn mới sang paid) hoặc `Ổn định` (paid trước).
- **Admission từng nấc:** mỗi nấc đếm RPM riêng (ô RPM để trống = tự học + mặc định bậc:
  free 10/phút, paid 1000/phút; biết số trong console hãng thì nhập vào). Hệ thống tự học trần thật:
  đọc header `x-ratelimit-*` khi hãng trả về, nếu không thì AIMD (OK tăng dần, 429 giảm nửa).
  Gần chạm trần thì khóa tạm để lượt sau nhảy xuống nấc kế (báo 🔒) — né 429 trước khi dính.
- **Breaker từng nấc:** sập quota/rate limit thì khóa 60s; thành công thì mở lại ngay.
  Nấc free lỗi bỏ qua nhanh, chỉ nấc paid 429 mới đợi lùi thử lại 1 lần/lượt.
- Cuối panel đếm tokens đã dùng theo nấc (để ước tính chi phí paid) + nút reset.

## 4. Nút ↻ lấy danh sách model

- Dán key vào nấc nào → bấm ↻ ở nấc đó → gọi API `/models` của đúng hãng đó.
- Ô Model thành dropdown chọn; muốn gõ tay thì chọn `✎ Tự gõ model khác…`.
- Key sai báo rõ trong chat; Cloudflare không có API này nên dùng gợi ý sẵn.

## 5. Lưu trữ & lệnh chạy

- Chain + lịch sử chat (100 dòng) + ngữ cảnh gửi kèm (30 lượt) persist trong store `app`
  (`aiChain`, `aiRrIndex`, `aiChat`, `aiContents`). Key lưu local, chỉ gửi tới API khi chat.
- Test: `npm test` (hiện 23 test). Build: `npm run build` rồi build `.exe` như CAI-DAT-RUST
  (nhớ PATH MinGW trong shell mới).
