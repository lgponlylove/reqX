# Kế hoạch — ReqX CLI Runner (`reqx run`)

> Trạng thái: **CHỜ DUYỆT**. Chưa code. Mục 3 là những câu cần anh chốt.
> Ngày lập: 13/10/2026 · Phạm vi: cho QA/QC chạy collection + test case trong CI, không mở UI.

---

## 0. Vấn đề cần giải quyết

Blocker số 1 khiến QA chưa bỏ Postman: **không có đầu chạy headless**, nên không nhét suite vào Jenkins/GitLab/GitHub Actions được (Postman có `newman`). Bằng chứng đã đo:

- `package.json` không có `bin`, không có file entry nào ngoài Vite/React.
- `src/lib/scripts.ts:458` ghi rõ: *"Gọi ở UI tương tác (Flow, Runner) — KHÔNG gọi ở Scheduler headless (confirm treo app)"* → engine script đang giả định có người bấm.
- `src/lib/scheduleEngine.ts:10` monitor chạy bằng `setInterval` trong tiến trình app → đóng app là hết.

---

## 1. Điểm tựa đã đo trong code (không phải lời hứa)

| Thành phần | Trạng thái với Node | Việc phải làm |
|---|---|---|
| `src/lib/runner.ts` | **Sạch UI hoàn toàn** — `runRequestList` / `runCollectionWithData` nhận `hooks: RunnerHooks` (3 hàm: `getVars`/`setEnv`/`setGlobal`, `runner.ts:25`), `opts`, `signal` | Dùng nguyên, chỉ cung cấp hooks bản Node |
| `src/lib/scripts.ts:103` | Chạy script bằng `AsyncFunction` → Node chạy được | Không sửa engine |
| `src/lib/scripts.ts:472` | Cổng duyệt script dùng `confirm()` → **treo ở CLI** | Tách thành gate inject được |
| `src/lib/http-client.ts:137` | `window.location.origin` (base URL tương đối) + `window.setTimeout/clearTimeout` | Thêm guard/inject base URL |
| `src/lib/http-client.ts` (mock) | `await import('../stores/mock')` đã bọc `try/catch` | Không sao, tự tắt |
| `src/lib/cookie-jar.ts` | `localStorage.getItem/removeItem` (dọn kho cũ một lần) | Guard theo `typeof localStorage` |
| `src/lib/bodyStore.ts` | IndexedDB — **không có trong Node** | Bỏ chức năng "xem body lần chạy trước" ở CLI |
| `src/lib/reporter.ts:17` | `generateRunnerHtmlReport()` thuần chuỗi | Tái dùng thẳng |
| `src/lib/postman-io.ts:43 / :228` | `importPostmanCollection()` / `exportAllCollections()` | Format vào/ra đã có sẵn |
| `src/lib/datafile.ts:83` | `parseDataFile()` | Data-driven chạy được |
| `src/lib/mask.ts` | Mask token/JWT khi export | Report CLI thừa hưởng, không rỉ secret |
| Node 24 (đã cài) | Có sẵn `fetch`, `crypto`, `atob/btoa`, `FormData` | Không cần polyfill |
| `node_modules/esbuild@0.21.5` | Đã có (đi kèm Vite) | Bundle CLI **không thêm dependency** |

Kết luận: chi phí thật nằm ở 3 điểm vá (`scripts.ts` gate, `http-client` base URL/timer, `cookie-jar` localStorage) + phần vỏ CLI, không phải viết lại engine chạy request.

---

## 2. ĐÃ CHỐT (em làm đúng như này nếu anh im lặng)

