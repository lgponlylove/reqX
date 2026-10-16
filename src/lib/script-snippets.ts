/**
 * Thư viện mẫu script Pre-request / Tests — **mỗi mẫu đã chạy thật qua `runPreRequest`/`runTests`**
 * (xem `__tests__/script-snippets.test.ts`) nên QA/BA bấm là dùng được, AI cũng được phép
 * copy nguyên mẫu này thay vì tự viết (hệ thống prompt tham chiếu đúng tập hàm có thật).
 *
 * Quy ước trong code mẫu: chỗ cần sửa đánh `// SỬA n:` để hiện ra trong `hint` của UI.
 */

export type SnippetKind = 'pre' | 'tests';

export interface ScriptSnippet {
  id: string;
  kind: SnippetKind;
  label: { vi: string; en: string };
  /** Những chỗ người dùng phải sửa — hiển thị cạnh tên mẫu. */
  hint: { vi: string; en: string };
  code: string;
}

/** Lấy token bằng client_credentials, cache 5 phút, gắn vào header Authorization. */
const TOKEN_CLIENT_CREDENTIALS = `// Lấy token client_credentials rồi gắn vào request hiện tại (không cần viết lại ở từng request).
// Sandbox ReqX: pm.variables.set ghi vào MÔI TRƯỜNG ĐANG CHỌN, giá trị vừa set đọc lại được ngay.
const BIEN_NHAN = 'authen-get-permissions';        // SỬA 1: tên biến chứa "Bearer <token>"
const TOKEN_URL = 'https://idp.example/oauth2/token'; // SỬA 2: URL lấy token
const CLIENT_ID = pm.variables.get('clientId');    // SỬA 3: biến chứa client_id
const CLIENT_SECRET = pm.variables.get('clientSecret'); // SỬA 4: biến chứa client_secret (nên bật 🔒 Secret)

const LANH = 5 * 60 * 1000; // 5 phút: token còn "tươi" thì không gọi IdP lagi
const lucTruoc = Number(pm.variables.get('token_lanh_at') || 0);
let giaTri = pm.variables.get(BIEN_NHAN) || '';

if (!lucTruoc || Date.now() - lucTruoc > LANH) {
  const res = await pm.sendRequest({
    url: TOKEN_URL,
    method: 'POST',
    header: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
      + '&client_id=' + encodeURIComponent(CLIENT_ID || '')
      + '&client_secret=' + encodeURIComponent(CLIENT_SECRET || ''),
  });
  if (res.code !== 200) throw new Error('Không lấy được token — HTTP ' + res.code + ': ' + res.text());
  const d = res.json();
  if (!d.access_token) throw new Error('IdP không trả access_token: ' + res.text());
  giaTri = (d.token_type || 'Bearer') + ' ' + d.access_token;
  pm.variables.set(BIEN_NHAN, giaTri);
  pm.variables.set('token_lanh_at', String(Date.now()));
}

request.headers['Authorization'] = giaTri;
`;

/** Đăng nhập bằng JSON, lấy token trong response, gắn cho request chính. */
const TOKEN_LOGIN_JSON = `// Đăng nhập kiểu form (username/password) → lấy token → gắn Authorization cho request đang gửi.
const USER = pm.variables.get('username');   // biến đã có trong môi trường
const PASS = pm.variables.get('password');   // nên bật 🔒 Secret cho biến này

const res = await pm.sendRequest({
  url: (pm.variables.get('baseUrl') || 'http://localhost:8080') + '/login', // SỬA: đường dẫn login
  method: 'POST',
  header: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
});
if (res.code >= 400) throw new Error('Login lỗi — HTTP ' + res.code + ': ' + res.text());

const d = res.json();
// SỬA: đường dẫn tới token nếu API của anh không trả đúng tên này (vd data.token)
const token = d.access_token || d.token || (d.data && d.data.token);
if (!token) throw new Error('Response login không có token: ' + res.text());

pm.variables.set('accessToken', token);
request.headers['Authorization'] = 'Bearer ' + token;
`;

/** Dấu thời gian + nonce + chữ ký HMAC (chạy trong app, cần Web Crypto). */
const SIGN_HMAC = `// Chữ ký yêu cầu kiểu X-Date + X-Signature = HMAC-SHA256(secret, body + date + nonce).
// Chạy được trong app (Web Crypto); bản CLI cũng có crypto của Node.
const BIEN_SECRET = 'hmacSecret'; // SỬA: biến chứa key, nhớ bật 🔒 Secret
const secret = pm.variables.get(BIEN_SECRET) || '';
if (!secret) throw new Error('Thiếu biến ' + BIEN_SECRET + ' để ký request.');

const date = new Date().toISOString();
const nonce = Math.random().toString(36).slice(2, 10);
const payload = (request.body || '') + date + nonce;

const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');

request.headers['X-Date'] = date;
request.headers['X-Nonce'] = nonce;
request.headers['X-Signature'] = hex;
`;

