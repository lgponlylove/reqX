# Lịch sử thay đổi — ReqX

Dự án theo SemVer, bản mới nhất nằm trên cùng. Ngày ghi theo định dạng dd/MM/yyyy.

## [0.1.1] — 12→13/10/2026 *(nhãn chưa bump trong `package.json`/`tauri.conf.json` — đang để 0.1.0 vì chưa build `.exe`)*

Đợt rà soát đọc-lần-hai rồi sửa theo pha (P0 → P1 → P2) cho batch OAuth2 / auth-protocols / cookie-jar / diff / contract-test / Flow.

### 🔒 Bảo mật — secret không còn ghi xuống đĩa (P0)

- **Cookie jar chỉ còn trong RAM** (`src/lib/cookie-jar.ts` viết lại): bỏ toàn bộ `localStorage.setItem`; bản cũ dưới key `reqx-cookie-jar-v1` được nạp một lần rồi xoá vĩnh viễn. Thêm quy tắc RFC 6265: path khớp theo ranh giới dấu `/`, `Domain=` chỉ nhận chính host hoặc suffix hợp lệ (`isRegistrableDomain`), cờ `hostOnly`, `Max-Age<=0` xoá cookie, kiểm prefix `__Host-`/`__Secure-`, cookie `Secure` bị từ chối khi gửi qua http.
- **Biến giống credential tự động thành secret** (`src/lib/secrets.ts` + `src/stores/app.ts`): `looksSecret()` nhận diện token/secret/password/api-key/… theo từ khoá tên biến (kể cả JWT `eyJ…` và private key `-----BEGIN`); `setEnvVar`/`setGlobal` bật cờ secret ngay khi gõ, nên giá trị không bao giờ đi vào `partialize`.
- **Lịch sử request được làm sạch trước khi lưu** (`src/stores/app.ts`): `partialize` áp `stripRequestSecrets` cho request, bỏ header `set-cookie|cookie|authorization|x-api-key|api-key`, và mask + cắt body 20.000 ký tự bằng `maskSensitiveBody`.

### ✅ Auth chạy thật + export không rỉ token (P1)

- **Digest**: thêm handshake 401 thật (`maybeDigestRetry` trong `src/lib/http-client.ts`) — lấy `realm/nonce/opaque/qop/algorithm` từ `WWW-Authenticate` rồi tính lại; `digestHash` hỗ trợ MD5 và SHA-256 theo algorithm server, `qop=auth`/`auth-int`/không qop; header gửi ra ghi rõ `algorithm=`. Hàm mới: `parseDigestChallenge()`.
- **AWS SigV4**: sửa thứ tự trong `sendRequest` thành *params → headers → chuẩn bị body → gắn cookie → applyAuth*, nên chữ ký hash đúng byte body thật (`payloadHash` cho body nhị phân); dựng `canonicalHeaders`/`signedHeaders` qua map tra theo tên thường hoá (trước đây biểu thức tra header bị sai); thêm `x-amz-security-token` khi có session token.
- **Basic**: `btoaUtf8()` mã hoá đúng UTF-8 thay cho `btoa` thô.
- **Cookie & auth trên cả hai transport** (Tauri Rust và fetch dự phòng), kèm `digestAttempted` để không lặp vô hạn.
- **NTLM**: giữ nguyên Type-1 (test cũ trông đợi) nhưng ghi chú rõ 3 bước handshake không thể hoàn tất từ webview/reqwest.
- **Masking tập trung** (`src/lib/mask.ts` mới): `maskSensitiveBody()` + `maskUrl()` (che tham số query dạng token, giữ tham số thường), che Bearer và JWT. `reporter.ts` và `test-cases.ts` dùng chung module này (tránh import cycle) và mask **ngay lúc tạo kết quả**, nên CSV, HTML report và bảng kết quả trong UI đều thừa hưởng.

### 🧩 Import OpenAPI, JSON Schema, Command Palette, Cookies (P2)

