# KẾ HOẠCH DỰ ÁN: Phần Mềm API Client (Postman Clone)

> **Tên dự án (tạm):** postman-clone
> **Ngày tạo:** 18/09/2026
> **Trạng thái:** Đang lên kế hoạch (v0.1)
> **Thư mục dự án:** `D:\AI\postman-clone`

---

## 1. Tổng quan & Mục tiêu

### 1.1. Mô tả
Xây dựng phần mềm desktop/web giúp developer test API như Postman: gửi HTTP request, xem response, quản lý collections, environments, history, viết test script.

### 1.2. Mục tiêu
- Học và làm chủ: HTTP client, state management, lưu trữ local, kiến trúc app desktop.
- Có sản phẩm dùng được hàng ngày (dogfooding).
- MVP chạy được trong 2-4 tuần, sau đó mở rộng dần.

### 1.3. Đối tượng sử dụng
- Bản thân / team dev nhỏ.
- Mở rộng sau: cộng đồng dev Việt Nam.

### 1.4. Tiêu chí thành công (MVP)
- [x] Gửi được GET, POST, PUT, PATCH, DELETE với params, headers, body (JSON/raw/form) + timeout chỉnh được + nút Hủy.
- [x] Hiển thị response: status màu, time, size, body (JSON pretty highlight + raw), preview HTML, headers bảng + copy.
- [x] Lưu request vào Collection (CRUD collection, xóa request, import/export Postman v2.1). Còn lại: cây thư mục Folder + kéo-thả (Phase 2).
- [x] Biến môi trường `{{baseUrl}}` + chuyển Environment (Dev/Staging/Prod) + Globals + biến Secret (không lưu localStorage).
- [x] Lưu lịch sử (History) 100 request gần nhất + tìm kiếm + xóa từng dòng + khôi phục thành request. Persist localStorage.
- [x] Import/export Postman Collection v2.1 (JSON).

---

## 2. Phân tích tính năng

### Phase 1 — MVP (Ưu tiên cao nhất)
1. **Request Builder**
   - Method selector + URL bar + Send/Cancel.
   - Tabs: Params (query key-value, auto-append vào URL), Headers, Body (none/raw JSON/form-data/x-www-form-urlencoded), Auth (No Auth, Bearer Token, Basic, API Key).
   - Validate URL, timeout cấu hình được (mặc định 30s).
2. **Response Viewer**
   - Status code + màu sắc, thời gian (ms), dung lượng.
   - Body: Pretty (JSON highlight), Raw, Preview (HTML).
   - Headers dạng bảng + copy.
   - Lưu response mẫu (Save as Example).
3. **Collections**
   - CRUD Collection / Folder / Request (cây thư mục kéo-thả).
   - Duplicate, rename, delete (xác nhận).
   - Lưu trữ local (SQLite / JSON file / IndexedDB tùy nền tảng).
4. **Environments & Variables**
   - CRUD Environment (Dev, Staging, Prod).
   - Variable scope: Global → Environment → Collection (ưu tiên từ hẹp đến rộng).
   - Thay thế `{{var}}` trong URL/headers/body trước khi gửi.
   - Highlight biến không tồn tại.
5. **History**
   - Tự động lưu mỗi request đã gửi (method, url, time, status).
   - Tìm kiếm, xóa từng dòng / xóa tất cả, khôi phục lại thành request.
6. **Import/Export**
   - Import Postman Collection v2.1.
   - Export collection của mình ra JSON.

### Phase 2 — Nâng cao (sau MVP)
7. **Test & Scripting (Pre-request + Tests)**
   - Chạy JS sandbox (ví dụ `pm.test()`, `pm.expect()` đơn giản).
   - Hiển thị kết quả Pass/Fail.
8. **Code Generator**
   - Sinh code: cURL, JavaScript (fetch/axios), Python (requests).
9. **Tabs đa request**
   - Mở nhiều tab request cùng lúc, chưa lưu thì đánh dấu `•`.
10. **Tìm kiếm toàn cục (Ctrl+K)**
    - Tìm request trong collections/history.

### Phase 3 — Mở rộng (tương lai)
- WebSocket / Socket.IO tester.
- gRPC / GraphQL client.
- Runner: chạy cả collection + báo cáo.
- Sync cloud + chia sẻ team (cần backend).
- Plugin system.

### Tính năng KHÔNG làm trong MVP
- Sync cloud, tài khoản login.
- WebSocket/gRPC.
- API documentation generator.
- Mock server.

---

## 3. Đề xuất kiến trúc kỹ thuật

