# Lịch sử thay đổi — ReqX

Dự án theo SemVer, bản mới nhất nằm trên cùng. Ngày ghi theo định dạng dd/MM/yyyy.

## [0.2.5] — 17/10/2026

Bản phát hành v0.2.5 — Tự động mở trình duyệt hệ thống khi bấm tải về.

## [0.2.4] — 17/10/2026

Bản phát hành v0.2.4 — Tự động cập nhật 1-Click từ GitHub Releases.

## [0.2.3] — 17/10/2026

Bản phát hành v0.2.3 — Kiểm thử luồng tự động cập nhật (Auto-Update).

## [0.2.2] — 17/10/2026

Tự động cập nhật 1-Click (Tauri v2 Native Updater) + Ký số bảo mật GitHub Release:

- **1-Click Auto Update** (`src/lib/update-check.ts`, `StatusBanners.tsx`): Tích hợp Tauri v2 Native Updater (`tauri-plugin-updater` & `tauri-plugin-process`). Phát hiện bản mới và tải ngầm tự động, hiển thị tiến độ % và tự khởi động lại vào app mới.
- **Ký số bảo mật release**: Nhúng Public Key Minisign vào `tauri.conf.json` và bổ sung cấu hình GitHub Workflow ký số tự động (`release.yml`).
- **Nút kiểm tra cập nhật thủ công**: Bổ sung nút "Kiểm tra cập nhật" và phản hồi trực tiếp ngay trong modal Bản quyền (`LicenseModal.tsx`).
- **Đồng bộ hệ sinh thái Tauri v2**: Nâng cấp toàn diện các package `@tauri-apps/api`, `@tauri-apps/cli`, `tauri-plugin-updater`, `tauri-plugin-process` sang phiên bản tương thích 2.12 / 2.14, thêm cờ `--ignore-version-mismatches` cho `build-run.bat`.

## [0.2.1] — 16/10/2026

Nút "Tải về" ở banner bản mới trỏ đúng file theo OS (Windows → NSIS exe, mac ARM/Intel → dmg, Linux → AppImage) qua mục `assets` trong `latest.json`; kèm link phụ "File khác" mở trang tag. Đổi `latest.json` trỏ tag `v0.2.1`.

## [0.2.0] — 16/10/2026

Trial 60 ngày + tự kiểm tra cập nhật + chính sách 1 key = 1 máy.

- **Trial 60 ngày full tính năng** (`src/stores/license.ts`): lần chạy đầu tự ghi mốc `reqx_trial_start` (localStorage), không cần key/mạng; còn ≤14 ngày banner xanh, hết hạn banner amber — app vẫn chạy full (free như Pro). Có test `license.test.ts` (11 tests).
- **Tự kiểm tra bản mới** (`src/lib/update-check.ts` mới + `StatusBanners.tsx` dưới header): đọc `latest.json` trên GitHub 1 lần/ngày, timeout 8s, offline im lặng; có bản mới → banner xanh + Tải về / Để sau (nhớ theo version). Quy trình release 3 bước trong `docs/CHINH-SACH-BAN-QUYEN.md`.
- **Chính sách đổi máy**: khung 📌 trong modal Bản quyền (vi/en) + `docs/CHINH-SACH-BAN-QUYEN.md` — 1 key = 1 máy, cấp lại miễn phí tối đa 1 lần/năm, portable chép `reqx.lic` theo khi lên version.
- Version hiển thị trong modal lấy từ `APP_VERSION` dùng chung (hết hardcode `v0.1.2`); logger `appVersion` lên 0.2.0.

## [0.1.2] — 13→15/10/2026 *(nhãn chưa bump trong `package.json`/`tauri.conf.json` — đang để 0.1.0 vì chưa build `.exe`)*

Hai batch: sửa Builder/Response theo bản Postman thật, và **đóng CLI Runner P1 + P2** (`reqx run` có báo cáo + chạy theo dữ liệu, thêm `reqx env lint` và `reqx ci init`).

### 🎨 Builder/Response giống Postman (13–15/10/2026)

