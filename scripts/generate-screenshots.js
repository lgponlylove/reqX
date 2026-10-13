import http from 'http';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const distDir = path.resolve('dist');
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(distDir, reqPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    const indexPath = path.join(distDir, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(indexPath).pipe(res);
  }
});

const PORT = 5197;
const assetsDir = path.resolve('docs/assets');
fs.mkdirSync(assetsDir, { recursive: true });

async function run() {
  server.listen(PORT, async () => {
    console.log(`Screenshot server running on http://localhost:${PORT}`);
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const browser = await puppeteer.launch({
      executablePath: edgePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle0' });

    // Seed mock data
    await page.evaluate(() => {
      const sampleAppState = {
        state: {
          collections: [
            {
              id: 'col-auth-orders',
              name: 'E-Commerce Core API',
              folders: [
                { id: 'f-auth', name: 'Auth & Security', requestIds: ['req-login', 'req-token'], folderIds: [] },
                { id: 'f-orders', name: 'Order Management', requestIds: ['req-orders-list', 'req-create-order'], folderIds: [] }
              ],
              rootRequestIds: ['req-health']
            }
          ],
          requests: {
            'req-health': {
              id: 'req-health',
              name: 'System Health Check',
              method: 'GET',
              url: '{{baseUrl}}/health',
              params: [],
              headers: [],
              bodyType: 'none',
              body: '',
              auth: { type: 'none' },
              updatedAt: Date.now()
            },
            'req-login': {
              id: 'req-login',
              name: 'User Login & Issue Token',
              method: 'POST',
              url: '{{baseUrl}}/api/v1/auth/login',
              params: [],
              headers: [{ id: 'h1', key: 'Content-Type', value: 'application/json', enabled: true }],
              bodyType: 'json',
              body: '{\n  "email": "admin@reqx.dev",\n  "password": "{{adminPass}}"\n}',
              auth: {
                type: 'oauth2',
                oauth2: {
                  grantType: 'client_credentials',
                  tokenUrl: '{{baseUrl}}/oauth/token',
                  clientId: 'ecommerce-client-v2',
                  clientSecret: 'secret_live_998877',
                  scope: 'read write orders:admin',
                  clientAuth: 'header',
                  headerPrefix: 'Bearer',
                  accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlJlcVggQWRtaW4iLCJpYXQiOjE1MTYyMzkwMjIsImV4cCI6MTgwMDAwMDAwMH0.signature',
                  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlJlcVggQWRtaW4iLCJpYXQiOjE1MTYyMzkwMjIsImV4cCI6MTgwMDAwMDAwMH0.signature',
                  expiresIn: 3600,
                  issuedAt: Date.now() - 300000,
                  autoSaveVar: 'accessToken'
                }
              },
              updatedAt: Date.now()
            },
            'req-create-order': {
              id: 'req-create-order',
              name: 'Create New Order',
              method: 'POST',
              url: '{{baseUrl}}/api/v1/orders/create',
              params: [{ id: 'p1', key: 'priority', value: 'high', enabled: true }],
              headers: [{ id: 'h1', key: 'Content-Type', value: 'application/json', enabled: true }],
              bodyType: 'json',
              body: '{\n  "customerId": "CUST-8831",\n  "items": [\n    { "sku": "REQ-MACBOOK", "qty": 1, "price": 1999 }\n  ],\n  "couponCode": "DISCOUNT20"\n}',
              auth: { type: 'bearer', token: '{{accessToken}}' },
              updatedAt: Date.now()
            }
          },
          environments: [
            {
              id: 'env-prod',
              name: 'Production Cloud',
              variables: { baseUrl: 'https://api.shop-pro.vn', region: 'ap-southeast-1' }
            },
            {
              id: 'env-dev',
              name: 'Dev Localhost',
              variables: { baseUrl: 'http://localhost:8080', adminPass: 'Secret#2026' }
            }
          ],
          activeEnvId: 'env-dev',
          globals: { appName: 'ReqX-Suite' },
          envSecrets: { 'env-dev': ['adminPass'] },
          aiChain: [
            { id: 'c1', providerId: 'gemini', model: 'gemini-1.5-flash', key: 'AIzaSyDemoKeyGoogleGemini123456789', enabled: true },
            { id: 'c2', providerId: 'groq', model: 'llama-3.3-70b-versatile', key: 'gsk_demoKeyGroqHighSpeed998877', enabled: true },
            { id: 'c3', providerId: 'openrouter', model: 'anthropic/claude-3.5-sonnet', key: 'sk-or-v1-demoOpenRouter', enabled: false }
          ],
          aiChat: [
            { role: 'user', text: 'Hãy phân tích API "User Login & Issue Token" và sinh bộ test case cực đoan cho tôi.' },
            { role: 'assistant', text: 'Tôi đã phân tích request User Login & Issue Token:\n- Body JSON gồm các trường: email, password.\n- Đã tự động sinh 12 test cases biên (null, chuỗi rỗng, email sai định dạng, SQL Injection, mật khẩu vượt độ dài).\n- Đã mở bảng kiểm thử cực đoan (Key Test Suite). Bạn có thể duyệt qua và bấm "Chạy test" để xuất file Excel báo cáo!' }
          ]
        },
        version: 0
      };
      localStorage.setItem('postman-clone-storage', JSON.stringify(sampleAppState));
      localStorage.setItem('reqx_active_request_id', 'req-login');

      // Sample mock rules
      const sampleMockState = {
        state: {
          isRunning: true,
          port: 3001,
          rules: [
            {
              id: 'r1',
              name: 'Lấy thông tin đơn hàng #101',
              method: 'GET',
              path: '/api/v1/orders/101',
              status: 200,
              delayMs: 120,
              headers: [{ id: 'h1', key: 'Content-Type', value: 'application/json', enabled: true }],
              body: '{\n  "orderId": 101,\n  "status": "COMPLETED",\n  "total": 1999\n}'
            },
            {
              id: 'r2',
              name: 'Lỗi máy chủ thanh toán',
              method: 'POST',
              path: '/api/v1/checkout',
              status: 503,
              delayMs: 300,
              headers: [{ id: 'h1', key: 'Content-Type', value: 'application/json', enabled: true }],
              body: '{\n  "error": "GATEWAY_TIMEOUT",\n  "message": "Cổng thanh toán đang bảo trì"\n}'
            }
          ],
          logs: [
            { id: 'l1', timestamp: Date.now() - 60000, method: 'GET', path: '/api/v1/orders/101', status: 200, timeMs: 124 },
            { id: 'l2', timestamp: Date.now() - 15000, method: 'POST', path: '/api/v1/checkout', status: 503, timeMs: 310 }
          ]
        },
        version: 0
      };
      localStorage.setItem('reqx-mock-server-storage', JSON.stringify(sampleMockState));

      // Sample flows with correct persist key and version 2
      const sampleFlows = {
        state: {
          flows: [
            {
              id: 'flow-checkout-demo',
              name: 'Quy trình Mua hàng & Kiểm tra Token (E-Commerce)',
              createdAt: Date.now(),
              steps: [
                {
                  id: 'st-1',
                  collectionId: 'col-auth-orders',
                  requestId: 'req-login',
                  extract: [{ id: 'ex-1', from: 'body-json', path: 'access_token', name: 'accessToken' }],
                  retry: { enabled: true, maxAttempts: 3, delayMs: 1000 },
                  onSuccessJump: 'st-2'
                },
                {
                  id: 'st-2',
                  collectionId: 'col-auth-orders',
                  requestId: 'req-create-order',
                  extract: [],
                  condition: { enabled: true, varName: 'accessToken', operator: 'exists', value: '', onFalse: 'skip' }
                }
              ]
            }
          ],
          activeFlowId: 'flow-checkout-demo',
          runs: []
        },
        version: 2
      };
      localStorage.setItem('postman-clone-flows-v1', JSON.stringify(sampleFlows));
    });

    await page.reload({ waitUntil: 'networkidle0' });

    // Helper vẽ nhãn annotation callout ① ② ③
    async function addAnnotations(annotations) {
      await page.evaluate((items) => {
        document.querySelectorAll('.reqx-guide-annotation').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.className = 'reqx-guide-annotation';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:99999;';

        function find(sel) {
          if (!sel) return null;
          if (sel.startsWith('text:')) {
            const txt = sel.slice(5).toLowerCase();
            const candidates = document.querySelectorAll('button, div, span, label, h2, h3, h4, input, select');
            for (const c of candidates) {
              if (c.textContent && c.textContent.toLowerCase().includes(txt)) {
                return c;
              }
            }
            return null;
          }
          try {
            return document.querySelector(sel);
          } catch {
            return null;
          }
        }

        items.forEach((item) => {
          const el = find(item.selector);
          if (!el) return;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;

          // Khung viền viền neon
          const box = document.createElement('div');
          box.style.cssText = `
            position: absolute;
            left: ${rect.left - 4}px;
            top: ${rect.top - 4}px;
            width: ${rect.width + 8}px;
            height: ${rect.height + 8}px;
            border: 2px solid ${item.color || '#10b981'};
            border-radius: 8px;
            box-shadow: 0 0 15px ${item.glow || 'rgba(16, 185, 129, 0.4)'};
            pointer-events: none;
          `;
          overlay.appendChild(box);

          // Huy hiệu tròn số ① ② ③
          const badge = document.createElement('div');
          badge.textContent = item.number;
          badge.style.cssText = `
            position: absolute;
            left: ${rect.left - 12}px;
            top: ${rect.top - 12}px;
            width: 26px;
            height: 26px;
            background: ${item.color || '#10b981'};
            color: #ffffff;
            font-size: 13px;
            font-weight: 800;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.8), 0 0 10px ${item.glow || 'rgba(16, 185, 129, 0.8)'};
            border: 2px solid #ffffff;
            font-family: sans-serif;
            pointer-events: none;
          `;
          overlay.appendChild(badge);

          // Nhãn chú thích văn bản
          if (item.label) {
            const labelTag = document.createElement('div');
            labelTag.textContent = item.label;
            labelTag.style.cssText = `
              position: absolute;
              left: ${rect.left + 20}px;
              top: ${rect.top - 16}px;
              background: #0f172a;
              color: ${item.color || '#38bdf8'};
              font-size: 11px;
              font-weight: 700;
              padding: 2px 8px;
              border-radius: 6px;
              border: 1px solid ${item.color || '#38bdf8'};
              box-shadow: 0 2px 10px rgba(0,0,0,0.8);
              font-family: sans-serif;
              pointer-events: none;
              white-space: nowrap;
            `;
            overlay.appendChild(labelTag);
          }
        });

        document.body.appendChild(overlay);
      }, annotations);
    }

    console.log('--- Đang chụp các màn hình giao diện ReqX ---');

    // 1. Màn hình Tổng quan giao diện (Overview)
    await addAnnotations([
      { selector: 'aside', number: '①', label: 'Sidebar Collections', color: '#38bdf8' },
      { selector: 'aside > div:last-child', number: '②', label: 'Cyber Dock Tabs', color: '#10b981' },
      { selector: 'header > div:first-child', number: '③', label: 'Capsule Switcher (Builder/Runner/Flow)', color: '#f59e0b' },
      { selector: 'header > div:last-child', number: '④', label: 'Environment & Ctrl+K Search', color: '#a855f7' },
      { selector: 'text:Send', number: '⑤', label: 'Request Bar & Send', color: '#ec4899' }
    ]);
    await page.screenshot({ path: path.join(assetsDir, '01_main_overview.png') });
    console.log('✓ Đã chụp: 01_main_overview.png');

    // 2. Màn hình Request Builder & Params/Body
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => {
        if (b.textContent && b.textContent.trim() === 'Body') b.click();
      });
    });
    await new Promise(r => setTimeout(r, 400));

    await addAnnotations([
      { selector: 'input[value*="http"], input[placeholder*="URL"]', number: '①', label: 'URL Bar & Biến {{baseUrl}}', color: '#38bdf8' },
      { selector: 'text:Headers', number: '②', label: 'Request Tabs (Params, Headers, Body, Auth)', color: '#10b981' },
      { selector: 'text:Key test', number: '③', label: '⚡ Key Test Cực đoan tự động', color: '#f59e0b' },
      { selector: 'text:Mock', number: '④', label: '🎭 Chuyển đổi thành Mock Rule', color: '#a855f7' },
      { selector: 'textarea', number: '⑤', label: 'JSON Body Editor & Trình kiểm tra cú pháp', color: '#ec4899' }
    ]);
    await page.screenshot({ path: path.join(assetsDir, '02_request_builder.png') });
    console.log('✓ Đã chụp: 02_request_builder.png');

    // 3. Màn hình OAuth 2.0 (Click vào tab Auth rồi chọn OAuth 2.0)
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => {
        if (b.textContent && b.textContent.trim() === 'Auth') b.click();
      });
    });
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => {
        if (b.textContent && b.textContent.trim() === 'OAuth 2.0') b.click();
      });
    });
    await new Promise(r => setTimeout(r, 600));

    await addAnnotations([
      { selector: 'select', number: '①', label: 'Grant Type: Client Credentials / PKCE / Code', color: '#38bdf8' },
      { selector: 'input[placeholder*="oauth/token"]', number: '②', label: 'Token Endpoint URL', color: '#10b981' },
      { selector: 'input[placeholder*="client-id"]', number: '③', label: 'Client ID & Client Secret', color: '#f59e0b' },
      { selector: 'text:Lấy Token Mới', number: '④', label: '⚡ Nút Lấy Token Mới (Get Token)', color: '#ef4444' },
      { selector: 'text:Active Access Token', number: '⑤', label: 'Huy hiệu Đếm ngược thời hạn Token & Copy', color: '#8b5cf6' }
    ]);
    await page.screenshot({ path: path.join(assetsDir, '03_oauth2_auth.png') });
    console.log('✓ Đã chụp: 03_oauth2_auth.png');

    // 4. Màn hình Flow thông minh (Smart Workflow)
    await page.evaluate(() => {
      document.querySelectorAll('header button').forEach(b => {
        if (b.textContent && b.textContent.includes('Flow')) b.click();
      });
    });
    await new Promise(r => setTimeout(r, 800));

    await addAnnotations([
      { selector: 'div[class*="border border-slate-800 rounded p-3"]:first-of-type', number: '①', label: 'Bước thực thi & Trích xuất biến', color: '#38bdf8' },
      { selector: 'text:Điều kiện', number: '②', label: '🔀 Rẽ nhánh (==, !=, >, <, exists, Skip/Jump)', color: '#f59e0b' },
      { selector: 'text:Retry', number: '③', label: '🔄 Tự động thử lại khi lỗi (Delay ms, Max attempts)', color: '#ef4444' },
      { selector: 'text:Chạy Flow', number: '④', label: 'Nút Chạy Flow', color: '#10b981' }
    ]);
    await page.screenshot({ path: path.join(assetsDir, '04_smart_flow.png') });
    console.log('✓ Đã chụp: 04_smart_flow.png');

    // 5. Màn hình Flow Timeline (Chạy flow và xem Timeline)
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => {
        if (b.textContent && b.textContent.includes('Chạy Flow')) b.click();
      });
    });
    await new Promise(r => setTimeout(r, 1500));

    await addAnnotations([
      { selector: 'text:Timeline', number: '①', label: 'Chế độ xem Timeline Waterfall', color: '#38bdf8' },
      { selector: 'text:OK', number: '②', label: 'Thống kê tỷ lệ thành công & thời lượng', color: '#10b981' },
      { selector: 'div[class*="border-slate-800"]', number: '③', label: 'Thanh tiến độ Gantt & Trích xuất biến', color: '#f59e0b' }
    ]);
    await page.screenshot({ path: path.join(assetsDir, '05_flow_timeline.png') });
    console.log('✓ Đã chụp: 05_flow_timeline.png');

    // 6. Màn hình Runner & Contract Testing
    await page.evaluate(() => {
      document.querySelectorAll('header button').forEach(b => {
        if (b.textContent && b.textContent.includes('Runner')) b.click();
      });
    });
    await new Promise(r => setTimeout(r, 800));

    await addAnnotations([
      { selector: 'select', number: '①', label: 'Lựa chọn Collection & Scope chạy', color: '#38bdf8' },
      { selector: 'input[type="number"]', number: '②', label: 'Nghỉ giữa request & Timeout', color: '#f59e0b' },
      { selector: 'text:Data file', number: '③', label: 'Nạp Data File CSV/JSON (Data-Driven)', color: '#10b981' },
      { selector: 'text:So khớp response', number: '④', label: 'Contract Testing tự động so khớp Schema', color: '#a855f7' },
      { selector: 'text:Chạy collection', number: '⑤', label: 'Nút Chạy Runner hàng loạt', color: '#ec4899' }
    ]);
    await page.screenshot({ path: path.join(assetsDir, '06_runner_contract.png') });
    console.log('✓ Đã chụp: 06_runner_contract.png');

    // 7. Màn hình Mock Server
    await page.evaluate(() => {
      document.querySelectorAll('aside button').forEach(b => {
        if (b.title && b.title.includes('Mock Server')) b.click();
      });
    });
    await new Promise(r => setTimeout(r, 800));

    await addAnnotations([
      { selector: 'text:Server đang chạy', number: '①', label: 'Trạng thái Mock Server (Port 3001)', color: '#10b981' },
      { selector: 'text:+ Thêm rule', number: '②', label: 'Tạo Mock Rule giả lập Status, Delay, Body', color: '#38bdf8' },
      { selector: 'text:Lấy thông tin đơn hàng', number: '③', label: 'Danh sách Rules & Logs phản hồi Live', color: '#f59e0b' }
    ]);
    await page.screenshot({ path: path.join(assetsDir, '07_mock_server.png') });
    console.log('✓ Đã chụp: 07_mock_server.png');

    // 8. Màn hình Environment Manager
    await page.evaluate(() => {
      document.querySelectorAll('aside button').forEach(b => {
        if (b.title && b.title.includes('Environment')) b.click();
      });
    });
    await new Promise(r => setTimeout(r, 800));

    await addAnnotations([
      { selector: 'text:Dev Localhost', number: '①', label: 'Danh sách môi trường (Dev / Prod)', color: '#38bdf8' },
      { selector: 'text:baseUrl', number: '②', label: 'Bảng biến Key - Value', color: '#10b981' },
      { selector: 'text:adminPass', number: '③', label: 'Bảo mật Secret (Ẩn mật khẩu / Token)', color: '#ef4444' },
      { selector: 'text:Biến toàn cục', number: '④', label: 'Biến toàn cục (Globals)', color: '#a855f7' }
    ]);
    await page.screenshot({ path: path.join(assetsDir, '08_env_manager.png') });
    console.log('✓ Đã chụp: 08_env_manager.png');

    // 9. Màn hình Command Palette (Ctrl + K)
    await page.evaluate(() => {
      document.querySelectorAll('header button').forEach(b => {
        if (b.textContent && b.textContent.includes('Builder')) b.click();
      });
    });
    await new Promise(r => setTimeout(r, 500));
    // Nhấn Ctrl+K
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    await new Promise(r => setTimeout(r, 600));

    await addAnnotations([
      { selector: 'input[placeholder*="Tìm"]', number: '①', label: 'Ô tìm kiếm tức thì theo tên, URL, method', color: '#38bdf8' },
      { selector: 'text:REQUEST', number: '②', label: 'Phân loại kết quả (Request, Env, History)', color: '#10b981' },
      { selector: 'text:ESC', number: '③', label: 'Phím tắt điều hướng nhanh', color: '#f59e0b' }
    ]);
    await page.screenshot({ path: path.join(assetsDir, '09_command_palette.png') });
    console.log('✓ Đã chụp: 09_command_palette.png');

    // 10. Màn hình Trợ lý AI (AI Assistance)
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => {
      document.querySelectorAll('aside button').forEach(b => {
        if (b.title && (b.title.includes('AI assistance') || b.title.includes('AI'))) b.click();
      });
    });
    await new Promise(r => setTimeout(r, 800));

    await addAnnotations([
      { selector: 'text:AI Chain', number: '①', label: 'Multi-Provider Chain (Gemini, Groq, Mistral, OpenRouter, Cloudflare)', color: '#38bdf8' },
      { selector: 'text:Tiết kiệm', number: '②', label: 'Chiến lược Failover & Adaptive RPM Breaker né lỗi 429', color: '#f59e0b' },
      { selector: 'div[class*="overflow-y-auto"]', number: '③', label: 'Khung đối thoại thông minh & Tool Execution Logs', color: '#10b981' },
      { selector: 'textarea, input[placeholder*="Hỏi"]', number: '④', label: 'Ô nhập lệnh & Gợi ý sinh bộ test cực đoan tự động', color: '#a855f7' }
    ]);
    await page.screenshot({ path: path.join(assetsDir, '10_ai_assistant.png') });
    console.log('✓ Đã chụp: 10_ai_assistant.png');

    await browser.close();
    server.close();
    console.log('=== HOÀN TẤT CHỤP TOÀN BỘ 10 MÀN HÌNH CHÚ THÍCH THÀNH CÔNG ===');
  });
}

run().catch(console.error);
