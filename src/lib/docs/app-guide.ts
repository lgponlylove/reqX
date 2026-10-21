/**
 * Tài liệu hướng dẫn sử dụng và cẩm nang tính năng của ReqX API Client.
 * Cung cấp tài liệu tra cứu theo chủ đề phục vụ Trợ lý AI (Postbot) và giao diện người dùng.
 */

export interface DocTopic {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  content: string;
}

export const DOC_TOPICS: DocTopic[] = [
  {
    id: 'overview',
    title: 'Tổng quan giao diện & Điều hướng (Overview & CyberDock)',
    summary: 'Kiến trúc giao diện Dark Cyber Glass, thanh CyberDock, TabBar và Capsule Switcher.',
    keywords: ['giao diện', 'overview', 'cyberdock', 'sidebar', 'tab', 'dock', 'bố cục', 'layout'],
    content: `# Tổng quan Giao diện & Điều hướng ReqX

ReqX là ứng dụng API Client & Automation Suite nội bộ (Local-First), thiết kế theo phong cách Dark Cyber Glass với hiệu năng tức thì (Zero-Lag).

## 1. Các khu vực chính trên giao diện:
- **Thanh Header trên cùng**:
  - **Capsule Switcher**: Chuyển nhanh giữa 3 không gian làm việc chính:
    - \`Builder\`: Soạn thảo và gửi request HTTP, kiểm tra response.
    - \`Runner\`: Chạy tự động hàng loạt collection kèm báo cáo và kiểm tra schema.
    - \`Flow\`: Thiết kế luồng API kéo thả trực quan (Workflow Canvas).
  - **Bộ chọn Environment**: Chọn môi trường đang active, nút icon 🌐 để mở tab quản lý biến môi trường trực tiếp trong Builder.
  - **Nút ✨ Trợ lý AI**: Bật/tắt thanh Drawer Trợ lý AI (Postbot) sát bên phải màn hình mà không làm gián đoạn view đang mở.
  - **Command Palette (\`Ctrl + K\`)**: Tìm kiếm tức thì request, collection, biến môi trường hoặc chạy lệnh nhanh.

- **Thanh CyberDock (Bên trái)**:
  - Thanh truy cập nhanh các công cụ phụ trợ:
    - 🌐 **Môi trường (Environment)**: Mở tab chỉnh sửa biến môi trường trong Builder.
    - ⚡ **WebSocket**: Kiểm thử kết nối WebSocket thời gian thực (WS/WSS).
    - 📡 **gRPC**: Kiểm thử dịch vụ gRPC (Protobuf, Server Reflection).
    - 🎭 **Mock Server**: Khởi động server giả lập API trên localhost.
    - 🍪 **Cookies**: Xem và quản lý Cookies theo từng domain.
    - ✨ **Trợ lý AI**: Bật/tắt khung chat AI thông minh.
  - Có thể bấm nút thu gọn sidebar để mở rộng diện tích soạn thảo request.

- **Vùng làm việc (Workspace)**:
  - Nằm ở trung tâm, hiển thị TabBar chứa các tab request và tab môi trường đang mở.
  - Hỗ trợ kéo thanh phân chia dọc (Horizontal resizer) giữa bảng Request và Response giống Postman.
`,
  },
  {
    id: 'builder-requests',
    title: 'Soạn & Gửi API Request (Request Builder)',
    summary: 'Cách tạo request, chọn method, nhập URL, cấu hình Params, Headers, Body, Auth và xem Response.',
    keywords: ['builder', 'request', 'params', 'headers', 'body', 'auth', 'post', 'get', 'json', 'multipart', 'form-data', 'response'],
    content: `# Soạn & Thực thi API Request (Request Builder)

Builder là nơi bạn cấu hình chi tiết và gửi các yêu cầu HTTP/REST API.

## 1. Thanh Request Bar
- Chọn phương thức: \`GET\`, \`POST\`, \`PUT\`, \`DELETE\`, \`PATCH\`, \`HEAD\`, \`OPTIONS\`.
- Nhập URL: Hỗ trợ biến môi trường với cú pháp \`{{ten_bien}}\` (ví dụ: \`{{base_url}}/api/v1/orders\`).
- Nút **Send** (\`Ctrl + Enter\`): Gửi request ngay lập tức.
- Nút **Save** (\`Ctrl + S\`): Lưu request vào Collection tương ứng.

## 2. Các Tab cấu hình Request:
- **Params**: Bảng Key-Value cho Query Parameters (tự động đồng bộ với URL query string).
- **Headers**: Danh sách tiêu đề HTTP. Tự động thêm \`Content-Type\` phù hợp khi chọn Body.
- **Body**:
  - \`none\`: Không gửi body.
  - \`raw (JSON)\`: Soạn JSON có tô màu cú pháp và nút **Beautify JSON** (\`Ctrl + B\`).
  - \`form-data\`: Hỗ trợ cả text key-value và upload File nhị phân thật.
  - \`x-www-form-urlencoded\`: Dữ liệu form mã hóa URL chuẩn.
  - \`binary\`: Chọn và gửi trực tiếp file nhị phân (ảnh, pdf, zip).
  - \`GraphQL\`: Soạn GraphQL Query và GraphQL Variables riêng biệt.
- **Auth**:
  - \`No Auth\`: Không kèm chứng thực.
  - \`Bearer Token\`: Nhập token (hỗ trợ \`{{token}}\`).
  - \`Basic Auth\`: Nhập Username & Password.
  - \`API Key\`: Gắn vào Header hoặc Query param tùy cấu hình.
  - \`OAuth 2.0\`: Hỗ trợ đầy đủ Client Credentials, Authorization Code + PKCE, nút tự động lấy token và đếm ngược thời gian hết hạn.
- **Pre-request & Tests**: Viết script JavaScript chạy trước và sau khi gửi request.

## 3. Bảng Response Viewer
- Hiển thị Status code, thời gian phản hồi (Latency ms), kích thước response (Size bytes).
- Xem định dạng: **Pretty** (tô màu cú pháp JSON/XML/HTML), **Raw**, **Preview** (render HTML/Ảnh), **Headers**, **Cookies**, **SSE Stream** (xem dòng sự kiện Server-Sent Events trực tiếp).
- Nút thu gọn response và thanh kéo phân chia kéo lên/xuống để chỉnh độ cao.
`,
  },
  {
    id: 'environments',
    title: 'Quản lý Biến Môi trường & Secrets (Environments)',
    summary: 'Cú pháp {{variable}}, tab Biến môi trường trong Builder, biến Globals, bảo mật Secrets.',
    keywords: ['env', 'environment', 'bien', 'bien moi truong', 'secret', 'global', 'variables', 'token'],
    content: `# Quản lý Biến Môi Trường & Khóa Bảo Mật (Environments)

ReqX hỗ trợ quản lý biến linh hoạt giúp bạn dễ dàng chuyển đổi giữa các môi trường (Dev, Staging, Production).

## 1. Mở tab Biến môi trường trong Builder
- Bấm vào nút 🌐 cạnh dropdown chọn Environment trên Header, hoặc bấm "Biến môi trường" ở CyberDock.
- ReqX sẽ mở một tab mới **🌐 Biến môi trường** ngay trên TabBar của Builder (giống trải nghiệm tab của Postman).
- Bạn có thể chuyển qua lại giữa các tab Request và tab Môi trường mà không bị mất dữ liệu soạn thảo.

## 2. Các loại phạm vi biến (Scopes):
1. **Environment Variables**: Biến thuộc môi trường cụ thể đang chọn (ví dụ: \`base_url = https://staging.api.com\`).
2. **Global Variables**: Biến dùng chung cho tất cả các môi trường (ví dụ: \`default_page_size = 20\`).
3. **Secret Variables**:
   - Dùng cho API Key nhạy cảm, mật khẩu, private key.
   - Hiển thị dưới dạng dấu chấm bảo mật (\`••••••••\`), có icon con mắt để bật xem khi cần.
   - Khi xuất Collection chia sẻ, ReqX sẽ tự động loại bỏ giá trị Secret để bảo vệ thông tin.

## 3. Cú pháp sử dụng:
- Sử dụng cú pháp 2 dấu ngoặc nhọn: \`{{ten_bien}}\`.
- Áp dụng được ở: URL, Params, Headers, Body, Auth token, Pre-request và Tests scripts.
- Khi gõ \`{{\`, ReqX sẽ hiển thị danh sách gợi ý biến tự động hoàn thành.
`,
  },
  {
    id: 'scripts-sandbox',
    title: 'Viết Scripts & Hộp cát pm.* (Pre-request & Tests)',
    summary: 'Toàn bộ cú pháp pm.environment, pm.variables, pm.sendRequest, pm.test, pm.expect và kế thừa script.',
    keywords: ['script', 'pm', 'test', 'expect', 'pre-request', 'tests', 'sandbox', 'assertion', 'sendrequest', 'truyen token'],
    content: `# Viết Scripts & Hộp Cát Sandbox pm.* (Pre-request & Tests)

ReqX tích hợp máy ảo sandbox JavaScript an toàn và tương thích cao với cú pháp Postman.

## 1. Chu trình thực thi:
1. **Pre-request Script (Collection / Folder)**
2. **Pre-request Script (Request)**
3. Gửi Request tới máy chủ thực tế
4. **Tests Script (Request)**
5. **Tests Script (Collection / Folder)**

## 2. Các hàm API pm.* được hỗ trợ:
- **Biến môi trường & Toàn cục**:
  - \`pm.environment.set("key", "value")\`: Gán biến môi trường.
  - \`pm.environment.get("key")\`: Đọc biến môi trường.
  - \`pm.environment.unset("key")\`: Xóa biến môi trường.
  - \`pm.globals.set("key", "value")\` / \`pm.globals.get("key")\`: Quản lý biến toàn cục.
  - \`pm.variables.get("key")\`: Đọc biến theo thứ tự ưu tiên (request > environment > globals).

- **Kiểm thử & Assertions (Chai.js-compatible)**:
  - \`pm.test("Mô tả test", function() { ... })\`: Khai báo 1 trường hợp kiểm thử.
  - \`pm.expect(actual).to.eql(expected)\`: So sánh bằng giá trị hoặc đối tượng.
  - \`pm.expect(res.code).to.equal(200)\`: Kiểm tra status code.
  - \`pm.response.to.have.status(200)\`: Kiểm tra nhanh mã 200.
  - \`pm.response.to.be.json\`: Đảm bảo response là JSON.
  - \`pm.expect(res.json().data).to.be.an("array")\`: Kiểm tra kiểu dữ liệu.

- **Đọc Response**:
  - \`pm.response.json()\`: Parse body response thành JSON object.
  - \`pm.response.text()\`: Lấy body dạng chuỗi nguyên văn.
  - \`pm.response.responseTime\`: Thời gian phản hồi (ms).
  - \`pm.response.headers.get("Content-Type")\`: Đọc header phản hồi.

- **Gửi Request phụ trong Script (pm.sendRequest)**:
  \`\`\`javascript
  pm.sendRequest({
    url: "https://auth.example.com/oauth/token",
    method: "POST",
    header: { "Content-Type": "application/json" },
    body: {
      mode: "raw",
      raw: JSON.stringify({ client_id: "...", client_secret: "..." })
    }
  }, function(err, res) {
    if (!err && res.code === 200) {
      pm.environment.set("access_token", res.json().access_token);
    }
  });
  \`\`\`

## 3. Mẹo truyền Token tự động:
Ở Request đăng nhập, tại tab **Tests**, thêm dòng:
\`\`\`javascript
const json = pm.response.json();
if (json.token) {
  pm.environment.set("access_token", json.token);
}
\`\`\`
Ở các request sau, tại tab **Auth** chọn **Bearer Token** và điền \`{{access_token}}\`.
`,
  },
  {
    id: 'runner-and-data',
    title: 'Chạy hàng loạt & Data-driven Testing (Runner)',
    summary: 'Chạy toàn bộ collection/folder, nạp file CSV/JSON nhiều dòng test, xuất báo cáo HTML/JUnit.',
    keywords: ['runner', 'bulk', 'csv', 'json', 'data', 'data-driven', 'report', 'junit', 'html', 'contract', 'schema'],
    content: `# Chạy Hàng Loạt & Data-Driven Testing (Runner)

Không gian làm việc **Runner** (trên Capsule Switcher hoặc phím tắt \`Ctrl + P\`) cho phép thực thi tự động toàn bộ Collection hoặc Folder.

## 1. Thiết lập Runner:
- **Chọn phạm vi**: Chọn Collection hoặc thư mục con cần chạy.
- **Iterations**: Số lần lặp lại kịch bản.
- **Delay (ms)**: Thời gian nghỉ giữa các request (tránh làm quá tải server).
- **Stop on error**: Dừng ngay khi gặp lỗi HTTP hoặc assertion thất bại.

## 2. Chạy với Data File (Data-Driven Testing):
- Hỗ trợ nhập file **CSV** hoặc **JSON**:
  - File CSV: Dòng đầu tiên là tiêu đề (tương ứng tên biến, ví dụ: \`username,password,expected_status\`).
  - File JSON: Là một mảng các đối tượng: \`[{"username": "user1", "password": "123"}, ...]\`.
- Trong request, bạn chỉ cần đặt \`{{username}}\`, \`{{password}}\`. Mỗi iteration, Runner sẽ tự nạp 1 dòng dữ liệu vào các biến đó.

## 3. OpenAPI Contract Testing tự động:
- Nếu Collection có OpenAPI spec đính kèm, Runner sẽ tự động xác thực JSON Schema của mọi response.
- Phát hiện tức thì các lỗi vi phạm hợp đồng API: thiếu trường bắt buộc (\`required\`), sai kiểu dữ liệu (\`type mismatch\`), định dạng không hợp lệ.

## 4. Báo cáo kiểm thử:
- Hiển thị trực quan tỉ lệ Pass/Fail, thời gian từng request.
- Hỗ trợ xuất file báo cáo **HTML** (giao diện đẹp mắt) và **JUnit XML** (tích hợp CI/CD).
`,
  },
  {
    id: 'flows',
    title: 'Quy trình API Tự Động Hóa (Smart Flows Canvas)',
    summary: 'Thiết kế luồng API kéo thả trực quan, rẽ nhánh điều kiện, timeline waterfall.',
    keywords: ['flow', 'flows', 'canvas', 'keo tha', 'quy trinh', 'workflow', 'branching', 'timeline', 'retry'],
    content: `# Quy trình API Tự Động Hóa (Smart Flows Canvas)

Tab **Flow** cung cấp giao diện Canvas trực quan để kết nối các API thành kịch bản nghiệp vụ phức tạp.

## 1. Tính năng cốt lõi:
- **Kéo thả Step trực quan**: Thêm request từ Collection vào Canvas và nối dây liên kết.
- **Truyền dữ liệu giữa các Step (Extract & Mapping)**:
  - Trích xuất dữ liệu từ response của Step trước (ví dụ: \`orderId = res.body.data.id\`).
  - Tự động map vào URL, Params hoặc Body của Step tiếp theo.
- **Rẽ nhánh điều kiện (Smart Branching)**:
  - Cấu hình điều kiện rẽ nhánh theo Status code hoặc nội dung body (ví dụ: Nếu \`res.status === 200\` thì sang Bước 3, nếu lỗi thì sang Bước thông báo).
  - Tùy chọn \`Skip Step\`, \`Jump to Step\`, hoặc \`Abort Flow\`.
- **Chính sách tự phục hồi (Retry Policy)**:
  - Cấu hình số lần tự động thử lại khi gặp lỗi mạng kèm độ trễ giãn cách (Backoff delay).
- **Timeline Waterfall**:
  - Hiển thị biểu đồ thời gian thực thi chi tiết đến từng mili-giây của từng step trong luồng.
`,
  },
  {
    id: 'mock-server',
    title: 'Máy Chủ Giả Lập Nội Bộ (Mock Server Engine)',
    summary: 'Chạy Mock Server trên localhost, tạo endpoint giả lập, rule matching, latency simulation.',
    keywords: ['mock', 'mock server', 'gia lap', 'localhost', 'delay', 'endpoint', 'stub'],
    content: `# Máy Chủ Giả Lập Nội Bộ (Mock Server Engine)

ReqX tích hợp sẵn một Web Server nội bộ tốc độ cao chạy trực tiếp trên máy của bạn (Localhost), giúp Frontend và Backend có thể phát triển song song.

## 1. Cách sử dụng:
1. Mở **Mock Server** từ thanh CyberDock.
2. Bấm nút **Start Server** (mặc định chạy trên cổng localhost).
3. **Thêm Mock Rule**:
   - Chọn Phương thức: \`GET\`, \`POST\`, v.v.
   - Nhập Path: ví dụ \`/api/users/profile\`.
   - Cấu hình Status code trả về: \`200 OK\`, \`400 Bad Request\`, \`500 Server Error\`.
   - Nhập Response Body (JSON, XML hoặc Text) và Headers.
4. **Mô phỏng độ trễ mạng (Latency Simulation)**:
   - Đặt thời gian trễ từ 0ms - 5000ms để kiểm thử trạng thái Skeleton/Loading của giao diện Frontend.
5. **Cửa sổ Live Request Logs**:
   - Theo dõi thời gian thực tất cả các request gửi đến Mock Server kèm header, payload và status trả về.
`,
  },
  {
    id: 'protocols',
    title: 'Giao thức Mở Rộng: WebSocket, SSE & gRPC',
    summary: 'Kiểm thử WebSocket hai chiều, theo dõi Server-Sent Events và gọi dịch vụ gRPC.',
    keywords: ['websocket', 'ws', 'wss', 'sse', 'server-sent events', 'grpc', 'protobuf', 'stream', 'cookies'],
    content: `# Giao thức Mở Rộng: WebSocket, SSE & gRPC

Ngoài REST HTTP truyền thống, ReqX hỗ trợ toàn diện các giao thức giao tiếp hiện đại:

## 1. WebSocket Tester (WS / WSS):
- Mở từ CyberDock: Nhập địa chỉ \`ws://\` hoặc \`wss://\`.
- Kết nối hai chiều thời gian thực, có hỗ trợ gửi Custom Headers khi bắt tay (Handshake).
- Soạn thảo và gửi message (JSON hoặc Text).
- Bảng lịch sử tin nhắn hiển thị trực quan các luồng tin gửi đi (Send ⬆) và nhận về (Receive ⬇) kèm timestamp.

## 2. Server-Sent Events (SSE):
- Khi gửi 1 request HTTP có response stream dạng \`text/event-stream\`, ReqX tự động kích hoạt trình xem **SSE Stream**.
- Tự động phân tách từng sự kiện (\`event\`, \`data\`, \`id\`) và cập nhật liên tục không giật lag.

## 3. gRPC Tester:
- Hỗ trợ kết nối máy chủ gRPC (gRPC & gRPC-Web).
- Hỗ trợ nạp file Proto definition (\`.proto\`) hoặc tự động khám phá qua Server Reflection.
- Gọi các phương thức Unary RPC, Client Streaming, Server Streaming và Bidirectional Streaming.

## 4. Quản lý Cookie (Cookie Manager):
- Tự động lưu trữ cookie nhận được qua header \`Set-Cookie\`.
- Cho phép xem, thêm, sửa, xóa cookie theo từng domain để kiểm thử cơ chế Session/Auth.
`,
  },
  {
    id: 'cli',
    title: 'ReqX CLI — Chạy Kiểm Thử Từ Dòng Lệnh Terminal',
    summary: 'Chạy collection từ terminal không cần mở app, cờ dòng lệnh, tích hợp CI/CD GitHub Actions.',
    keywords: ['cli', 'terminal', 'reqx', 'node', 'ci', 'cd', 'github actions', 'headless', 'bash'],
    content: `# ReqX CLI — Chạy Collection Từ Dòng Lệnh Terminal

ReqX cung cấp công cụ dòng lệnh (CLI) độc lập sử dụng chung engine kiểm thử với app, giúp bạn chạy tự động hóa trên máy trạm hoặc trong pipeline CI/CD (GitHub Actions, GitLab CI, Jenkins).

## 1. Cài đặt & Build CLI:
Tại thư mục dự án, chạy lệnh build bundle CLI (chạy bằng Node.js thông thường):
\`\`\`powershell
npm run build:cli
\`\`\`
File bundle sau khi build sẽ nằm tại \`dist-cli/reqx.mjs\`.

## 2. Cú pháp chạy lệnh:
\`\`\`powershell
node dist-cli/reqx.mjs run <file_collection.json> [options]
\`\`\`

## 3. Các cờ lệnh (Options) quan trọng:
- \`--env <file.json>\`: Nạp file biến môi trường (hỗ trợ cả format Postman lẫn ReqX).
- \`--global <file.json>\`: Nạp file biến toàn cục.
- \`--var KEY=VALUE\`: Ghi đè biến đơn lẻ với độ ưu tiên cao nhất.
- \`--collection "<ten>"\`: Chỉ chạy collection chỉ định trong file gộp.
- \`--data <file.csv/json>\`: Nạp file dữ liệu chạy nhiều lần lặp (Data-driven testing).
- \`--iteration-count <n>\`: Số lần lặp lại kịch bản.
- \`--delay <ms>\`: Thời gian nghỉ giữa các request.
- \`--timeout <ms>\`: Thời gian chờ tối đa mỗi request (mặc định 30000ms).
- \`--bail\`: Dừng ngay lập tức nếu có bất kỳ request hay test case nào thất bại.
- \`--reporter <danh_sach>\`: Chọn định dạng xuất báo cáo: \`html\`, \`junit\`, \`json\`, \`csv\`.
- \`--out <dir>\`: Thư mục chứa file báo cáo kết quả (mặc định: \`reqx-report/\`).

## 4. Ví dụ chạy thực tế:
\`\`\`powershell
node dist-cli/reqx.mjs run my-collection.json --env dev-env.json --reporter html,junit --out ./reports
\`\`\`

## 5. Mã thoát (Exit Codes) cho CI/CD:
- \`0\`: Thành công (tất cả các request và assertions đều PASS).
- \`1\`: Thất bại (có request lỗi HTTP ngoài 2xx hoặc assertion FAIL).
- \`2\`: Lỗi hệ thống (thiếu file, cú pháp sai, tham số không hợp lệ).
`,
  },
  {
    id: 'ai-assistant',
    title: 'Trợ lý AI Thông Minh (Postbot) & Lập Bộ Key Test Tự Động',
    summary: 'Chuỗi AI Chain đa nhà cung cấp, failover né 429, sinh 30-50 key test biên cực đoan và xuất Excel.',
    keywords: ['ai', 'tro ly', 'postbot', 'gemini', 'groq', 'openai', 'key test', 'test case', 'excel', 'csv', 'chain', 'rate limit'],
    content: `# Trợ lý AI Thông Minh (Postbot) & Lập Bộ Key Test Tự Động

Trợ lý AI của ReqX được thiết kế chuyên sâu cho Kỹ sư API & Tester (QA/QC), hỗ trợ tương tác trực tiếp với ứng dụng thông qua Function Calling (Tools).

## 1. Chuỗi xoay vòng AI (Multi-Provider Chain):
- Hỗ trợ cùng lúc 5 nhà cung cấp: **Google Gemini**, **Groq**, **Mistral**, **OpenRouter**, **Cloudflare Workers AI**.
- Cơ chế **Failover tự động**:
  - Chế độ \`Tiết kiệm\`: Gọi các nhà cung cấp miễn phí trước, khi hết hạn ngạch mới chuyển sang nấc trả phí.
  - Chế độ \`Ổn định\`: Ưu tiên nấc trả phí chất lượng cao nhất.
- Thuật toán **AIMD Breaker**: Tự động đo Rate Limit (RPM) để né lỗi HTTP 429, tự khóa tạm thời nấc sắp chạm trần và phục hồi sau 60 giây.

## 2. Quyền năng điều khiển ứng dụng (Tools Calling):
Trợ lý AI có thể tự động gọi các tool nội bộ để:
- Tìm kiếm, đọc chi tiết, mở và gửi request.
- Viết script Pre-request & Tests và **tự chèn trực tiếp vào request**.
- Xâu chuỗi tạo Smart Flow mới từ các request có sẵn.
- Chạy Collection Runner hoặc chạy Bulk dữ liệu và xuất file CSV.
- Đồng bộ Git Workspace (\`export_git_workspace\` / \`import_git_workspace\`).

## 3. Sinh Bộ Key Test Biên Cực Đoan (Extreme Key Test Suite):
- Khi bạn yêu cầu: *"Lên bộ key test cho request này"*, AI sẽ:
  1. Đọc và phân tích toàn bộ JSON Schema của request (kể cả object/mảng lồng nhau), query params và headers.
  2. Tự động sinh **30 - 50 test cases cực đoan**:
     - Nhóm \`null\` và rỗng: Bỏ trường bắt buộc, gửi \`null\`, chuỗi rỗng \`""\`, khoảng trắng, mảng rỗng \`[]\`, object rỗng \`{}\`, body rỗng.
     - Nhóm sai kiểu dữ liệu: Truyền chuỗi vào số, số âm, số 0, số cực lớn, ngày sai định dạng.
     - Nhóm an toàn bảo mật: Token sai/hết hạn, SQL injection mẫu, ký tự tiếng Việt đặc biệt.
  3. Mở bảng duyệt **Key Test Dialog** để bạn xem lại, tùy chỉnh mong đợi status code và bấm chạy.
  4. Xuất toàn bộ kết quả ra file **Excel (CSV UTF-8 BOM)** hiển thị tiếng Việt chuẩn xác kèm mã cURL và lý do Pass/Fail.
`,
  },
  {
    id: 'shortcuts',
    title: 'Bảng Phím Tắt Tiện Lợi (Shortcuts Cheat Sheet)',
    summary: 'Danh sách các phím tắt nhanh giúp thao tác nhanh chóng trong ReqX.',
    keywords: ['phim tat', 'shortcut', 'hotkey', 'cheat sheet', 'ctrl', 'cmd'],
    content: `# Bảng Phím Tắt Tiện Lợi (Shortcuts Cheat Sheet)

| Phím tắt | Tác dụng |
| :--- | :--- |
| **\`Ctrl + Enter\`** | Gửi request hiện tại ngay lập tức (**Send Request**) |
| **\`Ctrl + S\`** | Lưu thay đổi của request vào Collection (**Save**) |
| **\`Ctrl + N\`** | Mở một tab request mới |
| **\`Ctrl + K\`** | Mở bảng lệnh tìm kiếm nhanh (**Command Palette**) |
| **\`Ctrl + B\`** | Tự động định dạng làm đẹp JSON Body (**Beautify JSON**) |
| **\`Ctrl + \\\`** | Thu gọn hoặc mở rộng thanh Sidebar bên trái |
| **\`Ctrl + P\`** | Mở nhanh không gian làm việc Collection Runner |
| **\`Esc\`** | Đóng hộp thoại Modal / Command Palette đang hiển thị |
`,
  },
];