- **Lỗi gửi request dời xuống ô Response** (`src/stores/app.ts`, `RequestBar.tsx:237`, `ResponseViewer.tsx:97`): `sendError` là state riêng, `respByTab` lưu `{res, err}` theo từng tab nên chuyển tab không mất lỗi; ResponsePane hiện card đỏ (tiêu đề + Copy + gợi ý) khi chưa có response, tab tự mở lại khi `sending` chuyển `true→false` có lỗi (`App.tsx`, dùng transition để lỗi giống lần trước vẫn mở lại), thanh gập hiện `⚠ …` rút gọn. `setResponse` xoá `sendError` (có response mới thì lỗi cũ vô nghĩa), `TabBar.tsx` phục hồi err **sau** khi set response vì đúng thứ tự đó.
- **Gợi ý key header như Postman** (`src/lib/header-suggestions.ts` mới ~74 key chuẩn + `X-Api-Key`/`X-CSRF-Token`/`Idempotency-Key`/`Traceparent`; `KeyValueEditor.tsx` viết lại): prop tự chọn `suggestKeys`, dropdown `z-30` max 9 dòng, lọc startsBefore→includes, loại key đã dùng ở dòng khác, ↑/↓ (wrap), Enter/Tab chọn, Esc đóng, `onMouseDown preventDefault` để ô input không mất focus. `RequestTabs.tsx` gộp key chuẩn + key đã dùng trong mọi request đã lưu, **chỉ** áp cho bảng Headers (Params/gRPC/Mock giữ nguyên).
- Trước đó trong cùng batch: nút Send dạng split-button gom Key/Test/Mock, font nhỏ + URL bar sát mép tab, thanh kéo chia chiều cao request/response.

### 📊 CLI P1 — báo cáo + chạy theo dữ liệu (15/10/2026)

- **`src/cli/report.ts` (mới, hàm thuần)** — 4 renderer `junit|json|html|csv`, không fs/không mạng nên test được không cần CI thật. JUnit: `<testsuites>` → mỗi collection × iteration một `<testsuite>`; **phân loại fail** theo `isTechnical()` (`!ok && status == null` = lỗi mạng/script → `<error>`; HTTP ngoài 2xx hoặc assertion fail → `<failure>`) vì runner đặt `error: 'HTTP 500 …'` cho cả hai nhóm; log đã che vào `<system-out>`, testcase sạch tự đóng `/>`. JSON `schema: "reqx-run/1"`. CSV **BOM + CRLF** (mở Excel giữ dấu tiếng Việt), lỗi nhiều dòng gom một ô. HTML tái dùng `generateRunnerHtmlReport` của tab Runner, không viết template thứ hai.
- **Che secret trong artifact**: mọi chuỗi rời module đi qua `maskSensitiveBody`/`maskUrl`; header có tên `SECRETISH` ghi `***`; cột `--data` trùng tên secret cũng `***`; body cắt 4000 ký tự; **không bao giờ in giá trị credential**.
- **`--reporter` + `--out`**: mặc định ghi `reqx-report/` **ngay cạnh file collection** (theo thói quen "xuất ra cạnh file nguồn"), `--out` ghi đè; `--reporter none` chỉ in stdout; tên sai → exit 2 kèm danh sách hợp lệ. Ghi report thất bại (thư mục chết) chỉ in `✗ Không ghi được báo cáo…` và **giữ nguyên mã thoát của test**.
- **`--iteration-count` + `--data <csv|json>`**: tái dùng `runCollectionWithData` sẵn có bằng cách thêm `dataRow` vào `RunAllOpts` (`src/lib/runner.ts`) thay vì nhân bản loop — **dòng data thắng env khi resolve** `{{…}}`, `pm.*.set` vẫn ghi env thật. `iterationPlan()` = `max(số dòng, iteration-count>1, 1)`, dòng lấy `i % số dòng`. Cột data không `{{}}` nào dùng → cảnh báo; cột data không còn bị báo nhầm "Biến chưa đặt".
- **Dòng fail truy được về dữ liệu**: tên testcase JUnit `[username=minh]`, cột `data` trong CSV/JSON.

### 🔎 CLI P2 — `reqx env lint` + `reqx ci init` (15/10/2026)

- **`src/cli/lint.ts` (mới)** — soát biến không gọi mạng: `missing` (**error → exit 1**), `empty`/`unused`/`secret` (warn), `shadow` global↔env (info, ghi rõ file nào thắng). Biến do script `pm.environment.set` đặt hoặc trùng tên biến môi trường hệ thống thì **không** tính là thiếu. `findLiteralSecrets()` quét `auth.{token,password,apiKey,digest,ntlm,awsv4,oauth2}` + header/param có tên nghi credential hoặc giá trị tự bản thân là `Bearer…`/JWT/`sk-…`/`ghp_…`; giá trị đã là `{{var}}` thì bỏ qua; output chỉ nêu **vị trí**, không trích giá trị.
- **`src/cli/ci.ts` (mới)** — template GitHub Actions / `.gitlab-ci.yml` / `Jenkinsfile`: `npm ci → npm run build:cli → reqx run --reporter junit,csv --out reports` rồi thu JUnit (`dorny/test-reporter`, `reports: junit:`, `junit 'reports/*.xml'`). **Chỗ secret để trống** + chú thích trỏ nguồn bí mật riêng của từng hệ thống; chưa `--force` thì từ chối ghi đè (exit 2). Template escape đúng `${{ secrets.X }}` (trong template literal TS phải `\${`).
- **Lệnh phụ route ngay trong `main()`** (`src/cli/run.ts` `dispatch()`): `env lint` reuse `parseArgs`, `ci init` có parser riêng; `env …`/`ci …` lạ → exit 2; cả hai đều có `--help` và đã ghi trong `USAGE`.

