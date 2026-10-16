# Kế hoạch — mở rộng Key test + Tài liệu API tự sinh

Trạng thái: **P2 (Tài liệu API, Q5 = a, Q4 = d: Markdown + HTML) đã code + test xong 15/10/2026**. P0/P1 vẫn **chờ anh chốt Q1→Q3**, chưa code. Ngày 15/10/2026.

---

## 1. HIỆN TRẠNG (đo từ code, không đoán)

| thứ anh hỏi | đã có chưa | nằm ở đâu |
|---|---|---|
| Nhóm auth: không token / sai token | **một phần** — 2 case, **chỉ khi `auth.type === 'bearer'`** | `src/lib/test-cases.ts:242-245` |
| Nhóm auth: hết hạn / token user khác (IDOR) | **chưa** — không có nguồn token thứ hai nào | — |
| API key / Basic / cookie sai | **chưa** — `collectTargets` loại hẳn header auth nên không đụng tới | `test-cases.ts:133` |
| Injection | **một phần** — 1 chuỗi gộp `' OR 1=1-- <script>alert(1)</script>` gắn cho mọi field string + query | `test-cases.ts:143, 212, 228` |
| Path traversal | **chưa** | — |
| Số âm / quá lớn | **một phần** — đã có `-1`, `0`, `99999999999999`, `999999999` cho field id | `test-cases.ts:215-221` |
| Mass assignment | **chưa** — không có case nào chèn field lạ vào body | — |
| Sinh case từ OpenAPI/Schema | **chưa** — bộ sinh chỉ đọc **body mẫu** (`collectTargets` parse `req.body`) | `test-cases.ts:108-137` |
| Schema cất ở đâu | **không có chỗ nào** — import OpenAPI xong là **vứt spec** (`importOpenApiSpec` trả về request, không lưu spec), `src/types/api.ts` không có field `schema` | `openapi-import.ts:268` |
| Tài liệu API tự sinh | **đã có** — `src/lib/api-docs.ts` (Markdown) + `src/lib/docs-html.ts` (HTML một file), nhãn theo ngôn ngữ đang chọn | `api-docs.ts`, `docs-html.ts`, `docs-input.ts` |
| Nút ở Send | menu ▼ có **🧪 Key test, 🎭 Mock rule, 📄 Tài liệu Markdown, 🌐 Tài liệu HTML, ⏱ Timeout**; folder/collection xuất ở chuột phải Sidebar | `RequestBar.tsx`, `Sidebar.tsx` `docsItems()` |
| Mong đợi (expect) | chỉ `status` (2xx/4xx/any/200/!=200) + `contains` | `test-cases.ts:24-29` |

Bộ hiện tại sinh tối đa 40 case (xoay vòng theo field để không nuốt hết ở field đầu), 8 nhóm `valid/missing/null/type/boundary/text/security/enum`.

---

## 2. ĐÃ CHỐT (em làm, không hỏi)

1. **Tách payload bảo mật thành từng case riêng** (SQL / XSS / path traversal / CRLF / NoSQL / command), mỗi loại một dòng trong bảng để thấy ngay loại nào lọt. SQL thêm bản không dấu nháy (`1 OR 1=1`, `sleep(3)`), XSS thêm `"><img src=x onerror=alert(1)>`, path traversal thêm `../../../../etc/passwd` và `%2e%2e%2f` encode.
2. **Nhóm auth phủ đủ 4 kiểu**: `bearer` (header), `apikey` (header + query), `basic`, `cookie`. Mỗi kiểu sinh: *không gửi token* → 401, *token sai* → 401/403, *token rỗng/chuỗi ngắn* → 401.
3. **Mass assignment**: chèn field quyền hạn (`role`, `isAdmin`, `is_admin`, `verified`, `ownerId`, `balance`, `id`) vào body — và **kiểm tra server có echo lại field đó không** (thêm `notContains` vào `TestCaseExpect`, mở rộng `judge()`). Đây là cách duy nhất bắt được "server bỏ qua field" khác "server nhận field".
4. **Số cực đoan mở rộng**: `-1`, `-0.0001`, `9007199254740993` (ngoài safe integer), `1e309` (→ Infinity), `NaN`, số tràn int32 cho field id, tổng tiền 2 số lẻ âm. Giữ nguyên cap + xoay vòng.
5. **Không thêm dependency**, hàm sinh case vẫn là hàm thuần (test được không cần mạng), export vẫn CSV **có BOM**, tài liệu xuất vẫn qua `saveExportBesideApp`, **secret bị che** (`maskCurl`/`maskSensitiveBody`) — token thật không bao giờ vào file tài liệu.
6. everything mới vẫn vào cùng bộ case hiện có (không tạo panel thứ hai), `enabled: false` + `note` cho case cần input mà chưa có.