/** Không gọi mạng: chuẩn bị header/URL theo nghiệp vụ. */
const HEADER_FROM_VARS = `// Sửa request ngay trước khi gửi — không gọi API nào cả.
request.headers['X-Request-Id'] = 'req-' + Date.now();
request.headers['X-Tenant'] = pm.variables.get('tenant') || 'ACME'; // SỬA: tên biến tenant
// Đổi URL theo môi trường: bỏ comment dòng dưới rồi sửa host.
// request.url = (pm.variables.get('baseUrl') || '') + '/api/v1/orders';
`;

/** Tests: trạng thái + thời gian phản hồi. */
const TEST_STATUS_TIME = `pm.test('Status 200', () => {
  pm.response.to.have.status(200);
});
pm.test('Phản hồi dưới 2 giây', () => {
  pm.expect(pm.response.time).to.be.below(2000);
});
`;

/** Tests: các field bắt buộc phải có và không rỗng. */
const TEST_REQUIRED_FIELDS = `// SỬA: danh sách field bắt buộc theo nghiệp vụ.
const BAT_BUOC = ['id', 'code', 'createdAt'];

pm.test('Body là JSON hợp lệ', () => {
  try {
    pm.response.json();
  } catch (e) {
    throw new Error('Response không phải JSON: ' + pm.response.text().slice(0, 120));
  }
});

BAT_BUOC.forEach((f) => {
  pm.test('Có field ' + f + ' và không rỗng', () => {
    const d = pm.response.json();
    if (d === null || typeof d !== 'object' || !(f in d)) {
      throw new Error('Response thiếu field "' + f + '"');
    }
    if (String(d[f]) === '') {
      throw new Error('Field "' + f + '" rỗng');
    }
  });
});
`;

/** Tests: khung JSON theo schema (JSON Schema dựng sẵn trong app). */
const TEST_JSON_SCHEMA = `pm.test('Đúng cấu trúc mong đợi', () => {
  pm.response.to.have.jsonSchema({
    type: 'object',
    required: ['id', 'status'], // SỬA: field bắt buộc
    properties: {
      id: { type: 'number' },  // SỬA: kiểu từng field
      status: { type: 'string', enum: ['NEW', 'DONE'] },
    },
  });
});
`;

/** Tests: chắc chắn đã có token trước khi test nghiệp vụ. */
const TEST_HAS_AUTH = `// Ở bảng Tests, sandbox chỉ đưa vào 'pm' (không có object request đang gửi),
// nên mẫu này kiểm 2 thứ mà script pre-request để lại: biến token còn sống + response không bị từ chối.
const BIEN_TOKEN = 'authen-get-permissions'; // SỬA 1: tên biến mà mẫu token ghi vào

pm.test('Biến token có giá trị thật (không rỗng/không "undefined")', () => {
  const auth = pm.variables.get(BIEN_TOKEN) || '';
  if (!auth) {
    throw new Error('Biến "' + BIEN_TOKEN + '" rỗng — Pre-request chưa lấy được token.');
  }
  if (auth.includes('undefined') || auth.includes('null')) {
    throw new Error('Token lạ: ' + auth.slice(0, 40));
  }
});

pm.test('Không bị 401/403 (token được chấp nhận)', () => {
  if (pm.response.status === 401 || pm.response.status === 403) {
    throw new Error('HTTP ' + pm.response.status + ' — token hết hạn hoặc sai quyền: ' + pm.response.text().slice(0, 120));
  }
  pm.response.to.have.status(200); // SỬA 2: 201/204... nếu API của anh trả mã khác
});
`;