### 📝 Tài liệu

- `docs/HD-CLI.md` (mới): dựng & chạy, bảng cờ đầy đủ, mã thoát 0/1/2, 4 loại báo cáo + quy tắc che secret, `--data`/`--iteration-count`, sách lược secret-from-environment (kèm cú toán Git Bash/PowerShell/cmd), `env lint` (bảng mức độ → exit code), `ci init` 3 provider, **7 khác biệt so với bản UI** (fetch Node vs reqwest, không IndexedDB/bodyStore, cookie jar rỗng, cổng script, `pm.sendRequest` chưa form-data, Flow chưa chạy, chỉ đụng disk file được chỉ định), lệnh nghiệm thu.
- `docs/KeHoach_CLI_Runner.md`: tick xong P1 (6/6) và P2 (3/4 — còn Flow, đã chốt Q2a nên treo).

### 📄 Tài liệu API tự sinh + nút ở menu Send (15/10/2026)

The "Mở rộng Key test" batch — anh chọn **Q5 = (a)** trước, nên pha này chỉ làm phần tài liệu; Key test P0/P1 vẫn chờ chốt Q1→Q3.

- **`src/lib/api-docs.ts` (mới, hàm thuần — không fs/không mạng nên test được ngay)**: `renderRequestDocs()` cho 1 request, `renderCollectionDocs()` cho cả collection, `pathOf()` tách đường dẫn (hỗ trợ `{{baseUrl}}`, `{{baseUrl}}:3000`, scheme+host), `docsFileName()` slug không dấu + ngày. Tài liệu gom 1 file `.md`: *Mục lục* → *Bảng endpoint* (`Method | Path | Tên | Thư mục | Xác thực`, đi cả **folder lồng nhau** qua `rootFolderIds()` + `seen`) → *Biến môi trường dùng tới* (kèm cột **chưa đặt**, chỉ tên biến, không giá trị) → *Chi tiết request* (endpoint, URL đầy đủ, xác thực, bảng query/header, bảng field body, body mẫu, ghi chú script, **ví dụ curl**).
- **Tái dùng thay vì viết mới**: bảng field body lấy từ `collectTargets()` của bộ sinh Key test (không đi JSON loop thứ hai), tên field nghi credential → `***` theo `looksLikeSecretName()`, giá trị khác qua `maskSensitiveBody()`/`maskUrl()`, code fence tự nới số backtick khi nội dung có `` ``` ``, ô bảng escape `|` + xuống dòng.
- **Nút "📄 Tài liệu API"** trong menu ▼ Send (`RequestBar.tsx` `exportDocs()`): mở tab thuộc collection nào thì xuất collection đó, tab chưa lưu thì xuất 1 request; ghi file cạnh `.exe` qua `saveExportBesideApp` + `revealExportedFile`, chạy trên web thì fallback tải về Downloads. Toast 4,5 s, lỗi có `setError` riêng. Key i18n mới `request.docsApi` / `docsApiTitle` (cả vi lẫn en).
- **Sửa 2 chỗ rỉ secret tìm ra lúc test** (`maskCurl()` trong `src/lib/test-cases.ts`): bản cũ chỉ che header, nên `curl 'https://x/y?token=ABC…'` và `--data-raw '{"password":"…"}'` vẫn nguyên credential trong **CSV báo cáo Key test + report HTML + tài liệu**. Giờ mask thêm URL query (`maskUrl`) và body của `--data|--data-raw|--data-binary|--data-urlencode|--form|--json`.

### 🩹 Đổi tên biến: "đã báo cập nhật mà không thấy đổi" (15/10/2026)

- **Nguyên nhân**: hộp thoại "N nơi đang dùng {{…}} sẽ được cập nhật theo" nói đúng với **request đã lưu** (`state.requests`) nhưng **tab đang mở trong Builder** là bản sao riêng trong `useRequestStore` — không ai đụng vào. User nhìn thấy tab, vẫn `{{domain.sso.shome1}}`, và bấm Save là ghi đè ngược bản vừa sync. `refreshTabs()` có sẵn cũng không cứu được vì nó **bỏ qua tab dirty**.
- **`renameVarInTabs()`** (`src/stores/request.ts`): thay `{{old}}` → `{{new}}` trong **mọi tab đang mở, kể cả tab đang sửa dở**, giữ nguyên `dirty` và các sửa dở khác (dùng `renameVarInRequest` nên không mất nội dung). `renameEnvVar` + `renameGlobal` gọi ngay sau khi sync state (ngoài updater để không side-effect trong `set`).
- **Logic rename dồn về `src/lib/variables.ts`** (`hasVarRef`/`renameVarRef`/`requestHasVarRef`/`renameVarInRequest`) để store app và store tab dùng chung một tập trường, thay vì hai bản copy lệch nhau: URL, params, headers, body, pre-request/tests, auth (token/username/password/apiKey/apiKeyName) **+ cấu hình OAuth2 lồng** (`tokenUrl`, `clientId`, `accessToken`… — trước đây bỏ sót hẳn), chấp nhận `{{ key }}` có khoảng trắng vì `resolveVariables` cũng đọc dạng đó, và **không ăn nhầm key tiền đề giống nhau** (`shome1` ≠ `shome`, `shome1extra` giữ nguyên).
- **Giá trị của biến khác cũng đổi theo**: `baseUrl = http://{{domain}}/api` là kiểu tham chiếu thật nhưng nằm ngoài phạm vi rename cũ. `renameVarRefs` giờ quét cả `environments[].variables` + `globals`, và `countVarRefs(key, …, extra)` nhận thêm các chuỗi đó để **con số trong hộp thoại khớp** với việc sẽ xảy ra (`EnvironmentManager` truyền toàn bộ giá trị env + global).
- Test mới `src/stores/__tests__/var-rename.test.ts` **11 case**: 4 case hàm thuần (khoảng trắng, tiền đề giống nhau, no-op giữ nguyên object, oauth2), 2 case đếm nơi dùng (có/không `extra`), 4 case `renameEnvVar` (sync toàn bộ + **tab đang mở** + tab dirty giữ sửa dở + rename không tham chiếu không làm dirty), 1 case `renameGlobal`.

