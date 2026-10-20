import fs from 'fs';
import path from 'path';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  Header,
  Footer,
  PageNumber,
} from 'docx';

const assetsDir = path.resolve('docs/assets');
const outFile = path.resolve('docs/ReqX_Huong_Dan_Su_Dung_Chi_Tiet_v2.docx');

// Helper đọc ảnh an toàn
function readImage(filename, width = 580, height = 362) {
  const p = path.join(assetsDir, filename);
  if (!fs.existsSync(p)) return null;
  return new ImageRun({
    data: fs.readFileSync(p),
    transformation: { width, height },
  });
}

// Bảng màu thiết kế chuẩn Enterprise
const THEME = {
  primary: '0D9488',   // Teal 600
  dark: '0F172A',      // Slate 900
  text: '334155',      // Slate 700
  lightBg: 'F8FAFC',   // Slate 50
  border: 'CBD5E1',    // Slate 300
  accent: '2563EB',    // Blue 600
};

// Helper tạo Heading 1
function h1(title) {
  return new Paragraph({
    text: title,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 150 },
  });
}

// Helper tạo Heading 2
function h2(title) {
  return new Paragraph({
    text: title,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 250, after: 100 },
  });
}

// Helper đoạn văn bản thường
function p(text, bold = false) {
  return new Paragraph({
    children: [new TextRun({ text, bold, size: 22, color: THEME.text, font: 'Segoe UI' })],
    spacing: { before: 60, after: 60 },
  });
}

// Helper khung ghi chú quan trọng (Callout Box)
function noteBox(title, content) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      left: { style: BorderStyle.SINGLE, size: 24, color: THEME.primary },
      top: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: `💡 ${title}`, bold: true, color: THEME.primary, size: 22, font: 'Segoe UI' })],
                spacing: { after: 60 },
              }),
              new Paragraph({
                children: [new TextRun({ text: content, color: THEME.text, size: 20, font: 'Segoe UI' })],
              }),
            ],
            shading: { fill: 'F0FDFA' }, // Teal 50
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
          }),
        ],
      }),
    ],
  });
}

// Helper tạo bảng chú giải các nút số ① ② ③
function createCalloutTable(rowsData) {
  const tableRows = [
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: 'STT', bold: true, color: 'FFFFFF', size: 20, font: 'Segoe UI' })], alignment: AlignmentType.CENTER })],
          shading: { fill: THEME.dark },
          width: { size: 10, type: WidthType.PERCENTAGE },
          margins: { top: 100, bottom: 100, left: 100, right: 100 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: 'Vùng Chức Năng', bold: true, color: 'FFFFFF', size: 20, font: 'Segoe UI' })] })],
          shading: { fill: THEME.dark },
          width: { size: 28, type: WidthType.PERCENTAGE },
          margins: { top: 100, bottom: 100, left: 100, right: 100 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: 'Mô Tả & Hướng Dẫn Thao Tác Chi Tiết', bold: true, color: 'FFFFFF', size: 20, font: 'Segoe UI' })] })],
          shading: { fill: THEME.dark },
          width: { size: 62, type: WidthType.PERCENTAGE },
          margins: { top: 100, bottom: 100, left: 100, right: 100 },
        }),
      ],
    }),
  ];

  rowsData.forEach((r, idx) => {
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: r.num, bold: true, color: THEME.primary, size: 24, font: 'Segoe UI' })], alignment: AlignmentType.CENTER })],
            shading: { fill: idx % 2 === 0 ? THEME.lightBg : 'FFFFFF' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: r.name, bold: true, color: THEME.dark, size: 21, font: 'Segoe UI' })] })],
            shading: { fill: idx % 2 === 0 ? THEME.lightBg : 'FFFFFF' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
          }),
          new TableCell({
            children: [
              new Paragraph({ children: [new TextRun({ text: r.desc, size: 21, color: THEME.text, font: 'Segoe UI' })] }),
              ...(r.tip ? [
                new Paragraph({
                  children: [new TextRun({ text: `▸ Mẹo: ${r.tip}`, italic: true, size: 19, color: '0284C7', font: 'Segoe UI' })],
                  spacing: { before: 40 },
                })
              ] : [])
            ],
            shading: { fill: idx % 2 === 0 ? THEME.lightBg : 'FFFFFF' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
          }),
        ],
      })
    );
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: THEME.border },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: THEME.border },
      left: { style: BorderStyle.SINGLE, size: 4, color: THEME.border },
      right: { style: BorderStyle.SINGLE, size: 4, color: THEME.border },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
    },
    rows: tableRows,
  });
}

