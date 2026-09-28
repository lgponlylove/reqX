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

- Mỗi nấc = provider + model + key (+ Account ID nếu Cloudflare), có công tắc bật/tắt, nút ↑↓ xếp thứ tự.
- Mỗi lượt chat bắt đầu ở nấc khác nhau (xoay vòng chia tải, theo `aiRrIndex`).
- Nấc nào lỗi/quota/timeout → tự thử nấc tiếp theo trong cùng lượt, có dòng báo ⚠.
- Gặp 429 vì gọi dồn → đợi lùi rồi thử lại đúng nấc đó 1 lần/lượt trước khi bỏ qua.
- Key Gemini cũ (`aiKey`/`aiKeyBackup`) tự seed sang chain lần đầu mở tab, không mất cấu hình.

## 4. Nút ↻ lấy danh sách model

- Dán key vào nấc nào → bấm ↻ ở nấc đó → gọi API `/models` của đúng hãng đó.
- Ô Model thành dropdown chọn; muốn gõ tay thì chọn `✎ Tự gõ model khác…`.
- Key sai báo rõ trong chat; Cloudflare không có API này nên dùng gợi ý sẵn.

## 5. Lưu trữ & lệnh chạy

- Chain + lịch sử chat (100 dòng) + ngữ cảnh gửi kèm (30 lượt) persist trong store `app`
  (`aiChain`, `aiRrIndex`, `aiChat`, `aiContents`). Key lưu local, chỉ gửi tới API khi chat.
- Test: `npm test` (hiện 23 test). Build: `npm run build` rồi build `.exe` như CAI-DAT-RUST
  (nhớ PATH MinGW trong shell mới).