### ➕ "Biến chưa tồn tại" → thêm mới ngay tại chỗ (15/10/2026)

- **`src/components/QuickAddVar.tsx` (mới)**: form gọn nằm ngay dưới dải lỗi — ô giá trị, ô chọn **Lưu vào** (môi trường đang chọn, hoặc Globals), tick 🔒 Secret, Thêm/Hủy, Enter = thêm. Không cần sang tab Môi trường rồi quay lại.
- **Những cửa chặn đã tính tới**: tên biến hiển thị **cố định** (đổi tên ở đây thì request vẫn thiếu biến như cũ); **buộc có giá trị** vì để trống thì request vẫn được gửi với chuỗi rỗng chứ không báo lỗi; biến đã có trong môi trường được chọn thì báo "đã có trong {target}" thay vì âm thầm ghi đè; **secret tự bật** theo `looksSecret(name)` và vẫn bật khi `looksSecret(name, value)` (`addEnvVars`/`addGlobals` không tự dò secret như `setEnvVar` — giá trị JWT dán vào biến tên thường cũng không xuống đĩa).
- **Dải lỗi quét cả request chứ không chỉ URL** (`RequestBar.tsx` `missingVars`): trước đây dùng `resolveVariables(current.url)` nên `{{token}}` nằm ở header/body không hề bị báo. Nay = `collectRequestVars(current)` (url/body/params/headers/auth — hàm có sẵn của Runner) lọc biến đã có; **không quét script** vì `pm.environment.set` trong pre-request đặt biến lúc chạy, báo thiếu ở đây là báo nhầm.
- Mỗi chip `{{biến}}` có nút **＋ thêm ngay đây**; thêm xong chip tự biến mất vì `missingVars` dẫn xuất từ state, và có flash `✓ Đã tạo "…" trong …`. Key i18n mới `request.missingVarsLabel`, `varAddHere(Title)`, `varAddTargetLabel`, `varAddSecret(Label/Title)`, `varAddNeedValue`, `varAddExists`, `varAddDone` (đủ cả vi lẫn en).
- Kiểm chứng riêng phần này: `npx tsc --noEmit` **0 lỗi** + `npx vitest run` **263 test xanh**; toàn bộ là UI nên không thêm unit test, chưa mở browser test (theo thoả thuận không demo browser).