---

## 3. CẦN ANH CHỌN

**Q1 — Token "hết hạn" và token "user khác" lấy từ đâu?** (IDOR bắt buộc phải có credential của *người thứ hai*, không tự bịa được)
- (a) **Đặt tên theo quy ước**: nếu collection có `{{tokenKhac}}` / `{{tokenHetHan}}` (hoặc `{{otherToken}}`/`{{expiredToken}}`) thì tự sinh case IDOR + expired; không có biến thìcase hiện nhưng **tắt** + note "thêm biến … để bật". [**đề xuất** — hợp sách lược RAM-only: token để trong env biến, không nhập tay vào dialog]
- (b) Thêm 2 ô nhập trong dialog Key test (token user khác / token hết hạn) — tiện nhưng **nhập tay là secret nằm trong RAM dialog**, không ghi đĩa.
- (c) Bỏ 2 case này, chỉ giữ "không token / sai token".

**Q2 — Payload injection áp cho field nào?** (tách 6 payload × mọi field string sẽ ăn hết 40 slot)
- (a) Áp cho **field nghi vấn trước** (tên chứa `search|q|name|slug|path|file|url|content|comment|filter|sort|id`), field khác lấy 1 payload đại diện [**đề xuất**]
- (b) Áp cho **mọi** field string, tăng cap mặc định 40 → 80
- (c) Thêm checkbox "Payload đầy đủ" trong dialog, mặc định tắt

**Q3 — Schema để sinh case cất ở đâu?** (hiện không có chỗ cất, import OpenAPI xong là mất spec)
- (a) **Field mới `ApiRequest.schema?: string`** (JSON Schema hoặc OpenAPI component) + 1 bảng con "Schema" cạnh Params/Body; bộ sinh đọc `required[]`, `enum`, `minLength/maxLength`, `minimum/maximum`, `pattern`, `format`, nullable → sinh case **theo ràng buộc thật** thay vì đoán tên field. [**đề xuất** — tái dùng `dereferenceSchema`/`sampleFromSchema` có sẵn, và cùng schema này nuôi luôn Contract Test đang phải đọc schema nhúng trong script (`contract-test.ts:63`)]
- (b) Không cất schema: mỗi lần mở Key test thì chọn file OpenAPI/paste → chỉ dùng trong RAM phiên
- (c) Khi import OpenAPI thì **giữ lại spec** vào collection (nặng đĩa, nhưng sinh tài liệu + case cho cả collection được)