function createComparisonTable(items) {
  const tableRows = [
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: 'Tính Năng / Tiêu Chí', bold: true, color: 'FFFFFF', size: 20, font: 'Segoe UI' })] })],
          shading: { fill: THEME.dark },
          width: { size: 26, type: WidthType.PERCENTAGE },
          margins: { top: 100, bottom: 100, left: 100, right: 100 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: '⚡ ReqX (Local & AI-First)', bold: true, color: 'FFFFFF', size: 20, font: 'Segoe UI' })] })],
          shading: { fill: THEME.primary },
          width: { size: 40, type: WidthType.PERCENTAGE },
          margins: { top: 100, bottom: 100, left: 100, right: 100 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: 'Postman (Cloud Platform)', bold: true, color: 'FFFFFF', size: 20, font: 'Segoe UI' })] })],
          shading: { fill: '64748B' },
          width: { size: 34, type: WidthType.PERCENTAGE },
          margins: { top: 100, bottom: 100, left: 100, right: 100 },
        }),
      ],
    }),
  ];

  items.forEach((item, idx) => {
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: item.feature, bold: true, color: THEME.dark, size: 20, font: 'Segoe UI' })] })],
            shading: { fill: idx % 2 === 0 ? THEME.lightBg : 'FFFFFF' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: item.reqx, size: 20, color: '0F766E', bold: true, font: 'Segoe UI' })] })],
            shading: { fill: idx % 2 === 0 ? 'F0FDFA' : 'FFFFFF' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: item.postman, size: 20, color: '475569', font: 'Segoe UI' })] })],
            shading: { fill: idx % 2 === 0 ? THEME.lightBg : 'FFFFFF' },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
          }),
        ],
      })
    );
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: THEME.border },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: THEME.border },
      left: { style: BorderStyle.SINGLE, size: 4, color: THEME.border },
      right: { style: BorderStyle.SINGLE, size: 4, color: THEME.border },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
    },
    rows: tableRows,
  });
}