### ⤢ Phóng to ô soạn thảo (Pre-request / Tests / Body / Response) (15/10/2026)

Anh chốt: sửa trực tiếp được trong popup, modal lớn còn thấy nền, Esc/click nền trống để thu về.

- **`src/components/ExpandOverlay.tsx` (mới)** — khung dùng chung `fixed inset-0 z-50`, panel `min(1200px,94vw) × 88vh`. **Không có bản copy**: con gọi truyền thẳng editor vào state gốc (`set({ preRequest })`, `set({ body })`) nên đóng popup kiểu gì nội dung cũng đúng, "về chỗ cũ" chỉ là bỏ lớp phủ. Esc bỏ qua khi `defaultPrevented` — Esc đóng menu gợi ý code không làm mất popup.
- **`ScriptCodeEditor`**: thêm `onExpand` (nút ⤢ ở footer, chỉ hiện ở ô nhỏ) và `tall` (ăn `flex-1 min-h-0` + `h-full resize-none`, bỏ `minHeight`/`rows`). `JsonBodyEditor` cùng cơ chế `tall`.
- **`RequestTabs.tsx`**: state `expanded` = `'' | 'pre' | 'tests' | 'body'`, overlay render ở gốc component; tự reset khi `current.id` đổi để không soạn nhầm request khác. Nút ⤢ body đặt ở dải chọn loại body, **không** hiện với `none`/`binary` (chẳng có gì để soạn). Tái cấu trúc nhỏ: `bodyPlaceholder` một chỗ duy nhất cho 4 nhánh (json/raw/urlencoded/form-data) để ô nhỏ và popup không lệch gợi ý mẫu.
- **`ResponseViewer.tsx`**: gom pretty/raw/preview từng bị chặn `max-h-96` thành `bodyPane(tall)` — một bản định nghĩa, ô nhỏ `max-h-96`, popup `flex-1`; HTML preview dùng iframe nên đổi `h-96` ↔ `flex-1` theo cùng cờ. Nút ⤢ nằm cạnh 📋 Copy, chỉ hiện khi đang xem khung text (`isTextPane`).
- Key i18n mới (đủ vi + en): `request.expand`, `request.expandHint`, `request.expandPreTitle`, `expandTestsTitle`, `expandBodyTitle`, `response.expandTitle`.
- Kiểm chứng: `npx tsc --noEmit` **0 lỗi**, `npx vitest run` **25 file / 263 test** xanh. Toàn bộ là layout/UI nên không thêm unit test, chưa mở browser.

### 📄 Tách phạm vi xuất tài liệu: Send = 1 request, thư mục/collection = chuột phải (15/10/2026)

- **Nút ▼ Send giờ chỉ xuất ĐÚNG request đang mở** (`renderSingleRequestDocs()` mới) — trước đây nó âm thầm xuất cả collection, dễ hiểu nhầm là "không thấy nút xuất cho thư mục".
- **`renderCollectionDocs(col, requests, { env, folderId })`**: thêm `folderId` để giới hạn phạm vi — đi từ đúng folder đó (kèm **folder con** qua `walkFolders`), **không** lấy request gốc của collection; tiêu đề thành `Collection / Folder`. `folderId` không tìm thấy (vừa đổi tên/xóa) → trả dòng "Không tìm thấy thư mục được chọn" thay vì sinh tài liệu rỗng.
- **Menu chuột phải Sidebar** có `📄 Xuất tài liệu Markdown của folder` và `… của collection`, đặt ngay cạnh `⚡ Tạo biến từ request…` theo đúng thói quen đã có; dùng env đang chọn để đánh dấu biến "chưa đặt".
- **Gom phần trùng**: tiêu đề + ghi chú nguồn của 3 bản (1 request / folder / collection) đi qua `banner()` một chỗ; việc "ghi cạnh app, không được thì tải về Downloads" thành `saveMarkdownExport(filename, text)` trong `src/lib/response-file.ts` — RequestBar và Sidebar cùng dùng, không còn hai bản copy logic blob-download.
- Chuỗi `docsApi`/`docsApiTitle` (vi + en) viết lại theo phạm vi mới, nhắc rõ muốn xuất cả thư mục thì chuột phải ở Sidebar.
- Test mới **5 case** trong `api-docs.test.ts`: folder cha lấy cả folder con và loại request gốc (2 request), folder lồng lấy riêng nó (1 request), `folderId` chết, `renderSingleRequestDocs` đủ tiêu đề + che token, request không tên lấy path URL làm tiêu đề.
- Kiểm chứng: `npx tsc --noEmit` **0 lỗi**, `npx vitest run` **25 file / 268 test** xanh (tài liệu: 8 → 13).

