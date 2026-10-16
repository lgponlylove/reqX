# ReqX CLI — chạy collection từ dòng lệnh (`reqx`)

CLI dùng **đúng engine của tab Runner** (`src/lib/runner.ts`), bỏ qua phần UI.
Mục đích: đưa bộ test đang có trong ReqX vào CI, hoặc chạy nhanh trên máy không
mở app. ba lệnh: `run`, `env lint`, `ci init`.

## 1. Dựng và chạy

```bash
cd D:\AI\postman-clone
npm run build:cli                       # esbuild → dist-cli/reqx.mjs (không thêm dependency)
node dist-cli/reqx.mjs run collections/api.json --env envs/staging.json
```

Bundle chỉ là file Node thông thường — `npm ci && npm run build:cli` trên runner
là đủ, không cần Rust/Tauri/WebView. Muốn gọn tay thì alias:

```bash
alias reqx='node /d/AI/postman-clone/dist-cli/reqx.mjs'
```

Mã thoát (dùng được ngay làm điều kiện trong pipeline):

| code | ý nghĩa |
|---|---|
| `0` | mọi request pass, mọi `pm.test` đạt |
| `1` | có request fail (HTTP ngoài 2xx) hoặc test không đạt |
| `2` | lỗi hệ thống: file không đọc được, JSON hỏng, cờ sai, biến bắt buộc thiếu |

## 2. `reqx run <file.json>`

`file.json` nhận **Postman Collection v2.0/v2.1** (một object hoặc một mảng
collection — chính là file "⬇ Xuất" của ReqX) hoặc **file backup ReqX**. Flow
trong file backup được ghi chú bỏ qua (CLI chưa chạy Flow).

```bash
node dist-cli/reqx.mjs run api.json \
  --env staging.json --global common.json \
  --var baseUrl=http://127.0.0.1:3000 \
  --collection "Thanh toan" \
  --reporter junit,csv --out reports \
  --data users.csv --iteration-count 3 \
  --timeout 15000 --delay 200 --bail
```

| cờ | tác dụng |
|---|---|
| `--env <file>` | nạp file biến, lặp lại được, **file sau đè file trước**. Nhận Postman env (`values[]`), ReqX env (`variables{}`), hoặc map JSON trần |
| `--global <file>` | biến toàn cục (đè bởi `--env`) |
| `--var K=V` | đặt/ghi đè từng biến, ưu tiên cao nhất |
| `--base-url <url>` | base cho URL tương đối (UI dùng `localhost` của app, CLI thì cần chỉ rõ) |
| `--collection <tên>` | chỉ chạy collection khớp tên (lặp lại được) |
| `--allow-scripts` | cho chạy script của collection **import**; không có cờ thì cắt script + in cảnh báo |
| `--timeout <ms>` / `--delay <ms>` | timeout mỗi request (mặc định 30000) / nghỉ giữa hai request |
| `--bail` | dừng ngay khi có request/test fail (dừng cả loop iteration) |
| `--reporter <danh_sách>` | `junit` \| `json` \| `html` \| `csv`, ngăn bằng dấu phẩy; `none` = chỉ in stdout |
| `--out <dir>` | thư mục report. Mặc định `reqx-report/` **ngay cạnh file collection** |
| `--data <file>` | CSV hoặc JSON, mỗi dòng một iteration |
| `--iteration-count <n>` | chạy `n` lần, vòng qua các dòng data |

Tên file report lấy theo tên file collection: `api.json` → `reports/api.xml`,
`reports/api.csv`, `reports/api.json`, `reports/api.html`.

## 3. Báo cáo

- **junit** (`.xml`) — `<testsuites>` → mỗi collection × iteration một `<testsuite>`.
  Request fail vì **mạng/timeout/script crash** thành `<error>`; HTTP ngoài 2xx
  hoặc assertion fail thành `<failure>`; log đã che secret nằm trong `<system-out>`.
  Jenkins `junit 'reports/*.xml'`, GitLab `reports: junit:`, GitHub `dorny/test-reporter` parse được ngay.
- **json** (`.json`) — `schema: "reqx-run/1"`, stats + từng request (status, thời gian,
  số test, header/response đã che, `data` là dòng data tương ứng).
- **csv** (`.csv`) — mở Excel/Sheets giữ dấu tiếng Việt (có BOM), một dòng một request,
  CRLF, lỗi xuống dòng gom vào một ô.
- **html** (`.html`) — cùng mẫu báo cáo với tab Runner, gửi cho người không đọc XML.

**Che secret trong mọi báo cáo**: URL mất giá trị tham số dạng token (`?token=***`),
header có tên `authorization|cookie|token|secret|api-key|…` ghi `***`, JWT và
chuỗi `Bearer …` bị che, body cắt 4000 ký tự. Dòng data có tên cột nghi là
credential cũng in `***`.

## 4. Chạy theo bộ dữ liệu (`--data`)

`users.csv`:

```csv
username,password
minh,an-mat-khau
hoa,an-mat-khau-2
```

hoặc `users.json` = mảng object cùng tên cột. Mỗi dòng là một iteration:

```bash
node dist-cli/reqx.mjs run login.json --data users.csv --reporter junit
```

- Cột data **thắng** biến môi trường khi resolve `{{username}}`, nhưng `pm.environment.set`
  trong script vẫn ghi env thật (không ghi lên dòng data).
- Số iteration = `max(số dòng, --iteration-count, 1)`; `--iteration-count 5` với 2 dòng
  → chạy 5 lần, dòng lặp lại theo vòng (`dòng[i % 2]`).
- Report chỉ ra được dòng nào gây fail: cột `data` trong CSV/JSON, và `[username=minh]`
  trong tên testcase JUnit.