**Q4 — "Tài liệu API tự sinh" xuất ra dạng gì, phạm vi nào?** — **đã chốt (d): cả Markdown + HTML, 15/10/2026**. Phạm vi: **nút ▼ Send = đúng 1 request đang mở**, **cả thư mục/collection = chuột phải ở Sidebar** (không còn "collection đang mở" ở nút Send).
- (a) **Markdown 1 file cho collection đang mở**: bảng endpoint (method/URL/đầu vào/bắt buộc), bảng params+headers, bảng body field (kiểu/theory ràng buộc/ví dụ), 1 ví dụ curl **đã che token** cho mỗi request, mô tả & biến `{{…}}` liên quan. [**đề xuất** — vào được wiki/README/Git, không thêm thư viện]
- (b) **HTML standalone** (giống báo cáo Runner, tự mở không cần Markdown viewer)
- (c) **OpenAPI YAML** (để Postman/Swagger đọc được — khó, ReqX không giữ đủ thông tin route/schema nếu Q3 chọn (b))
- (d) (a) + (b): xuất cả `.md` và `.html`
- Phạm vi: (1) request đang mở · (2) **collection đang mở** [đề xuất] · (3) mọi collection

**Q5 — Nút thứ hai ở Send là gì, đặt ở đâu?** — **anh chốt (a) ngày 15/10/2026, đã code.**
- (a) Thêm mục **"📄 Tài liệu API"** vào menu ▼ Send (nơi Key test/Mock/Timeout đang nằm) → bấm là xuất file + toast "đã lưu cạnh app". [**đề xuất** — hàng URL đang trống, không phải thêm nút vuông]
- (b) Thêm **cả 2 mục**: 📄 Tài liệu API + ♻️ "Chạy lại 5 lần / đo thời gian" (smoke monitor kiểu mới)
- (c) Nút rời ngoài menu ▼ (chiếm chỗ ô URL — em không khuyên)

---

## 4. CÁC BƯỚC (nghiệm thu từng pha: `tsc` 0 lỗi + `vitest` xanh)

### P0 — Key test nhóm mới (chỉ `test-cases.ts` + dialog)
- [ ] `security` tách payload + path traversal/CRLF/NoSQL; chọn payload theo tên field (Q2)
- [ ] `CaseGroup` thêm `'auth'` + `'idor'` (nhãn Việt: "Xác thực", "Phân quyền") và `GROUP_LABEL`; `reporter.ts`/CSV tự nhận vì đọc qua `GROUP_LABEL`
- [ ] 4 kiểu auth × (không token / sai / rỗng) + expired/IDOR theo Q1
- [ ] `notContains` vào `TestCaseExpect` + `describeExpect` + `judge()`; case mass assignment dùng nó
- [ ] Test hồi quy: fixture request bearer + body có `search`/`amount`/`userId` → đếm case theo nhóm, asserts `applyCase` bỏ đúng header, chèn đúng field quyền, `judge` fail khi body echo `isAdmin`

### P1 — Sinh case theo schema (Q3)
- [ ] `ApiRequest.schema?: string` + bảng con "Schema" (editor JSON, nút "Nạp từ file OpenAPI/JSON Schema", "Sinh body mẫu từ schema" qua `sampleFromSchema`)
- [ ] `collectTargetsFromSchema(schema)` → targets kèm `required/enum/min/max/pattern/format` → bộ sinh ưu tiên ràng buộc thật, **fallback body mẫu** khi không có schema
- [ ] Enum: sinh case cho **mọi giá trị enum** + 1 giá trị ngoài enum (`expect 4xx`), thay cho đoán `action=0..3` hiện tại
- [ ] Test: schema thật (nhiều `$ref`, `oneOf`, nullable, format date) → số case & tên case ổn định