### 📐 Định dạng lại tài liệu theo mẫu anh đưa + theo ngôn ngữ đang chọn (15/10/2026)

- **Tiêu đề = tên collection** (bỏ chữ "Tài liệu API —"), dưới là một dòng nguồn `Sinh tự động bởi ReqX · Môi trường: **shome-live** · Cập nhật: 15/10/2026`, kèm `Phạm vi: **Folder**` khi xuất 1 thư mục. Ngày có `now` truyền được nên test không đổi kết quả theo ngày.
- **Mục lục theo thư mục**: `- **authen**: \`POST\` token sso.sysone.vn`, và tài liệu bổ **mục `## <tên folder>`** cho từng request chạy dưới (`walkFolders` giữ nguyên thứ tự, folder lồng thành `Auth / Nâng cao`).
- **Mỗi request đúng thứ tự mẫu**: mô tả → Xác thực → **URL** (fence) → **Headers** (`Key | Value | Bắt buộc`) → Query → **Body** (fence JSON + `Field | Kiểu | Bắt buộc | Mô tả`) → **Response 200** (fence + `Field | Kiểu | Mô tả`) → **Biến được trích ra** (Flow + danh sách `{{var}}`) → **cURL** → **Response 401** → **Kết quả Key test** (`Nhóm | Case | Mong đợi | Thực tế | Kết quả` + dòng tổng kết `12 case · 9 ✅ · 3 ❌`).
- **Bảng "Phần nào ReqX lấy từ đâu"** cuối file: 12 dòng liệt kê đúng nguồn của từng mục, kể cả những cột ReqX **suy ra** chứ không có dữ liệu thật.
- **Nguồn dữ liệu mới nạp vào bộ sinh** (`src/lib/docs-input.ts`, helper tách riêng vì `api-docs.ts` phải là hàm thuần): mẫu response lấy từ **lịch sử gửi request** (`HistoryItem.response` — đã được che secret ngay khi lưu, loại body binary và rỗng), biến trích ra lấy từ **step Flow** (`FlowStep.extract`), bảng Key test lấy từ `useTestCaseStore` (chỉ có trong phiên đang chạy vì store không ra đĩa). `api-docs.ts` nhận `DocsSample[] / DocsFlow[] / DocsTestRun` nên test không cần store.
- **Ba chỗ phải nói thẳng là "suy ra", không bịa**: `Bắt buộc` (`KeyValue` không có cờ required → suy từ cấu hình xác thực + `Content-Type` + field có mặt trong body đã lưu), `Kiểu` (suy từ giá trị mẫu, chưa có schema), `Mô tả` field (giá trị ví dụ đã che; field có tên nghi credential chỉ ghi `🔒 secret — đã ẩn`). Ghi chú in **một lần/request**, không lặp sau mỗi bảng.
- **Tài liệu theo đúng ngôn ngữ đang chọn**: toàn bộ nhãn chuyển sang từ điển `LABELS: Record<'vi'|'en', LabelSet>` trong `api-docs.ts`; RequestBar/Sidebar gọi `collectDocsExtras()` để lấy `lang` từ `useLanguageStore`. Chuỗi thông báo "Đã lưu tài liệu / Không xuất được tài liệu" thành key i18n mới `request.docsSaved` / `request.docsFailed` (vi + en).
- Kiểm chứng: `npx tsc --noEmit` **0 lỗi**, `npx vitest run` **25 file / 272 test** xanh (tài liệu 13 → **18**: bảng 3–4 cột + che token, mẫu Response 200/401 từ history, biến Flow, bảng Key test ✅❌⏳, bản en không còn chữ Việt + parity số dòng bảng nguồn vi/en). Đã render thật một collection 2 request/2 folder bằng esbuild+node để đối chiếu với mẫu rồi xoá script tạm.

### 🌐 Bản HTML một file (mở trình duyệt là thấy, không cần app) (15/10/2026)

Anh hỏi "làm ra tài liệu file html nhìn cho sinh động hơn file md" → thay vì viết bộ sinh HTML thứ hai, **đóng gói đúng file Markdown vừa sinh** (`md` để commit, `html` để xem/in).