- Nếu collection không dùng `{{}}` nào trùng tên cột, CLI in cảnh báo
  "Cột data không thấy {{...}} nào dùng".

## 5. Secret không nằm trong file

Sách lược của cả app: **credential chỉ sống trong RAM**. CLI giữ nguyên:

- File biến để **trống** giá trị, rồi truyền bằng biến môi trường của hệ thống/CI:

  ```bash
  TOKEN=eyJ...  node dist-cli/reqx.mjs run api.json --env staging.json
  ```

  (Git Bash. PowerShell thì `powershell -Command "$env:TOKEN='…'; node dist-cli/reqx.mjs run …"`;
  cmd thì `set TOKEN=…&& node dist-cli/reqx.mjs run …`.)

  CLI tự nạp `process.env.TOKEN` cho `{{TOKEN}}` còn thiếu (`seedFromProcessEnv`) và in
  tên biến đã nạp — **không bao giờ in giá trị**.
- `--var TOKEN=...` vẫn được, nhưng giá trị sẽ lọt vào shell history; dùng cho biến
  không nhạy cảm.
- Collection import có `auth.token`/header `Authorization` ghi thẳng → chạy vẫn được
  nhưng nên đổi thành `{{ten_bien}}`; `env lint` sẽ nhắc.

## 6. `reqx env lint <file.json>` — soát biến trước khi chạy

```bash
node dist-cli/reqx.mjs env lint api.json --env staging.json --global common.json
```

```
reqx env lint • 12 biến dùng • 2 thiếu • 3 góp ý
✗ {{refreshToken}} không file biến nào đặt — URL/body sẽ giữ nguyên {{refreshToken}}
⚠ {{username}} khai báo ở envs/staging.json nhưng để trống — truyền bằng --var hoặc biến hệ thống khi chạy
⚠ Credential ghi thẳng trong file: Login · auth.token — đổi thành {{ten_bien}}, giá trị lấy từ biến hệ thống khi run
⚠ oldHost khai báo ở envs/staging.json nhưng collection không dùng — có phải đặt nhầm tên không?
• baseUrl khai báo 2 lần (global.json < staging.json) — "staging.json" thắng
```

| mức | khi nào | ảnh hưởng exit code |
|---|---|---|
| `✗ error` | biến `{{…}}` collection dùng, không file biến/--var/process.env nào có, script cũng không đặt | **1** |
| `⚠ warn` | biến khai báo thừa (đọc nhầm tên) · khai báo rỗng · credential ghi chết trong file | không |
| `• info` | trùng tên global/env (file sau thắng) · biến do script `pm.environment.set` đặt | không |

Không gọi mạng, không ghi file — chạy an toàn trước mỗi pipeline. 2 khi file không đọc được.

## 7. `reqx ci init` — sinh file pipeline mẫu

```bash
node dist-cli/reqx.mjs ci init --provider github --file collections/api.json --env envs/staging.json
node dist-cli/reqx.mjs ci init --provider gitlab --force
node dist-cli/reqx.mjs ci init --provider jenkins --out .
```

| provider | file tạo |
|---|---|
| `github` (mặc định) | `.github/workflows/reqx.yml` |
| `gitlab` | `.gitlab-ci.yml` |
| `jenkins` | `Jenkinsfile` |

Cả ba đều: `npm ci` → `npm run build:cli` → `node dist-cli/reqx.mjs run … --reporter junit,csv --out reports`
→ thu báo cáo JUnit. **Chỗ inject secret để trống** kèm chú thích trỏ đúng nguồn bí mật
của từng hệ thống (GitHub Secrets / GitLab CI Variables (Masked) / Jenkins Credentials),
và tên biến phải trùng `{{TEN}}` trong collection. File đã tồn tại thì từ chối ghi đè —
thêm `--force` mới ghi.

## 8. Khác biệt so với bản UI (đọc trước khi tin kết quả 100%)

1. **Transport**: không có Tauri thì CLI dùng `fetch` của Node (undici), bản `.exe` dùng
   reqwest. Header bị trình duyệt/undici cấm set tay có thể cho kết quả lệch; một số
   hành vi cookie/tiêu đề khác nhau giữa hai đường.
2. **Body lưu tạm**: `bodyStore` là IndexedDB → không có ở Node. CLI không mở lại được
   body của lần chạy trước; chỉ còn file report.
3. **Cookie jar bắt đầu rỗng** và sống trong một lần chạy (RAM), không nhận cookie từ app.
4. **Script**: collection import từ Postman/OpenAPI **bắt buộc** `--allow-scripts`; không
   cờ thì CLI cắt script và in cảnh báo (UI thì có hộp thoại duyệt).
5. `pm.sendRequest` **chưa hỗ trợ form-data** (giống UI) — script login kiểu form sẽ fail.
6. **Flow chưa chạy được** trong CLI (kế hoạch để treo, xem `docs/KeHoach_CLI_Runner.md`).
7. CLI không đọc/ghi gì ngoài: file collection, file biến, file data, và file report anh chỉ định.

## 9. Nghiệm thu

```bash
npx tsc --noEmit
npx vitest run src/lib/__tests__/cli.test.ts src/lib/__tests__/cli-report.test.ts src/lib/__tests__/cli-lint-ci.test.ts
npm run build:cli
```

Toàn bộ logic report/lint là hàm thuần (không fs, không mạng) nên test được không cần CI
thật; 15/10/2026 nghiệm thu thêm bằng server Node cục bộ: `--data` 2 dòng × 2 request,
4 file báo cáo, `SECRETVALUE123` không xuất hiện ở file nào, `--reporter` sai tên → exit 2,
`env lint` thiếu biến → exit 1, `ci init` không `--force` → exit 2.