### Option A (Khuyến nghị): Desktop App — Tauri + React + TypeScript
- **Frontend:** React + Vite + TypeScript + TailwindCSS + Zustand (state) + CodeMirror (editor JSON).
- **Backend (Rust via Tauri):** Gửi HTTP thật (tránh CORS), lưu file local, gọi hệ thống.
- **Ưu:** Nhẹ (~10MB), nhanh, tránh CORS như Postman thật, học được Rust/Tauri.
- **Nhược:** Cần setup Rust, build phức tạp hơn web thuần.

### Option B: Desktop App — Electron + React + TypeScript
- Quen thuộc, dễ build, cộng đồng lớn.
- Nhược: nặng (~150MB+), tốn RAM.

### Option C: Web App — Next.js / React SPA
- Chạy ngay trên trình duyệt, deploy dễ (Vercel).
- Nhược: dính CORS khi gọi API khác domain (cần proxy server).

> **Khuyến nghị mặc định:** Option A (Tauri). Nếu bạn muốn nhanh nhất → Option C.

### Cấu trúc thư mục đề xuất
```
postman-clone/
├── docs/
│   └── KE-HOACH.md          # file này
├── src/
│   ├── components/          # RequestBar, ResponseViewer, Sidebar...
│   ├── stores/              # Zustand: request, collection, env, history
│   ├── lib/                 # http-client, variable-resolver, importer
│   ├── types/               # Request, Response, Collection, Environment
│   └── App.tsx
├── src-tauri/               # (nếu chọn Tauri)
├── package.json
└── README.md
```

### Mô hình dữ liệu (dự thảo)
```ts
type HttpMethod = 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'|'HEAD'|'OPTIONS';

interface KeyValue { key: string; value: string; enabled: boolean; }

interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;               // chứa {{var}}
  params: KeyValue[];
  headers: KeyValue[];
  bodyType: 'none'|'json'|'raw'|'form-data'|'urlencoded';
  body: string;
  auth: { type: 'none'|'bearer'|'basic'|'apikey'; token?: string; username?: string; password?: string; };
  collectionId?: string;
}

interface ApiResponse {
  status: number;
  statusText: string;
  timeMs: number;
  sizeBytes: number;
  headers: Record<string,string>;
  body: string;
}

interface Collection { id: string; name: string; folders: Folder[]; requests: ApiRequest[]; }
interface Environment { id: string; name: string; variables: Record<string,string>; }
interface HistoryItem extends ApiRequest { responseStatus: number; timeMs: number; createdAt: number; }
```

### Lưu trữ
- Tauri/Electron: SQLite (qua `tauri-plugin-sql` / `better-sqlite3`) hoặc file JSON.
- Web: IndexedDB (Dexie.js) + export JSON.

---

## 4. Lộ trình phát triển (dự kiến 4 tuần)

| Tuần | Mục tiêu | Deliverable |
|------|----------|-------------|
| 1 | Dựng khung + Request Builder + gửi HTTP | Gửi được GET/POST, xem response raw |
| 2 | Response Viewer đẹp + Collections CRUD | Lưu/mở request theo cây thư mục |
| 3 | Environments + Variables + History | `{{baseUrl}}` chạy được, history tìm kiếm được |
| 4 | Import/Export + polish + build installer | File `.exe` / bản web deploy được |

Mỗi tuần: code → test tay → chốt.

---

## 5. Rủi ro & Cách giảm thiểu
| Rủi ro | Mức | Giải pháp |
|--------|-----|-----------|
| CORS (nếu làm web) | Cao | Dùng Tauri/Electron hoặc proxy server |
| Scope phình to (muốn giống Postman 100%) | Cao | Chốt MVP 6 tính năng, Phase 2/3 để sau |
| Editor JSON nặng | Trung bình | Dùng CodeMirror, không tự viết editor |
| Test script sandbox nguy hiểm | Trung bình | Phase 2 mới làm, dùng VM cách ly |

---

## 6. Quyết định đã chốt (18/09/2026)
- Nền tảng: **Tauri + React + TypeScript** (nhẹ, tránh CORS).
- Ngôn ngữ UI: **Tiếng Việt**.
- Import Postman Collection: **Có, ngay ở MVP**.
- Tên app chính thức: *(chưa chốt — mặc định `postman-clone`)*

---

## 7. Bước tiếp theo (sau khi bạn chốt)
- [ ] Khởi tạo project (Vite + React + TS + Tailwind + Zustand).
- [ ] Định nghĩa types (`ApiRequest`, `ApiResponse`...).
- [ ] Làm màn hình chính: 3 cột (Sidebar | Request/Response | Panel phụ).
- [ ] Implement gửi HTTP + hiển thị response.

---
*File này là bản v0.1 — sẽ cập nhật sau khi bạn trả lời mục 6.*