- **`src/lib/docs-html.ts` (mới, hàm thuần)** — `renderDocsHtml(md, { lang })` chỉ nhận đúng tập markdown mà `api-docs.ts` tạo ra (heading 1–4, bảng, fence, list `-`, `>` callout, `**đậm**`, `` `code` ``) nên **không thêm thư viện markdown nào**. Escape toàn bộ trước khi ghép thẻ: tên request/URL/description có `<script>` chỉ hiện thành chữ. `## Mục lục` trong markdown bị **bỏ khỏi nội dung** vì sidebar đã liệt kê rồi (không lặp 2 lần).
- **Sinh động hơn md**: card hero cho tiêu đề + dòng nguồn + ghi chú che secret, **badge method có màu** (`GET` xanh lục, `POST` xanh da trời, `PUT/PATCH` vàng, `DELETE` đỏ, `HEAD/OPTIONS` tím) ngay trong heading và trong sidebar, bảng sticky header + hover dòng, `✓/❌/⏳/🔒` thành badge màu, khối code có **nút Copy** (kèm nhãn "Đã copy ✓"), **mục lục dính bên trái có ô lọc** (giảm tải cho bản collection dài), nút **🖨 In / Lưu PDF**, `@media print` đổi sang nền sáng, `@media (max-width:940px)` xuống 1 cột. Palette lấy theo `src/lib/reporter.ts` để hai loại file nhìn cùng nhà.
- **Bảng có dấu `|` trong ô**: `cell()` escape thành `\|`, bộ parse tách ô bằng `/(?<!\\)\|/` rồi `inline()` trả lại `|` — tên request kiểu `Login | Me` không bị xé thành 2 cột. Fence có `#`/`|` bên trong cũng không bị parse nhầm thành heading/bảng.
- **Nhãn tiếng Việt/Anh trong file HTML** (Mục lục/Contents, In/Print, Đã copy/Copied, Lên đầu trang/Back to top…) — `lang` lấy từ `collectDocsExtras()`, `<html lang="…">` theo luôn.
- **Đường xuất**: menu ▼ Send thành 2 mục — **📄 Tài liệu Markdown** (request đang mở) và **🌐 Tài liệu HTML**; chuột phải Sidebar (folder + collection) cũng thành cặp tương ứng, gom vào helper `docsItems(col, folderId?)` để 2 nhánh không lệch nhau. `saveMarkdownExport` → **`saveDocExport(filename, text, kind)`** (chỉ 2 chỗ gọi): blob `text/html;charset=utf-8` khi chạy trên web, vẫn ghi file cạnh `.exe` khi chạy app. Tên file `reqx-tai-lieu-<slug>-YYYYMMDD.html` (`docsFileName` nhận thêm `ext`). Key i18n mới `request.docsHtml` / `docsHtmlTitle` (vi + en).
- Kiểm chứng: test mới `src/lib/__tests__/docs-html.test.ts` **8 case** (tên request/URL/mô tả nhét `<img onerror>`/`<script>`/`<svg onload>` → chỉ còn `&lt;…`, file **không** chứa token + mật khẩu thật, `<!DOCTYPE html>` + sidebar + badge `m-post` + anchor + nút in, mục lục markdown bị bỏ mà sidebar vẫn có link, ô bảng chứa `|` không bị xé cột, fence chứa `#`/`|` không bị parse, bản en đổi nhãn, file rỗng vẫn hợp lệ). Gates: `npx tsc --noEmit` **0 lỗi**, `npx vitest run` **26 file / 281 test** xanh. Chưa mở browser xem file (theo thoả thuận).

### 🧹 Dọn hàng Tên/Mô tả + tắt kiểm tra chính tả trong ô soạn code (15/10/2026)

- **Dải "Môi trường: X • Mẹo: dùng {{baseUrl}} trong URL" dời xuống cuối bảng Params** (`RequestTabs.tsx`): hàng tên/mô tả trước đây còn nhét 💾 + Xem code + 3 nhãn ngôn ngữ + cả dòng chữ này (`shrink-0` nên dễ bị đẩy/tràn). Giờ dòng đó nằm cạnh `paramsHelp` — chỗ vốn còn trống. **Ăn luôn 2 key i18n đã có mà chưa ai dùng** là `request.envTip` + `request.urlTip`; bản cũ hardcode tiếng Việt trong `RequestBar.tsx` nên đổi sang English vẫn còn chữ Việt.
- **`spellCheck={false}` cho 6 ô toàn nội dung kỹ thuật** (`RequestTabs.tsx` 3 textarea body: form-data / Raw+x-www-form / bản phóng to, `KeyValueEditor.tsx` cột Key của Params+Headers, `BinaryBodyEditor.tsx` ô Base64, `OpenApiImportModal.tsx` ô dán spec): Chrome/Firefox gạch chân đỏ dưới `X-Tenant-Id`, `application/json`, `@D:/path.png`… nhìn như lỗi dữ liệu. `VarHighlightInput`/`JsonBodyEditor`/`ScriptCodeEditor` đã tắt từ trước nên chỉ còn 6 chỗ này. Ô Tên/Mô tả **giữ** kiểm tra chính tả vì đó là văn prose.
- Kiểm chứng: `npx tsc --noEmit` **0 lỗi**, `npx vitest run` **26 file / 281 test** xanh. Toàn bộ là layout/thuộc tính DOM nên không thêm unit test, chưa mở browser (theo thoả thuận).