- **JSON Schema an toàn hơn** (`src/lib/json-schema.ts`): `validateJsonSchema` mang `ctx {depth, refs}` — cắt vòng `$ref` tự tham chiếu qua `allOf` thay vì tràn stack, cap độ sâu 128; `resolveRef` nhận `#` và `#/` trỏ schema gốc.
- **OpenAPI import** (`src/lib/openapi-import.ts`): path param `in:'path'` được thay giá trị thật (example/default/enum đầu) vào URL, thiếu thì giữ `:param` và cảnh báo; xử lý `in:'cookie'`/`formData`; `servers[].variables` thay default; `warnings[]` giờ có nội dung thật (nhiều server, thiếu base URL, `$ref` không phân giải, requestBody không phải JSON, `oneOf/anyOf`, path không có operation, placeholder không khai báo, số request cần auth) — gom qua `warn()` chống trùng, cap 40 dòng; YAML parser hỗ trợ block scalar `|`/`>` (kèm `-`/`+`); request import vào gắn `origin:'imported'` nên vẫn phải duyệt mới được chạy script.
- **Command Palette** (`src/components/CommandPalette.tsx`): có lệnh thật (mở tab trống, mở 9 view, đổi ngôn ngữ) kèm badge "Lệnh"; dòng đang chọn tự `scrollIntoView`; quota 6/14/5/6 để môi trường và lịch sử không bị collection nuốt trong cap 25; listener Escape chỉ đăng ký khi palette mở và trả focus về nút mở; `role="dialog"`/`listbox`/`option` + `aria-selected` + `aria-activedescendant`, Tab bị giữ trong overlay, phím mũi tên wrap quanh danh sách.
- **OAuth2** (`src/components/OAuth2Editor.tsx`): `window.open` bị chặn thì URL hiện trong ô read-only + nút Copy (và tự chép clipboard), không in code ra màn hình.
- **Cookie Manager mới** (`src/components/CookieManager.tsx` + view `cookies` trong dock): bảng domain/path/key/value (giá trị ẩn mặc định, bấm để hiện), hết hạn, cờ HttpOnly/Secure, phân biệt cookie domain (`.` đầu) với host-only, lọc theo từ khoá và chip domain, xoá từng dòng, "Xoá tất cả" có bước xác nhận, ghi chú jar chỉ sống trong RAM.
- **UI phụ** (`src/App.tsx`): bỏ nút trùng ở rail thu gọn (title lấy từ `t.header.expandSidebar`), xoá field `icon` chết trong `MAIN_VIEWS`.
- **i18n**: thêm mục `cookies` và các khoá `dock.cookies*`, `commandPalette.cmd*`/`kindCommand` cho cả vi/en.

### 🔑 N6 — OAuth2 tự gia hạn trong phiên (RAM-only)

- **`src/lib/oauth2-refresh.ts` (mới)**: `ensureFreshOAuth2()` kiểm tra hạn token *trước khi gửi* — còn ≤ 60s (`REFRESH_LEEWAY_SEC`) hoặc đã hết hạn và có refresh token thì gọi token endpoint với `grant_type=refresh_token`, thay token mới cho đúng request đó. Cache phiên là `Map` trong RAM, khoá `tokenUrl|clientId|scope|hash(refreshToken)` — **không có đường nào ghi token/refresh token xuống đĩa**, đóng app là mất.
- **Chống spam IdP**: promise đang chạy được gộp (`inflight`) nên nhiều request gửi đồng thời chỉ refresh một lần; lỗi thì ghi vào `error` và nghỉ 30s (`ERROR_COOLDOWN_MS`), request vẫn gửi bằng token cũ để server tự trả 401.
- **Không phá thao tác thủ công**: nếu config vừa được "Lấy Token" (issueAt mới hơn cache) thì nhận của người dùng, không ghi đè; refresh xong có `requestId`/`autoSaveVar` thì viết lại state trong RAM (dynamic import store, bỏ qua ở môi trường headless).
- **`expiryFromJwt`**: IdP trả JWT mà không kèm `expires_in` vẫn biết hạn, nhờ đọc `exp` trong payload.
- **Tích hợp** (`src/lib/http-client.ts`): gọi `ensureFreshOAuth2` NGAY TRƯỚC `applyAuth` nên header `Authorization` luôn dùng token mới; bỏ qua request có `id === 'oauth2_token_fetch'` để không đệ quy.
- **UI** (`src/components/OAuth2Editor.tsx`): thẻ "Tự gia hạn trong phiên" hiển thị nhãn endpoint, thời điểm gia hạn gần nhất, số lần, thời gian còn lại, lỗi gần nhất + thời gian cooldown; cache tự dọn khi đóng app.
- **i18n**: thêm mục `oauth2Session` cho cả vi/en.