### P2 — Tài liệu API + nút Send (Q4, Q5) — **XONG 15/10/2026** (Q5 = a, Q4 tạm dùng đề xuất (a))
- [x] `src/lib/api-docs.ts` (hàm thuần): `renderCollectionDocs(collection, requests, env)` + `renderRequestDocs` — markdown có mục lục, bảng endpoint (kể cả folder lồng nhau), bảng biến `{{…}}` kèm cột "chưa đặt", params/headers/body field, ví dụ curl **đã che token/mật khẩu**, **không ghi giá trị secret**
- [x] Nút menu ▼ "📄 Tài liệu API" + xuất qua `saveExportBesideApp` + `revealExportedFile` (fallback Downloads khi chạy trên web)
- [x] Test: `src/lib/__tests__/api-docs.test.ts` (8 case) — bearer + body JSON + query có `token=` → file không chứa token thật; form-data/raw vẫn có fence; request rỗng không crash; tên file slug không dấu
- [x] `CHANGELOG.md` + sửa luôn 2 chỗ rỉ secret tìm thấy khi test: `maskCurl` giờ che cả `?token=…` trong URL và giá trị nhạy cảm trong `--data*`/`--form` (ảnh hưởng CSV báo cáo Key test + report HTML)
- [ ] `docs/HD-KeyTest.md` — chưa viết (chờ P0/P1 xong để gộp 1 tài liệu)
- [x] **15/10/2026 (đợt sau)**: render lại **đúng mẫu anh đưa** — mục lục theo folder, mỗi folder một mục `##`, mỗi request có URL / Headers (`Key|Value|Bắt buộc`) / Body (fence + `Field|Kiểu|Bắt buộc|Mô tả`) / **Response 200 + 401 lấy từ lịch sử gửi** / **Biến được trích ra (Flow)** / cURL / **bảng Kết quả Key test** / bảng "Phần nào ReqX lấy từ đâu". Toàn bộ nhãn theo **ngôn ngữ đang chọn** (`LABELS` vi+en trong `api-docs.ts`, `lang` lấy qua `src/lib/docs-input.ts`). Test: **18 case**.
- [x] **15/10/2026 (Q4 → (d))**: thêm **HTML một file** — `src/lib/docs-html.ts` `renderDocsHtml(md, {lang})` đóng gói đúng file Markdown vừa sinh (không thêm thư viện): sidebar mục lục có ô lọc, badge method màu, nút Copy cho khối code, nút In/Lưu PDF, `@media print` nền sáng, escape mọi nội dung (tên request nhét `<script>` chỉ hiện chữ), bỏ list mục lục trùng. Đường xuất: ▼ Send có **📄 Markdown + 🌐 HTML**, chuột phải Sidebar (folder/collection) cùng cặp; `saveDocExport(filename, text, kind)`. Test: `docs-html.test.ts` **8 case**; gates **26 file / 281 test**.
- [ ] **OpenAPI JSON** (gợi ý (c) trong mẫu) — chưa làm, chờ anh nói có cần không.

### Treo lại (ghi để không quên)
- Contract Test đọc schema từ field mới thay vì script nhúng — làm sau khi Q3 = (a) ổn định.
- Sinh case cho form-data / GraphQL / gRPC (bộ sinh hiện chỉ hiểu JSON body + query + header).
- "Chạy lại N lần đo thời gian" (Q5b) nếu anh không chọn.

---

## 5. Rủi ro

1. **IDOR/expired là case "một chiều"**: nếu API trả 200 cho token user khác thì đó là lỗi thật, nhưng nếu **môi trường test không có user thứ hai** thì nó fail oan → em sẽ tắt sẵn + note, anh bật khi có data.
2. Tách payload làm **số case nhảy ~2×** → chạm cap 40 nhanh hơn (Q2 giải quyết).
3. `notContains` mới phải đi qua **bảng UI + CSV + HTML report + CLI**, nếu thiếu 1 chỗ là im lặng sai. Em sẽ soát cả 4 đường (`TestCaseDialog.tsx`, `casesToCsv`, `reporter.ts`, `AiAssistant.tsx`).
4. Bảng con "Schema" làm hàng tab Params/Body/Auth… dài thêm 1 mục — đã dồn vào menu Send rồi nên chưa xấu, nhưng cần anh duyệt trước.
5. Chữ ký hàm sinh case đổi (`generateCases(req)` → thêm nguồn schema): mọi chỗ gọi (`RequestBar.tsx:8`, `AiAssistant.tsx:21`, `TestCaseDialog.tsx`) phải sửa cùng lúc.