### 🧪 Kiểm chứng (15/10/2026)

- `npx tsc --noEmit`: **0 lỗi**. `npx vitest run`: **25 file / 263 test** xanh (8 test tài liệu + 1 maskCurl + 11 test đổi tên biến). `npm run build`: chạy sạch (chỉ còn cảnh báo kích thước chunk đã quyết định bỏ).
- Test mới: `cli-report.test.ts` **20 case** (cấu trúc/escaping JUnit, suites theo iteration, masking JSON, BOM+CRLF+escape CSV, tái dùng HTML, `summarize`, `reportDirFor`, tên file, parse `--reporter/--data/--out/--iteration-count`, run 2 dòng → 6 item đúng nhãn iteration, `--iteration-count 3` → 9 item, `--bail` cắt cả loop, report không chứa `SUPERSECRET/AAA/XYZ`, thư mục ghi hỏng vẫn exit 1) + `cli-lint-ci.test.ts` **17 case** (missing/unused/empty/shadow/secret, thứ tự error>warn>info, process.env và script không bị báo thiếu, quét auth/header/JWT, `runLint` exit 1/0/2, route lệnh phụ, `ciFileName`/template không nhét secret/escape `${{`, parse cờ, ghi & chặn ghi đè). Tổng test CLI: **59**.
- **Smoke thật** với server Node cục bộ (đã xoá `smoke-tmp/` sau khi đo): `--data rows.csv` × 2 dòng × 2 request → **exit 1** đúng (request `/bad` 500), stdout `Tổng kết: 4 request — 2 pass, 2 fail • test 4/4 đạt`, 4 file `col.xml/csv/json/html`; JUnit có `<failure>` cho 500 (không phải `<error>`), `[user=minh]`/`[user=hoa]`แยก dòng; `?token=` in ra `***`, `SECRETVALUE123` **không** có mặt ở bất kỳ file nào. `--iteration-count 3` → 6 request; `--reporter tap` → exit 2; `env lint` (collection có `auth.token` chết + biến thiếu) → exit 1, đặt `apiToken` trong môi trường hệ thống → exit 0; `ci init` github → file + `---force` chặn, `--force` cho ghi.

### ⏭ Treo lại — chưa làm

- **Key test P0/P1** (`docs/KeHoach_KeyTest_TaiLieu.md`): nhóm auth/IDOR, payload injection tách theo field, `notContains` + mass assignment, sinh case theo OpenAPI/JSON Schema — **chờ anh chốt Q1→Q3**, chưa code. Q4 đã làm cả hai bản (**Markdown + HTML một file**); còn **OpenAPI JSON** (mẫu gợi ý) chưa làm. Q5b ("chạy lại N lần đo thời gian") chưa làm.
- **`docs/HD-KeyTest.md`** chưa viết — gộp một tài liệu sau khi P0/P1 xong.
- **Flow runner trong CLI** (kế hoạch đã chốt Q2a = chưa làm); Mock server `--mock` (Q3a), `--parallel` (Q4a) giữ nguyên quyết định bỏ.
- **Phát hành lệnh `reqx`** (Q5): vẫn gọi `node dist-cli/reqx.mjs`; chưa thêm `bin`/`npm link`, chưa build `.exe` sidecar, `build:cli` chưa `--minify` (283.5 kB).
- **N7** contract test ngoài Runner; **N2** bảng duyệt từng request khi import OpenAPI; **C-6** trùng `lang`/`language` trong `src/stores/language.ts`.
- Build lại `.exe` (Tauri) cho cả batch 0.1.1 + 0.1.2.

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
- **Còn treo (P1/P2)**: reporter `junit|json|html|csv` + `--out`, `--iteration-count`/`--data`, `reqx ci init`, `reqx env lint`, `docs/HD-CLI.md`. Flow không nằm trong P0 (đã chốt Q2a). → *tất cả đã xong ở 0.1.2 (15/10/2026), chỉ còn Flow.*

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