1. **Tên lệnh**: `reqx run <collection.json>`. Exit code: `0` = hết request pass · `1` = có test/request fail · `2` = lỗi hệ thống (file không đọc được, script crash, không resolve được biến).
2. **Không thêm thư viện**: bundle bằng esbuild đã có → ra `dist-cli/reqx.mjs`, chạy `node dist-cli/reqx.mjs`.
3. **Định dạng input**: Postman v2.1 (thứ ReqX `exportAllCollections` sinh ra), nhận thêm file backup ReqX (`parseBackup`).
4. **Biến**: `--env <file>` (lặp lại được, file sau đè file trước) · `--global <file>` · `--var K=V` · fallback đọc `process.env` cho `{{TEN}}` còn thiếu. **Secret inject bằng env biến của CI, không nằm trong file** — giữ đúng sách lược RAM-only của batch P0.
5. **Cổng script**: collection tự soạn (không có `origin:'imported'`) → script chạy mặc định. Collection import từ Postman/OpenAPI → **bắt buộc** `--allow-scripts`; không có cờ thì bỏ qua script và in cảnh báo. Không bỏ qua cổng này.
6. **Report**: `--reporter junit|json|html|csv|none` + `--out <dir>`; mặc định in bảng `[i/n] PASS/FAIL METHOD url 200 43ms 3/3` ra stdout.
7. **CLI không đụng disk ngoài những file anh chỉ định**: không localStorage, không IndexedDB, cookie jar bắt đầu rỗng và sống trong phiên chạy.
8. **Không đổi hành vi UI**: mọi sửa đổi ở `scripts.ts`/`http-client.ts`/`cookie-jar.ts` là thêm guard có test hồi quy; 179 test hiện tại phải giữ nguyên xanh.

---

## 3. CẦN ANH CHỌN

**Q1 — OAuth2 trong CI lấy refresh token từ đâu?**
- (a) Chỉ từ `--var refreshToken=…` / env biến, không file [**đề xuất** — hợp sách lược RAM-only]
- (b) Thêm `--token-file <path>` đọc rồi xoá khỏi RAM khi chạy xong
- (c) CLI bỏ hẳn auth oauth2, chỉ basic/bearer/apikey

**Q2 — Phạm vi P0 có gồm Flow không?**
- (a) Chỉ collection/folder request (`runRequestList`) [**đề xuất**]
- (b) Cả Flow (`src/lib/flow.ts` + `script-chain.ts`) ngay từ đầu — tốn thêm vì flow có điều kiện/lặp riêng

**Q3 — Mock server trong CLI?**
- (a) Không [**đề xuất** cho P0]
- (b) Có: `--mock <rules.json>` dựng `mockServerEngine` tại chỗ, cho test offline hoàn toàn

**Q4 — Chạy song song?**
- (a) Tuần tự, giống Runner UI [**đề xuất**]
- (b) Thêm `--parallel N` — hệ luỵ: mỗi luồng phải có cookie jar + biến riêng, dễ sai, em không khuyên làm sớm

**Q5 — Phát hành lệnh `reqx`**
- (a) Gọi `node dist-cli/reqx.mjs` trong repo [**đề xuất** — không đụng máy anh]
- (b) Thêm `bin` vào `package.json` + `npm link` để có lệnh `reqx` toàn cục
- (c) Build `.exe` sidecar (liên quan chuyện chưa từng build `.exe`)

---

## 4. CÁC BƯỚC THEO PHA (nghiệm thu từng pha: `tsc` 0 lỗi + `vitest` xanh rồi mới đi tiếp)