### 🖼 Layout — 4 lỗi giao diện (13/10/2026; 3 lỗi đầu anh xác nhận bằng mắt, lỗi thứ 4 sửa sau đó)

- **Dải tab đang mở bị cắt nửa chữ** (`src/components/TabBar.tsx`): root mang `overflow-x-auto` nên `min-height:auto` của flex item về 0 → nó là phần tử duy nhất bị nén khi cột Builder thiếu chiều cao, và tự cắt mất chữ. Bỏ `overflow-x-auto` ở root, thêm `shrink-0`; scroller thật nằm ở `:41` (`flex-1 py-0.5`); mỗi pill tab và nút ＋ thêm `shrink-0` để không bị bóp khi nhiều tab.
- **Panel Response nằm tuột dưới màn hình** (`src/App.tsx:198`): `JsonBodyEditor` là textarea không cap nên body dài bao nhiêu cũng nở hết, đẩy `ResponseViewer` khỏi viewport. Cột Builder chuyển `overflow-y-auto` → `overflow-hidden`, tách hai pane cuộn độc lập: pane request (`RequestBar` + `RequestTabs`) và pane response, mỗi bên `flex-1 min-h-0 overflow-y-auto`; `hr` `shrink-0`.
- **Editor script/JSON bị "nhân đôi chữ"** (`ScriptCodeEditor.tsx`, `JsonBodyEditor.tsx`): lớp highlight `absolute inset-0` rộng hơn phần chữ của textarea đúng bề ngang scrollbar (~8px) → hai lớp gãy dòng khác nhau, lệch dọc cộng dồn khi cuộn. Thêm `scrollbar-gutter: stable` cho **cả hai** lớp để bề rộng phần chữ khớp tuyệt đối.
- **Chữ highlight lọt sau footer của `ScriptCodeEditor`**: backdrop `inset-0` tính trên container ngoài (gồm cả footer "Gõ pm. …"), nên vùng tô màu cao hơn textarea. Tách thêm một lớp `relative` chỉ bọc backdrop + textarea; popup gợi ý và footer vẫn là con của container ngoài nên vị trí không đổi.

### 🖥 CLI runner — P0 xong (13/10/2026)

Kế hoạch: `docs/KeHoach_CLI_Runner.md` (đã chốt Q1–Q5 theo đề xuất). Mục tiêu: QA chạy đúng suite đang có trong CI, không bấm UI.