export const SCRIPT_SNIPPETS: ScriptSnippet[] = [
  {
    id: 'token-client-credentials',
    kind: 'pre',
    label: { vi: 'Lấy token client_credentials (cache 5 phút)', en: 'client_credentials token (5-min cache)' },
    hint: {
      vi: 'SỬA 4 chỗ: tên biến nhận token, URL token, biến client_id, biến client_secret.',
      en: 'Edit 4 spots: target var, token URL, client_id var, client_secret var.',
    },
    code: TOKEN_CLIENT_CREDENTIALS,
  },
  {
    id: 'token-login-json',
    kind: 'pre',
    label: { vi: 'Đăng nhập JSON → lấy token', en: 'JSON login → token' },
    hint: {
      vi: 'SỬA: đường dẫn login + đường dẫn token trong response.',
      en: 'Edit: login path and where the token sits in the response.',
    },
    code: TOKEN_LOGIN_JSON,
  },
  {
    id: 'sign-hmac',
    kind: 'pre',
    label: { vi: 'Ký request HMAC-SHA256 (X-Date/Nonce/Signature)', en: 'HMAC-SHA256 request signature' },
    hint: {
      vi: 'SỬA: tên biến chứa key. Đổi header theo API của anh nếu khác tên.',
      en: 'Edit: the variable holding the key; rename headers if your API differs.',
    },
    code: SIGN_HMAC,
  },
  {
    id: 'header-from-vars',
    kind: 'pre',
    label: { vi: 'Gắn header từ biến (không gọi mạng)', en: 'Set headers from variables (no network)' },
    hint: { vi: 'SỬA: tên biến tenant / đường dẫn URL.', en: 'Edit: tenant variable name / URL path.' },
    code: HEADER_FROM_VARS,
  },
  {
    id: 'test-status-time',
    kind: 'tests',
    label: { vi: 'Status 200 + dưới 2 giây', en: 'Status 200 + under 2s' },
    hint: { vi: 'Không cần sửa gì.', en: 'Ready to use.' },
    code: TEST_STATUS_TIME,
  },
  {
    id: 'test-required-fields',
    kind: 'tests',
    label: { vi: 'Field bắt buộc phải có, không rỗng', en: 'Required fields present & non-empty' },
    hint: { vi: 'SỬA: mảng `BAT_BUOC`.', en: 'Edit the `BAT_BUOC` list.' },
    code: TEST_REQUIRED_FIELDS,
  },
  {
    id: 'test-json-schema',
    kind: 'tests',
    label: { vi: 'Kiểm cấu trúc bằng JSON Schema', en: 'Validate shape with JSON Schema' },
    hint: { vi: 'SỬA: `required` + `properties` theo response thật.', en: 'Edit `required` + `properties` to match the real response.' },
    code: TEST_JSON_SCHEMA,
  },
  {
    id: 'test-has-auth',
    kind: 'tests',
    label: { vi: 'Đảm bảo token đã gắn, không 401', en: 'Ensure token attached, no 401' },
    hint: { vi: 'Dùng sau mẫu "Lấy token…".', en: 'Use right after a token snippet.' },
    code: TEST_HAS_AUTH,
  },
];

export function snippetsFor(kind: SnippetKind): ScriptSnippet[] {
  return SCRIPT_SNIPPETS.filter((s) => s.kind === kind);
}

export function snippetById(id: string): ScriptSnippet | undefined {
  return SCRIPT_SNIPPETS.find((s) => s.id === id);
}

/**
 * Mô tả sandbox `pm` cho hệ thống prompt AI + cho tooltip người dùng.
 * Viết từ danh sách hàm CÓ THẬT trong `src/lib/scripts.ts` — không phải tài liệu Postman.
 */
export const PM_SANDBOX_DOC = `SANDBOX SCRIPT ReqX (chỉ những thứ sau tồn tại — KHÔNG dùng hàm Postman khác):
- Script chạy bằng async Function: dùng được await. Total timeout 30s. console.log/warn/error → bảng Logs.
- Pre-request có: pm.environment.get/set, pm.globals.get/set, pm.variables.get/set, pm.iterationData.get/toObject,
  pm.sendRequest, và object 'request' (chỉ 3 thứ sửa được: request.url, request.headers[key], request.body).
- pm.variables.set / pm.environment.set ghi VÀO MÔI TRƯỜNG ĐANG CHỌN (không phải biến tạm như Postman);
  pm.globals.set ghi Globals. Giá trị trông như credential tự bật secret (RAM-only, không ra đĩa).
  Vừa set xong thì get lại đọc được giá trị mới ngay.
- pm.sendRequest(url | {url, method, header|headers, body}): body là CHUỖI, hoặc {mode:'urlencoded',urlencoded:[{key,value}]}.
  KHÔNG hỗ trợ form-data/formdata (ném lỗi). Trả về {code,status,headers.get(),responseTime,responseSize,text(),json()};
  dùng 'await pm.sendRequest(...)' hoặc callback '(err,res)=>' đều được.
- Tests có thêm: pm.test(name, fn) — fn PHẢI LÀ HÀM SYNC (async fn không được chờ, assertion sẽ bị bỏ qua);
  nêu lỗi bằng 'throw new Error(...)' để dòng test hiện lý do.
  pm.response.{status,statusText,time,size,headers,text(),json()},
  pm.response.to.have.status(n), pm.response.to.have.jsonSchema(obj), pm.response.to.be.success(),
  pm.expect(x).to.{equal,eql,include,matchSchema}, .to.be.{true,false,null,undefined,below(n),above(n)}, .to.have.{status(n),jsonSchema(obj)}.
- Tests KHÔNG có: pm.request (chỉ pre-request mới có object 'request'), pm.cookies, pm.visualizer,
  chuỗi '.to.not.*' (Chai), require/import, localStorage, fetch trực tiếp (dùng pm.sendRequest).
- Muốn chèn script lấy token/ký chữ ký/test field: copy nguyên mẫu trong SCRIPT_SNIPPETS (mỗi mẫu đã chạy thật),
  chỉ sửa những chỗ đánh dấu '// SỬA'.`;