/**
 * Liệt kê danh mục tất cả chủ đề hướng dẫn kèm tóm tắt.
 */
export function listDocTopics(): { id: string; title: string; summary: string }[] {
  return DOC_TOPICS.map((t) => ({
    id: t.id,
    title: t.title,
    summary: t.summary,
  }));
}

/**
 * Lấy nội dung chi tiết của một chủ đề hướng dẫn theo ID hoặc từ khóa gần đúng.
 */
export function getDocTopic(topicIdOrKeyword: string): DocTopic | undefined {
  const norm = topicIdOrKeyword.trim().toLowerCase();
  if (!norm) return undefined;
  // Khớp chính xác ID
  const exact = DOC_TOPICS.find((t) => t.id === norm);
  if (exact) return exact;

  // Khớp tiêu đề hoặc ID chứa từ khóa
  return DOC_TOPICS.find(
    (t) =>
      t.id.toLowerCase().includes(norm) ||
      t.title.toLowerCase().includes(norm) ||
      t.keywords.some((k) => k.toLowerCase() === norm || k.toLowerCase().includes(norm)),
  );
}

/**
 * Tìm kiếm tài liệu theo từ khóa người dùng nhập.
 */
export function searchDocs(query: string): DocTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return DOC_TOPICS;
  const tokens = q.split(/\s+/).filter(Boolean);

  return DOC_TOPICS.filter((t) => {
    const text = `${t.id} ${t.title} ${t.summary} ${t.keywords.join(' ')} ${t.content}`.toLowerCase();
    return tokens.every((token) => text.includes(token));
  });
}