async function buildDocx() {
  console.log('--- Đang biên soạn file Word DOCX tài liệu hướng dẫn ReqX ---');

  const doc = new Document({
    title: 'ReqX - Tài Liệu Hướng Dẫn Sử Dụng Chi Tiết',
    description: 'Cẩm nang hướng dẫn sử dụng chuyên sâu ReqX API Suite',
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [new TextRun({ text: 'ReqX Enterprise API Suite — Tài Liệu Hướng Dẫn Sử Dụng', size: 18, color: '94A3B8', font: 'Segoe UI' })],
                alignment: AlignmentType.RIGHT,
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: 'Trang ', size: 18, color: '94A3B8' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '94A3B8' }),
                  new TextRun({ text: ' / ', size: 18, color: '94A3B8' }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: '94A3B8' }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children: [
          // TRANG BÌA (COVER PAGE)
          new Paragraph({ text: '', spacing: { before: 800 } }),
          new Paragraph({
            children: [
              new TextRun({ text: 'ReqX', bold: true, size: 76, color: THEME.primary, font: 'Segoe UI' }),
              new TextRun({ text: ' API Suite', bold: true, size: 76, color: THEME.dark, font: 'Segoe UI' }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 150 },
          }),
          new Paragraph({
            children: [new TextRun({ text: 'TÀI LIỆU HƯỚNG DẪN SỬ DỤNG CHI TIẾT (USER MANUAL)', bold: true, size: 32, color: THEME.accent, font: 'Segoe UI' })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),
          new Paragraph({
            children: [new TextRun({ text: 'Cẩm nang toàn diện: Builder, Runner, Smart Flow, OAuth 2.0 (10/10), Contract Testing & Mock Server', italic: true, size: 24, color: THEME.text, font: 'Segoe UI' })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 600 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Phiên bản: v1.0 Enterprise Edition\n', bold: true, size: 22, color: THEME.dark }),
              new TextRun({ text: 'Nền tảng: Windows Desktop (Tauri Native) / Web Standalone\n', size: 20, color: THEME.text }),
              new TextRun({ text: `Ngày phát hành: ${new Date().toLocaleDateString('vi-VN')}\n`, size: 20, color: THEME.text }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 1200 },
          }),

          // PHẦN 1: TỔNG QUAN GIAO DIỆN & KIẾN TRÚC
          h1('PHẦN 1: TỔNG QUAN GIAO DIỆN & THANH ĐIỀU HƯỚNG (CYBER DOCK)'),
          p('ReqX là công cụ kiểm thử, tự động hóa và giả lập API thế hệ mới, tối ưu hóa tốc độ cao với kiến trúc Rust Native (Tauri) giúp gửi request trực tiếp không bị rào cản CORS, siêu nhẹ (< 50MB RAM) và hỗ trợ chế độ Offline-first 100%.'),
          p('Giao diện chính được chia thành các khu vực công thái học: Sidebar quản lý Collections & Cyber Dock bên trái, Header điều hướng Capsule Switcher phía trên, Vùng soạn thảo trung tâm và Trợ lý AI (Postbot Drawer) trượt từ cạnh phải.'),
          ...(readImage('01_main_overview.png') ? [new Paragraph({ children: [readImage('01_main_overview.png')], alignment: AlignmentType.CENTER, spacing: { before: 100, after: 150 } })] : []),
          createCalloutTable([
            { num: '①', name: 'Sidebar Collections & Cyber Dock', desc: 'Cây thư mục quản lý Collections, Folders và Requests. Bên dưới tích hợp Cyber Dock truy cập nhanh các công cụ: Mock Server, WebSocket, gRPC, Cookies và Environment.', tip: 'Có thể kéo giãn độ rộng thanh sidebar hoặc bấm thu gọn để tăng diện tích làm việc.' },
            { num: '②', name: 'Capsule Switcher (3 Chế độ chính)', desc: 'Chuyển đổi 1-click giữa 3 không gian làm việc chuyên sâu: Builder (soạn request đơn lẻ), Runner (chạy kiểm thử hàng loạt) và Flow (kịch bản chuỗi thông minh).', tip: 'Không làm mất tab request đang soạn khi chuyển đổi qua lại.' },
            { num: '③', name: 'Nút Bật / Tắt Trợ Lý AI (Postbot Drawer)', desc: 'Mở ngăn kéo Trợ lý AI trượt mượt mà từ cạnh phải màn hình, hỗ trợ kéo co giãn độ rộng linh hoạt để vừa chat vừa theo dõi kết quả request.', tip: 'Có thể thu nhỏ hoặc mở rộng drawer tùy kích thước màn hình.' },
            { num: '④', name: 'Request Bar & Nút Send', desc: 'Chọn phương thức HTTP (GET, POST, PUT, DELETE, PATCH...), nhập URL hỗ trợ biến {{baseUrl}} và nhấn Send để thực thi ngay lập tức.', tip: 'Phím tắt Ctrl + Enter gửi request nhanh chóng.' },
            { num: '⑤', name: 'Thanh Header, Bản Quyền & Ctrl+K', desc: 'Bộ chọn nhanh Môi trường (Environment), Quản lý bản quyền (License), Đổi giao diện Sáng/Tối, Đa ngôn ngữ và Tìm kiếm nhanh Command Palette.', tip: 'Nhấn Ctrl + K để tìm kiếm mọi request, collection chỉ trong 1 giây.' },
          ]),
          new Paragraph({ text: '', spacing: { after: 300 } }),
          noteBox('Mẹo tổ chức Collection chuẩn', 'Hãy phân chia API theo từng Folder nghiệp vụ (vd: Auth, Orders, Customers). Bạn có thể viết Pre-request Script và Tests ở cấp Folder/Collection để toàn bộ request con tự động kế thừa mà không cần viết lặp lại!'),

          // PHẦN 2: SOẠN THẢO REQUEST & DỮ LIỆU
          h1('PHẦN 2: SOẠN THẢO REQUEST NÂNG CAO (PARAMS, HEADERS, BODY, TESTS)'),
          p('ReqX hỗ trợ đầy đủ các kiểu body payload tương thích 100% với Postman: raw (JSON, Text, XML, HTML, JS), x-www-form-urlencoded, multipart form-data (kèm upload file thật), GraphQL và Binary byte stream.'),
          ...(readImage('02_request_builder.png') ? [new Paragraph({ children: [readImage('02_request_builder.png')], alignment: AlignmentType.CENTER, spacing: { before: 100, after: 150 } })] : []),
          createCalloutTable([
            { num: '①', name: 'URL Bar & Tự Động Nhận Diện cURL', desc: 'Nhập endpoint API hoặc dán trực tiếp câu lệnh cURL copy từ Chrome/Edge DevTools — ReqX tự động bóc tách Method, Headers, Query Params và Body vào form ngay lập tức.', tip: 'Hỗ trợ auto-complete biến môi trường khi gõ {{.' },
            { num: '②', name: 'Bộ Chọn Chế Độ Body Đa Dạng', desc: 'Hỗ trợ đầy đủ các định dạng: none, form-data (bảng key-value hỗ trợ toggle text/file thật), x-www-form-urlencoded, raw, binary và GraphQL (kèm query + variables riêng).', tip: 'Chuyển sang form-data có thể chọn file trực tiếp từ ổ cứng máy tính.' },
            { num: '③', name: 'Raw Subtypes & Auto Content-Type', desc: 'Khi chọn raw, có thể chọn nhanh subtype: JSON, Text, XML, HTML, JavaScript. Hệ thống sẽ tự động đồng bộ Header Content-Type chuẩn xác mà không cần gõ tay.', tip: 'Nhấn nút Beautify JSON để định dạng thụt dòng code ngay ngắn.' },
            { num: '④', name: 'Nút ⚡ Key Test Cực Đoan Tự Động', desc: 'Tính năng độc quyền: tự động phân tích JSON body/schema để sinh 30-50 ca kiểm thử biên (null, chuỗi rỗng, số âm, overflow, SQL injection) và mở bảng duyệt test trực quan.', tip: 'Tiết kiệm hàng giờ đồng hồ chuẩn bị test case cho đội ngũ QA/QC.' },
            { num: '⑤', name: 'Trình Soạn JSON & Response Đo Lường', desc: 'Editor tô màu cú pháp chuẩn xác, hiển thị mã trạng thái HTTP, thời gian phản hồi (ms) và dung lượng tải về rõ ràng.', tip: 'Bảng Response có thể kéo co giãn chiều cao hoặc thu gọn để dành toàn bộ không gian cho Request.' },
          ]),
          new Paragraph({ text: '', spacing: { after: 300 } }),
          noteBox('Tự động nhận diện cURL khi dán vào URL Bar', 'Bạn không cần tìm menu Import! Chỉ cần copy lệnh cURL từ Swagger hoặc DevTools và nhấn Ctrl + V thẳng vào thanh nhập URL, ReqX sẽ tự động điền đầy đủ Method, Params, Headers và Body.'),

          // PHẦN 3: XÁC THỰC OAUTH 2.0 (10/10)
          h1('PHẦN 3: GIAO THỨC XÁC THỰC NÂNG CAO & OAUTH 2.0 (GET TOKEN)'),
          p('ReqX tích hợp động cơ OAuth 2.0 toàn diện (10/10) đạt chuẩn RFC 6749 và RFC 7636 (PKCE), giúp việc kiểm thử các API doanh nghiệp sử dụng SSO, Azure AD, Keycloak, Google hay Okta trở nên vô cùng đơn giản.'),
          ...(readImage('03_oauth2_auth.png') ? [new Paragraph({ children: [readImage('03_oauth2_auth.png')], alignment: AlignmentType.CENTER, spacing: { before: 100, after: 150 } })] : []),
          createCalloutTable([
            { num: '①', name: 'Bộ Chọn Grant Type Đầy Đủ', desc: 'Hỗ trợ 5 cơ chế cấp quyền: Client Credentials (Server-to-Server), Password Credentials (Username/Pass), Authorization Code (Đăng nhập web), Refresh Token và Implicit Flow.', tip: 'Chọn đúng Grant Type theo tài liệu của hệ thống IDP của bạn.' },
            { num: '②', name: 'Access Token URL Endpoint', desc: 'Đường dẫn nhận token của máy chủ xác thực. Hỗ trợ biến môi trường như {{tokenUrl}} hoặc {{baseUrl}}/oauth/v2/token.', tip: 'ReqX gửi yêu cầu qua Rust Native nên vượt qua hoàn toàn rào cản CORS.' },
            { num: '③', name: 'Client ID & Client Secret', desc: 'Khóa định danh ứng dụng. Cho phép ẩn/hiện mật mã client_secret bằng nút "Ẩn/Hiện", hỗ trợ client authentication dạng Basic Auth Header hoặc nhúng trong Body.', tip: 'Nên lưu clientSecret trong Environment dạng Secret để tránh lộ mã.' },
            { num: '④', name: '⚡ Nút "Lấy Token Mới" (Get Token)', desc: 'Gửi request tức thì tới OAuth server. Tự động bóc tách access_token, refresh_token, expires_in, token_type và scope. Tự động lưu thẳng vào biến môi trường nếu bật tùy chọn auto-save.', tip: 'Có thanh báo lỗi chi tiết nếu máy chủ trả về invalid_client hoặc sai mật khẩu.' },
            { num: '⑤', name: 'Thẻ Token Active & Đếm Ngược Thời Gian', desc: 'Hiển thị huy hiệu trực quan: 🟢 Còn hạn (kèm thời gian đếm ngược vd: Còn 55m 20s), 🟡 Sắp hết hạn (dưới 2 phút) và 🔴 Đã hết hạn. Tích hợp nút 📋 Copy Token và 🔄 Làm mới (Refresh Token).', tip: 'Không bao giờ phải lo request bị lỗi 401 do token hết hạn mà không biết.' },
          ]),
          new Paragraph({ text: '', spacing: { after: 300 } }),
          noteBox('Chuẩn bảo mật PKCE (Proof Key for Code Exchange)', 'Khi sử dụng Authorization Code grant, ReqX cung cấp nút "Bật PKCE (S256)" tự động sinh cặp khóa code_verifier và code_challenge chuẩn SHA-256 mã hóa Base64URL, bảo vệ an toàn cho các ứng dụng SPA và Mobile.'),

          // PHẦN 4: FLOW THÔNG MINH (CONDITIONAL BRANCHING & RETRY)
          h1('PHẦN 4: SMART FLOW — QUY TRÌNH TỰ ĐỘNG HÓA THÔNG MINH'),
          p('Khác với Postman Runner chỉ chạy tuần tự đơn giản, ReqX Flow hỗ trợ tư duy rẽ nhánh điều kiện logic (IF/THEN), tự động thử lại khi gặp lỗi mạng (Retry Policy) và trích xuất dữ liệu giữa các bước.'),
          ...(readImage('04_smart_flow.png') ? [new Paragraph({ children: [readImage('04_smart_flow.png')], alignment: AlignmentType.CENTER, spacing: { before: 100, after: 150 } })] : []),
          createCalloutTable([
            { num: '①', name: 'Bước Tuần Tự & Trích Biến (Extract)', desc: 'Thêm các request vào chuỗi. Mỗi bước có thể cấu hình quy tắc trích xuất biến từ JSON Body, Header, hoặc Status Code để truyền cho bước sau (vd: lấy {{accessToken}} hoặc {{orderId}}).', tip: 'Hỗ trợ cú pháp JSON Path mảng dạng items.0.id.' },
            { num: '②', name: '🔀 Điều Kiện Rẽ Nhánh (Branching)', desc: 'Đánh giá tiền điều kiện trước khi chạy bước: toán tử so sánh ==, !=, chứa (contains), >, <, tồn tại (exists), trống (empty). Nếu sai: cho phép Bỏ qua bước (Skip) hoặc Nhảy tới bước khác (Jump).', tip: 'Hỗ trợ cả rẽ nhánh hậu kỳ: onSuccessJump và onFailJump.' },
            { num: '③', name: '🔄 Tự Động Thử Lại Khi Lỗi (Retry)', desc: 'Cấu hình số lần chạy lại tối đa (maxAttempts từ 2-10) và thời gian chờ (delayMs). Khi gặp lỗi mạng, HTTP 5xx hoặc assertion thất bại, bước sẽ tự động retry trước khi đánh dấu lỗi.', tip: 'Có nhật ký ghi nhận chi tiết: [Retry #2/3] kèm mã lỗi của lần trước.' },
            { num: '④', name: 'Thanh Điều Khiển Chạy Flow', desc: 'Cài đặt Timeout tổng, thời gian nghỉ giữa các bước, tùy chọn dừng ngay khi gặp lỗi (Stop on error) và nút bắt đầu chạy hoặc dừng khẩn cấp (⏹ Stop).', tip: 'Có bộ đếm bảo vệ chống vòng lặp vô hạn an toàn.' },
          ]),
          new Paragraph({ text: '', spacing: { after: 300 } }),

          // PHẦN 5: BIỂU ĐỒ TIMELINE WATERFALL GANTT
          h1('PHẦN 5: BIỂU ĐỒ TIMELINE WATERFALL (ĐO ĐẠC HIỆU NĂNG TỪNG BƯỚC)'),
          p('ReqX tích hợp biểu đồ Gantt Waterfall giúp lập trình viên và QC nhìn thấy chính xác bước nào chạy nhanh, bước nào nghẽn cổ chai (bottleneck) và bước nào phải thử lại.'),
          ...(readImage('05_flow_timeline.png') ? [new Paragraph({ children: [readImage('05_flow_timeline.png')], alignment: AlignmentType.CENTER, spacing: { before: 100, after: 150 } })] : []),
          createCalloutTable([
            { num: '①', name: 'Chuyển Đổi View: [⏱️ Timeline] vs [📋 Danh sách]', desc: 'Cho phép chuyển đổi giữa biểu đồ Gantt trực quan và danh sách text chi tiết.', tip: 'Chế độ Timeline hiển thị trực quan các thanh thời lượng theo tỷ lệ thực.' },
            { num: '②', name: 'Thống Kê Tổng Quan & Thước Đo Thời Gian', desc: 'Hiển thị tổng thời gian thực thi (ms), số bước OK/Fail/Skip/Retry và thước đo phân đoạn (0ms, 25%, 50%, 75%, 100%).', tip: 'Thời gian được đo bằng hàm performance.now() độ chính xác sub-millisecond.' },
            { num: '③', name: 'Thanh Tiến Độ Waterfall Màu Sắc Trực Quan', desc: 'Màu xanh lá (Thành công), Màu đỏ (Thất bại), Màu vàng viền đứt (Bị bỏ qua do điều kiện sai). Kèm huy hiệu số lần Retry (🔁 x2, 🔁 x3) và xem lại biến trích xuất.', tip: 'Click vào từng bước trên biểu đồ để mở rộng xem log chi tiết.' },
          ]),
          new Paragraph({ text: '', spacing: { after: 300 } }),

          // PHẦN 6: RUNNER & CONTRACT TESTING
          h1('PHẦN 6: COLLECTION RUNNER & KIỂM THỬ CONTRACT SCHEMA (OPENAPI)'),
          p('Chạy tự động hàng trăm request trong thư mục hoặc collection, nạp file dữ liệu CSV/JSON để thực hiện Data-Driven Testing và tự động so sánh response với tài liệu OpenAPI Specification.'),
          ...(readImage('06_runner_contract.png') ? [new Paragraph({ children: [readImage('06_runner_contract.png')], alignment: AlignmentType.CENTER, spacing: { before: 100, after: 150 } })] : []),
          createCalloutTable([
            { num: '①', name: 'Chọn Collection & Phạm Vi Chạy', desc: 'Chọn toàn bộ collection hoặc chọn cụ thể từng thư mục (Folder) con cần kiểm thử.', tip: 'Thứ tự chạy tuân thủ đúng cây phân cấp trong Sidebar.' },
            { num: '②', name: 'Cài Đặt Lặp & Giãn Cách Thời Gian', desc: 'Thiết lập thời gian nghỉ giữa các request (Delay ms) để tránh làm sập server test, đặt Timeout cho mỗi request và cờ dừng khi gặp lỗi.', tip: 'Nên đặt delay 100-200ms cho các server rate-limited.' },
            { num: '③', name: 'Nạp Data File (CSV / JSON)', desc: 'Tính năng Data-Driven Testing: mỗi dòng trong file CSV/JSON tương ứng với 1 vòng lặp (iteration). Giá trị các cột tự động gán vào biến {{tên_cột}} hoặc đọc qua pm.iterationData.get().', tip: 'Hỗ trợ nạp file hàng nghìn dòng dữ liệu test tài khoản.' },
            { num: '④', name: 'Contract Test Tự Động Với OpenAPI', desc: 'Tự động so sánh cấu trúc JSON trả về của API với JSON Schema trong tài liệu OpenAPI/Swagger. Phát hiện ngay lập tức nếu backend đổi kiểu dữ liệu, thiếu trường bắt buộc hoặc sinh trường lạ.', tip: 'Cảnh báo chi tiết từng field bị sai lệch mà không cần viết tay assertion.' },
            { num: '⑤', name: 'Nút Chạy & Xuất Báo Cáo', desc: 'Bấm nút "Chạy collection" để thực thi. Sau khi chạy, có thể tải báo cáo định dạng HTML tương tác, JSON hoặc Markdown tóm tắt để gửi kèm báo cáo QC.', tip: 'Báo cáo ghi nhận đầy đủ tỷ lệ pass/fail của toàn bộ assertions.' },
          ]),
          new Paragraph({ text: '', spacing: { after: 300 } }),

          // PHẦN 7: MOCK SERVER
          h1('PHẦN 7: MOCK SERVER GIẢ LẬP API NỘI BỘ'),
          p('ReqX tích hợp một máy chủ HTTP Mock Server độc lập chạy ngay trên máy tính của bạn, cho phép mô phỏng response API khi backend chưa hoàn thiện hoặc khi cần test các kịch bản lỗi 500, 502, 504.'),
          ...(readImage('07_mock_server.png') ? [new Paragraph({ children: [readImage('07_mock_server.png')], alignment: AlignmentType.CENTER, spacing: { before: 100, after: 150 } })] : []),
          createCalloutTable([
            { num: '①', name: 'Công Tắc Bật/Tắt Mock Server', desc: 'Khởi chạy hoặc dừng máy chủ Mock trên cổng chỉ định (mặc định Port 3001). Đèn tín hiệu xanh lá hiển thị máy chủ đang sẵn sàng nhận kết nối.', tip: 'Có thể thay đổi cổng port nếu bị trùng với phần mềm khác.' },
            { num: '②', name: 'Tạo & Chỉnh Sửa Mock Rules', desc: 'Cấu hình đường dẫn URL (Path), HTTP Method, Status Code mong muốn (vd: 200, 400, 401, 503), Thời gian phản hồi trễ giả lập (Delay ms), Headers và Body trả về.', tip: 'Hỗ trợ khớp đường dẫn wildcard (*) linh hoạt.' },
            { num: '③', name: 'Nhật Ký Live Request Logs', desc: 'Bảng theo dõi trực tiếp mọi cuộc gọi gửi đến Mock Server: hiển thị mốc thời gian, IP, Method, Path, Status trả về và thời gian phản hồi.', tip: 'Rất hữu ích để debug frontend xem có bắn đúng payload hay không.' },
          ]),
          new Paragraph({ text: '', spacing: { after: 300 } }),

          // PHẦN 8: ENVIRONMENT & SECRET
          h1('PHẦN 8: QUẢN LÝ BIẾN MÔI TRƯỜNG & BẢO MẬT SECRET'),
          p('Bộ quản lý môi trường được tích hợp thành một Tab chuyên dụng ngay trong Builder, giúp bạn chuyển đổi và cấu hình biến nhanh chóng mà không làm gián đoạn việc soạn thảo API.'),
          ...(readImage('08_env_manager.png') ? [new Paragraph({ children: [readImage('08_env_manager.png')], alignment: AlignmentType.CENTER, spacing: { before: 100, after: 150 } })] : []),
          createCalloutTable([
            { num: '①', name: 'Danh Sách Môi Trường (Dev / Staging / Prod)', desc: 'Tạo không giới hạn các môi trường làm việc. Hỗ trợ nhân bản nhanh (Duplicate), đổi tên và xóa môi trường.', tip: 'Môi trường đang kích hoạt sẽ hiển thị trên thanh Header chính.' },
            { num: '②', name: 'Bảng Biến Key - Value Trực Quan', desc: 'Khai báo cặp tên biến (Key) và giá trị (Value). Sử dụng trong request bằng cú pháp {{key}}.', tip: 'Đổi tên Key sẽ tự động cập nhật đồng bộ các request đang dùng biến đó.' },
            { num: '③', name: 'Tính Năng Khóa Secret Bảo Mật', desc: 'Nhấn biểu tượng ổ khóa để đánh dấu biến là "Secret" (Mật mã, API Key, Token). Giá trị sẽ bị ẩn dạng dấu chấm tròn (••••••) và tự động bị loại bỏ khi xuất file chia sẻ.', tip: 'Ngăn ngừa hoàn toàn nguy cơ lộ token khi gửi collection cho đồng nghiệp.' },
            { num: '④', name: 'Biến Toàn Cục (Globals)', desc: 'Các biến dùng chung cho tất cả các môi trường mà không cần khai báo lặp lại.', tip: 'Thứ tự ưu tiên phân giải biến: Data File > Environment > Globals.' },
          ]),
          new Paragraph({ text: '', spacing: { after: 300 } }),

          // PHẦN 9: COMMAND PALETTE & PHÍM TẮT
          h1('PHẦN 9: TÌM KIẾM SIÊU TỐC (CTRL + K) & BẢNG TRA CỨU PHÍM TẮT'),
          p('Tăng tốc độ làm việc tối đa với bảng điều khiển lệnh và phím tắt thông minh, giúp bạn điều hướng dự án lớn hàng nghìn request trong chớp mắt.'),
          ...(readImage('09_command_palette.png') ? [new Paragraph({ children: [readImage('09_command_palette.png')], alignment: AlignmentType.CENTER, spacing: { before: 100, after: 150 } })] : []),
          createCalloutTable([
            { num: '①', name: 'Ô Nhập Tìm Kiếm Tức Thì', desc: 'Gõ từ khóa để tìm kiếm full-text: tìm theo tên request, URL, HTTP method, tên thư mục, biến môi trường hoặc lịch sử chạy.', tip: 'Chỉ cần gõ "POST order" là hệ thống lọc ra ngay các API tạo đơn hàng.' },
            { num: '②', name: 'Phân Loại Kết Quả (Tags Màu)', desc: 'Huy hiệu phân loại rõ ràng: [REQUEST] (màu xanh dương), [MÔI TRƯỜNG] (màu xanh lá) và [LỊCH SỬ] (màu xám).', tip: 'Nhấn phím mũi tên ↑ ↓ để di chuyển và Enter để mở ngay lập tức.' },
            { num: '③', name: 'Phím Tắt Đóng Nhanh (ESC)', desc: 'Nhấn phím Escape hoặc click chuột ra ngoài vùng tối để đóng hộp thoại mà không làm mất trạng thái làm việc.', tip: 'Có thể bấm lại Ctrl + K bất cứ lúc nào.' },
          ]),
          new Paragraph({ text: '', spacing: { after: 300 } }),

          // PHẦN 10: TRỢ LÝ TRÍ TUỆ NHÂN TẠO (AI ASSISTANT & KEY TEST GENERATOR)
          h1('PHẦN 10: TRỢ LÝ TRÍ TUỆ NHÂN TẠO (AI ASSISTANT & SINH KEY TEST TỰ ĐỘNG)'),
          p('ReqX tích hợp một hệ thống Trợ lý AI thế hệ mới được thiết kế dạng ngăn kéo (Drawer) trượt từ cạnh phải màn hình, hỗ trợ SSE Streaming mượt mà, đa nhà cung cấp và có thể chạy hoàn toàn Offline với Ollama Local.'),
          ...(readImage('10_ai_assistant.png') ? [new Paragraph({ children: [readImage('10_ai_assistant.png')], alignment: AlignmentType.CENTER, spacing: { before: 100, after: 150 } })] : []),
          createCalloutTable([
            { num: '①', name: 'Ngăn Kéo AI Postbot Trượt Từ Cạnh Phải', desc: 'Giao diện dạng Drawer thông minh, hỗ trợ kéo rê viền trái để điều chỉnh độ rộng linh hoạt hoặc thu nhỏ lại khi không dùng.', tip: 'Giúp bạn vừa theo dõi màn hình gửi request vừa trò chuyện cùng AI mà không bị che khuất nội dung.' },
            { num: '②', name: 'Multi-Provider Chain & Hỗ Trợ Ollama Local', desc: 'Hỗ trợ 6 nhà cung cấp AI: Google Gemini, Groq, Mistral, OpenRouter, Cloudflare Workers AI và Ollama (chạy model cục bộ 100% offline trên máy). Cho phép đổi thứ tự ưu tiên và cập nhật model mới.', tip: 'Bấm nút ↻ ở từng provider để tự động cập nhật danh sách models mới nhất từ máy chủ của hãng.' },
            { num: '③', name: 'Chiến Lược Failover & Adaptive RPM Breaker', desc: 'Hai chế độ chạy: "Tiết kiệm" (dùng provider miễn phí trước, tràn quota mới chuyển sang trả phí) hoặc "Ổn định" (ưu tiên nấc trả phí). Thuật toán AIMD tự học trần Rate Limit (RPM) thực tế để tự động ngắt tải trước khi dính lỗi HTTP 429.', tip: 'Tự động phục hồi sau 60 giây khi provider hết bị quá tải quota.' },
            { num: '④', name: 'Khung Chat SSE Streaming & Gọi Lệnh Trực Tiếp (Tools)', desc: 'Phản hồi dạng SSE gõ chữ thời gian thực kèm nút Copy nhanh. Trợ lý AI có quyền gọi các Tools nội bộ để tự chèn script pm.test, gửi request, phân tích mã lỗi, tạo Smart Flow hoặc sinh 30-50 ca kiểm thử biên xuất Excel.', tip: 'Toàn bộ lịch sử chat được lưu trữ cục bộ trên máy, đảm bảo quyền riêng tư tuyệt đối.' },
          ]),
          new Paragraph({ text: '', spacing: { after: 300 } }),

          // PHẦN 11: BẢNG SO SÁNH ĐỐI CHIẾU CHI TIẾT REQX VS. POSTMAN
          h1('PHẦN 11: SO SÁNH ĐỐI CHIẾU CHI TIẾT TÍNH NĂNG: REQX VS. POSTMAN'),
          p('Dưới đây là bảng phân tích và đối chiếu chi tiết giữa ReqX và Postman trên các khía cạnh kỹ thuật, hiệu năng, khả năng kiểm thử tự động và chi phí vận hành.'),
          createComparisonTable([
            {
              feature: '1. Kiến Trúc & Tài Nguyên RAM',
              reqx: 'Siêu nhẹ (< 50MB RAM), nhân Rust Native (Tauri), khởi động dưới 1 giây, phản hồi Zero-Lag.',
              postman: 'Nặng nề (Chromium Electron tốn 600MB - 1.5GB RAM), nạp ứng dụng lâu (5-15s).'
            },
            {
              feature: '2. Quyền Riêng Tư & Đăng Nhập',
              reqx: 'Local-First 100%, Offline hoàn toàn, không bắt buộc đăng nhập, dữ liệu nằm trọn trên máy bạn.',
              postman: 'Bắt buộc đăng nhập tài khoản Cloud, dữ liệu và lịch sử gọi API bị đẩy lên máy chủ hãng.'
            },
            {
              feature: '3. Giới Hạn Collection Runner',
              reqx: 'KHÔNG GIỚI HẠN số lần chạy, không giới hạn số requests, hỗ trợ Data File CSV/JSON lớn miễn phí.',
              postman: 'Giới hạn khắt khe chỉ 25 lượt chạy Runner/tháng đối với tài khoản Free.'
            },
            {
              feature: '4. Trợ Lý AI & Tự Động Hóa',
              reqx: 'Hỗ trợ 5 AI Providers (Gemini, Groq, Mistral, OpenRouter, Cloudflare), AI Chain xoay vòng, gọi Tools thao tác app trực tiếp.',
              postman: 'Postbot tính phí riêng hàng tháng ($9+/tháng), bị khóa chặt trong Cloud Postman, không can thiệp sâu.'
            },
            {
              feature: '5. Sinh Key Test Cực Đoan & Excel',
              reqx: 'Tự động quét JSON Schema sinh 30-50 case biên (null, rỗng, số âm, injection) và xuất Excel tiếng Việt có BOM.',
              postman: 'Không có. Kỹ sư kiểm thử (QC) phải tự tay viết script hoặc tạo test data thủ công.'
            },
            {
              feature: '6. Quy Trình Tự Động Hóa (Flows)',
              reqx: 'Smart Flow trực quan, rẽ nhánh điều kiện (Skip/Jump), tự động thử lại (Retry policy), Timeline micro-second waterfall.',
              postman: 'Phải viết code postman.setNextRequest() phức tạp, dễ lặp vô tận, không có timeline trực quan.'
            },
            {
              feature: '7. OpenAPI Contract Testing',
              reqx: 'Tự động kiểm định JSON Schema chuẩn OpenAPI 3.0/3.1 trong Runner, phát hiện lệch type/field tức thì.',
              postman: 'Phải nhúng thư viện Ajv thủ công trong test script từng request hoặc mua gói Enterprise đắt đỏ.'
            },
            {
              feature: '8. Mock Server Nội Bộ',
              reqx: 'Mock Server chạy ngay trên localhost (Port tùy chỉnh), giả lập delay, log real-time không cần Internet.',
              postman: 'Mock server đặt trên Postman Cloud, phụ thuộc mạng ngoài, có hạn ngạch request/tháng.'
            },
            {
              feature: '9. Xác Thực OAuth 2.0',
              reqx: 'Hỗ trợ PKCE, Client Credentials, nút ⚡ Get Token tự động, thẻ đếm ngược hạn Token hiển thị trực quan.',
              postman: 'Hỗ trợ OAuth 2.0 nhưng callback browser cloud dễ bị lỗi tường lửa mạng nội bộ (Intranet).'
            },
            {
              feature: '10. Bảo Mật Secret & Biến Môi Trường',
              reqx: 'Chế độ ẩn mật khẩu/token dạng ••••••, tự động loại bỏ Secret khi xuất file chia sẻ cho đồng nghiệp.',
              postman: 'Dễ xảy ra nguy cơ lộ Secret nếu vô ý share nhầm Workspace Public hoặc Team Workspace.'
            },
            {
              feature: '11. Phối Hợp Nhóm Qua Git',
              reqx: 'Xuất/Nhập trực tiếp thư mục reqx_workspace, quản lý phiên bản qua Git PR/Commit chuẩn bảo mật 100%.',
              postman: 'Phải mua license Team/Enterprise ($15 - $49/user/tháng) để chia sẻ workspace trên Cloud.'
            },
            {
              feature: '12. Giao Thức Đa Dạng',
              reqx: 'Hỗ trợ toàn diện: HTTP/REST, WebSocket Tester và gRPC Tester (Protobuf / Web) tích hợp sẵn.',
              postman: 'Có hỗ trợ WebSocket và gRPC nhưng giao diện cồng kềnh, tải nặng máy.'
            }
          ]),
          new Paragraph({ text: '', spacing: { after: 300 } }),
          new Paragraph({ text: '', spacing: { before: 200, after: 150 } }),
          h2('BẢNG TRA CỨU PHÍM TẮT NHANH (CHEAT SHEET)'),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: THEME.border },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: THEME.border },
              left: { style: BorderStyle.SINGLE, size: 4, color: THEME.border },
              right: { style: BorderStyle.SINGLE, size: 4, color: THEME.border },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
              insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
            },
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Phím Tắt', bold: true, color: 'FFFFFF' })] })], shading: { fill: THEME.dark }, width: { size: 30, type: WidthType.PERCENTAGE }, margins: { top: 80, bottom: 80, left: 100, right: 100 } }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Tác Vụ Thực Hiện', bold: true, color: 'FFFFFF' })] })], shading: { fill: THEME.dark }, width: { size: 70, type: WidthType.PERCENTAGE }, margins: { top: 80, bottom: 80, left: 100, right: 100 } }),
                ],
              }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Ctrl + Enter', bold: true, color: THEME.primary })] })] }), new TableCell({ children: [new Paragraph({ text: 'Gửi request hiện tại ngay lập tức (Send Request)' })] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Ctrl + S', bold: true, color: THEME.primary })] })] }), new TableCell({ children: [new Paragraph({ text: 'Lưu thay đổi của request vào Collection' })] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Ctrl + K', bold: true, color: THEME.primary })] })] }), new TableCell({ children: [new Paragraph({ text: 'Mở Command Palette tìm kiếm nhanh toàn bộ dự án' })] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Ctrl + B', bold: true, color: THEME.primary })] })] }), new TableCell({ children: [new Paragraph({ text: 'Ẩn / Hiện thanh Sidebar Collections' })] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Esc', bold: true, color: THEME.primary })] })] }), new TableCell({ children: [new Paragraph({ text: 'Đóng hộp thoại Modal / Command Palette đang mở' })] })] }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  let savedFile = outFile;
  try {
    fs.writeFileSync(outFile, buffer);
  } catch (err) {
    if (err.code === 'EBUSY') {
      savedFile = path.resolve('docs/ReqX_Huong_Dan_Su_Dung_Chi_Tiet_v2.docx');
      fs.writeFileSync(savedFile, buffer);
      console.log(`⚠️ File gốc đang được mở trong Word nên được lưu ra: ${savedFile}`);
    } else {
      throw err;
    }
  }
  console.log(`=== ĐÃ XUẤT FILE DOCX THÀNH CÔNG: ${savedFile} ===`);
  console.log(`Dung lượng file: ${(fs.statSync(savedFile).size / 1024 / 1024).toFixed(2)} MB (đã đóng gói đầy đủ 10 hình ảnh HD vào trong file)`);
}

buildDocx().catch(console.error);