### P0 — khung chạy được, có exit code ✅ (xong 13/10/2026)
- [x] Guard trực tiếp trong lib (không cần `globals.ts` shim): `http-client.ts` — `setDefaultBaseUrl()`/`resolveBaseUrl()` thay `window.location.origin`, typed timer; `scripts.ts` — `ScriptGate` + `setScriptGate()`; `cookie-jar.ts` đã có guard `typeof localStorage` sẵn
- [x] `src/cli/hooks.ts` — `nodeHooks()`: hai `Map` env/global trong RAM, `setEnv`/`setGlobal` vừa ghi vừa log (giá trị trông như secret bị che `***`)
- [x] `src/cli/load.ts` — `parseArgs`, `loadRunFile`/`loadJsonValue` (Postman 1 object / mảng / backup ReqX), `varFileToJson` (Postman env · ReqX env · map trần), `buildVars`, `referencedVarNames` + `seedFromProcessEnv`, `scriptDefinedVarNames`, `filterCollections`
- [x] `src/cli/run.ts` — `stripUntrustedScripts` → `runLoaded` (`collectRequests` + `runRequestList`, tiến trình `[i/n] PASS/FAIL METHOD url status time tests`, biến script đặt) → `main()` map lỗi hệ thống ra exit 2; `src/cli/index.ts` là điểm vào
- [x] `package.json` — `build:cli` (esbuild → `dist-cli/reqx.mjs`, 244 KB, không thêm dependency) + `cli`; `.gitignore` thêm `dist-cli/`
- [x] Test `src/lib/__tests__/cli.test.ts` — 22 case: thứ tự A→B→C, env đặt ở A đọc được ở C, exit 0/1/2, `--bail`, `--collection`, mặc định cắt script import (kể cả script kế thừa), origin local chạy script, `process.env` fallback, file thiếu / JSON hỏng
- [x] Ngoài unit test: smoke thật `node dist-cli/reqx.mjs run` vào server Node cục bộ (2 pass / mix fail) → đúng exit code, `?token=` in ra đã che, lỗi mạng Node báo `ECONNREFUSED` thay vì chuyện CORS, file thiếu/JSON hỏng báo exit 2

### P1 — báo cáo & CI thật dụng
- [ ] `--reporter junit` (XML `testsuite/testcase/failure`) — thứ CI parse
- [ ] `--reporter json` (`RunItemResult[]` + thống kê) + `--out`
- [ ] Tái dùng `generateRunnerHtmlReport` + `maskSensitiveBody`/`maskUrl` cho HTML/CSV
- [x] Map `--bail` → `stopOnError`, `--delay`, `--timeout` (làm luôn ở P0 vì runner đã có sẵn 3 tham số)
- [ ] `--iteration-count` + `--data <file.csv>`
- [ ] Test: fixture collection + data file 2 dòng → so XML/JSON ổn định

### P2 — đủ dùng cho cả team
- [ ] `reqx ci init` sinh file workflow mẫu (GitHub Action / `.gitlab-ci.yml`) chỉ đúng chỗ inject secret
- [ ] `reqx env lint` — dùng `extract-vars.ts` báo biến thiếu/trùng **trước** khi chạy
- [ ] Flow runner nếu Q2 = (b)
- [ ] `docs/HD-CLI.md` + mục `CHANGELOG.md`

---

## 5. Rủi ro đã nhìn thấy (báo trước để khỏi bất ngờ)

1. `pm.sendRequest` **chưa hỗ trợ form-data** (`scripts.ts:194`) → script login gửi form-data sẽ fail, cả UI lẫn CLI.
2. Không có Tauri thì `http-client` rơi vào nhánh `fetch` của Node: một số header bị browser/undici cấm set tay → **kết quả có thể lệch** so với bản `.exe` (reqwest). Phải ghi rõ trong docs, và nên test song song một suite trên cả hai.
3. `bodyStore` (IndexedDB) không có ở Node → CLI không có "mở lại body của lần chạy trước", chỉ còn file report.
4. Script của anh nếu đụng API browser (`document`, `localStorage`) sẽ crash ở Node → **bước đệm bắt buộc**: chạy thử 1 collection thật của anh ở P0 trước khi cam kết với QA.
5. Hiện tại **0 test UI/component**, nên chất lượng CLI phải đo bằng fixture, không ai bấm thay được.

---

## 6. Ước lượng

- P0: ~1 buổi (4 file `src/cli/*` nhỏ + 2 chỗ sửa guard + 1 file test).
- P1: ~1 buổi (chủ yếu JUnit + wiring cờ).
- P2: lẻ tẻ, cái `env lint` rẻ, `ci init` rẻ, Flow runner đắt.

**Anh trả lời Q1→Q5 (hoặc "làm theo đề xuất") thì em code P0.**