- **Tách lib khỏi browser** (điều kiện cần để chạy Node): `src/lib/http-client.ts` thêm `setDefaultBaseUrl()` + `resolveBaseUrl()` thay cho `window.location.origin` (URL tương đối mà không có base thì báo lỗi rõ, đừng âm thầm resolve sai); timer gắn kiểu `ReturnType<typeof setTimeout>`; `cookie-jar.ts` vốn đã guard `typeof localStorage`.
- **Lỗi mạng nói đúng theo môi trường** (`http-client.ts`): trước đây mọi `TypeError` bị diễn giải là CORS. Giờ branch Node đọc `e.cause` của undici → `Không kết nối được http://127.0.0.1:8799 — ECONNREFUSED`; browser vẫn giữ cảnh báo CORS.
- **Cổng script tách khỏi hộp thoại** (`src/lib/scripts.ts`): `ScriptGate` + `setScriptGate()`; UI giữ `confirm()`, CLI quyết theo `--allow-scripts`. `confirmUntrustedScripts` gọi qua gate nên hành vi cũ không đổi.
- **`src/cli/`** (4 file, không thêm dependency): `hooks.ts` — `nodeHooks()` hai `Map` env/global trong RAM, log biến script đặt (giá trị trông như secret che `***`); `load.ts` — `parseArgs`, nạp Postman v2.x (object hoặc mảng) / backup ReqX, file biến cả 3 kiểu (Postman `values[]`, ReqX `variables{}`, map trần), `--env` lặp (sau đè trước) · `--global` · `--var` · **fallback `process.env` cho `{{TEN}}` còn thiếu** (đường duy nhất đưa token vào CI mà không ghi file), `--collection` lọc theo tên; `run.ts` — `stripUntrustedScripts` → `runRequestList` → tiến trình `[i/n] PASS/FAIL METHOD url status time tests` → **exit code 0/1/2**; `index.ts` điểm vào.
- **Mặc định an toàn**: collection import chưa được duyệt thì script (kể cả script kế thừa mức collection/folder) bị cắt, request vẫn chạy, in cảnh báo kèm số dòng — thêm `--allow-scripts` mới chạy. Collection tự tạo (`origin: 'local'`) chạy script bình thường. Biến do script đặt không bị báo nhầm là "chưa đặt".
- **URL in ra màn hình qua `maskUrl`** → `?token=***`, không rỉ credential ra log CI.
- **Build**: `npm run build:cli` (esbuild → `dist-cli/reqx.mjs`, 244 KB) rồi `node dist-cli/reqx.mjs run <file>`; `npm run cli` gom một dòng. Chưa có `bin`/`npm link` theo đã chốt.
- **Kiểm chứng**: `tsc` 0 lỗi, `vitest run` 20 file / **201 test** (thêm 22 test CLI: thứ tự chạy, biến truyền giữa request 1→3, exit 0/1/2, `--bail`, lọc `--collection`, cắt script import/script kế thừa, origin local, `process.env` fallback, file thiếu/JSON hỏng). Smoke thật bằng transport Node (server HTTP cục bộ): 2 pass exit 0, hỗn hợp pass/fail exit 1, `ECONNREFUSED` báo đúng.
- **Còn treo (P1/P2)**: reporter `junit|json|html|csv` + `--out`, `--iteration-count`/`--data`, `reqx ci init`, `reqx env lint`, `docs/HD-CLI.md`. Flow không nằm trong P0 (đã chốt Q2a).

### 🩹 Fix — bảng con (Pre-request/Tests…) không đổi khi chuyển request (13/10/2026)

- **Nguyên nhân** (`src/components/RequestTabs.tsx`): bảng con đang mở giữ bằng `useState<Tab>` của chính component — component chỉ mount một lần cho mọi tab request nên `setTab('pre')` của request A bị **dính sang** request B đang mở (`tabLabels` và nội dung bên dưới đọc `current` = request tab B → đang xem Pre-request của B trong khi B chưa hề có script).
- **Cách sửa (đã chốt: lưu theo từng tab, kiểu Postman)**: `src/stores/request.ts` thêm kiểu `ReqSubTab`, field `subTab?: ReqSubTab` trên `ReqTab`, action `setSubTab()` (chỉ ghi lên tab đang mở, `:172`) và selector `activeSubTab()` (tab cũ chưa có field → coi như `'params'`, `:53`). `RequestTabs.tsx:31-32` đọc `useRequestStore(activeSubTab)` / `s.setSubTab`, bỏ `useState<Tab>`; `TABS` thành `ReqSubTab[]`.
- **Không mất khi reload app**: `subTab` đi xuống đĩa nhờ `partialize` sẵn có (`:195`), không cần bump `version` vì field tùy chọn.
- **Test mới** `src/stores/__tests__/request-subtab.test.ts` (5 test): A mở Pre-request → sang B vẫn Params → quay lại A vẫn Pre-request; `set()` sửa request không làm mất bảng; tab mới mở = Params còn tab cũ giữ `'auth'`; persist ghi `"subTab":"pre"`.
- **Bẫy môi trường test (đáng nhớ)**: store không truyền `storage` nên zustand dùng mặc định `createJSONStorage(() => window.localStorage)` (`node_modules/zustand/middleware.js:334`); ở môi trường node của Vitest, `window` không tồn tại → `getStorage()` ném lỗi → persist **chốt `storage = undefined` một lần lúc khởi tạo** và cảnh báo "storage is currently unavailable" mãi, dù sau đó đã mock `localStorage`. Phải đặt `globalThis.window.localStorage` trong `vi.hoisted()` (chạy trước `import`).
- **Kiểm chứng**: `tsc --noEmit` 0 lỗi, `vitest run` **21 file / 206 test** xanh.

### 🧪 Kiểm chứng

- `npx tsc --noEmit`: 0 lỗi. `npx vitest run`: 19 file / **179 test** xanh (5 test cycle `$ref`/path param/body ngoài JSON/block scalar YAML + 13 test cho auto-refresh: không refresh khi thiếu token, còn hạn, dùng cache, gộp gọi đồng thời, cooldown khi lỗi, giữ refresh token cũ, đọc `exp` từ JWT).
- **Chốt batch — 13/10/2026 13:52**: `tsc` 0 lỗi, `vitest run` 19 file / 179 test pass, `vite build` chạy được (6.06s, chỉ còn cảnh báo kích thước chunk — đã quyết định không xử lý).
- **Xác nhận bằng mắt (user, 13/10/2026)** trên dev server `127.0.0.1:5173`: (a) dải tab hết cắt nửa chữ, (b) thấy đồng thời cả request lẫn response, (c) editor script hết nhân đôi chữ. Batch P0→P2 + N6 + 4 lỗi layout coi như đóng; task list #1→#14 đều completed.

### ⏭ Treo lại — chưa làm

- **N7**: contract test ngoài Runner; **N2**: bảng duyệt từng request khi import OpenAPI.
- **CLI P1/P2**: reporter `junit|json|html|csv` + `--out`, `--iteration-count`/`--data`, `reqx ci init`, `reqx env lint`, `docs/HD-CLI.md` (checklist trong `docs/KeHoach_CLI_Runner.md`).
- **C-6**: trường trùng `lang`/`language` trong `src/stores/language.ts`.
- Build lại `.exe` (Tauri) cho batch này.
- **Hiệu năng — KHÔNG làm (quyết định 13/10/2026)**: app chỉ chạy local, `src/stores/app.ts:716` history cap 100 item và `src/stores/mock.ts:137` log cap 100, `src-tauri/target/release/` chưa từng có `.exe`. Vì vậy bỏ: tách chunk (800.48 kB / gzip 242 kB + 4 cảnh báo rollup "dynamic import không tách chunk" cho `postman-io.ts`, `import-any.ts`, `oauth2-refresh.ts`, `stores/mock.ts`), virtualize danh sách, `React.memo` (0/33 component), quét 35 chỗ `: any`.
- **N3 i18n — KHÔNG làm (quyết định 13/10/2026)**: user chỉ dùng tiếng Việt. Còn ~1.172 dòng text Việt hardcode ở `OAuth2Editor` 332, `ScriptCodeEditor` 205, `OpenApiImportModal` 189, `FlowTimelineView` 154, `HistoryDiffModal` 144, `BinaryBodyEditor` 97, `LanguageSwitcher` 51 → chuyển sang EN sẽ thấy nửa menu tiếng Việt, chấp nhận.

## [0.1.0] — trước 12/10/2026

- Phiên bản đầu: ReqX — API client (Tauri v2 + React 18 + TS + Tailwind + Zustand): Builder nhiều tab, Runner, Flow, Scheduler, Mock Server, WebSocket/gRPC tester, trợ lý AI, collections/thư mục lồng nhau, biến môi trường + global với đồng bộ tên biến, import Postman/cURL/OpenAPI, key test & test case, xuất CSV(BOM)/HTML.
