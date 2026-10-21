# Gọi gRPC từ app (gRPC-Web)

View **🚀 gRPC**: gọi **unary RPC** trực tiếp từ browser, không cần codegen —
dán (hoặc import) `.proto`, chọn service/method, nhập body JSON, bấm gửi.

## Chuẩn bị server

Browser **không** nói được gRPC原生 (cần HTTP/2 trailers), nên server phải
hiểu **gRPC-Web**. Có 3 cách:

1. **Server hỗ trợ sẵn**: bật gRPC-Web trong framework (ví dụ `grpcweb`
   wrapper của Go `net/http`, ASP.NET Core `Grpc.AspNetCore.Web`, NestJS…).
2. **Envoy proxy** (khuyên dùng production): route `/package.Service/*`
   với `grpc_web` filter về backend gRPC.
3. **grpcwebproxy** (test local nhanh):
   ```bash
   grpcwebproxy --backend_addr=localhost:50051 --run_tls_server=false \
     --allow_all_origins --server_http_debug_port=8080
   ```
   Rồi đặt Base URL trong app là `http://localhost:8080`.

**CORS**: origin của app (`http://localhost:1420` khi dev) phải được cho phép,
và phải expose header `grpc-status`, `grpc-message`.

## Dùng trong app

1. Nạp `.proto`: dán trực tiếp, **📁 Từ file…**, **Tải URL** (server chứa
   `.proto` cần mở CORS), hoặc **Ví dụ mẫu** (`hello.Greeter/SayHello`).
2. Chọn Service → Method (method streaming bị gắn `(streaming ✕)` — bản web
   chưa gọi được).
3. Base URL = địa chỉ proxy gRPC-Web (hỗ trợ `{{biến}}`). URL đầy đủ hiện ngay
   bên dưới: `base/package.Service/Method`.
4. Metadata (headers gRPC, ví dụ `authorization: Bearer {{token}}`).
5. Body JSON theo message `inputType` (protobufjs `verify` sẽ báo field sai
   kiểu/thiếu — lỗi hiện ngay, chưa gửi request).
6. **Gửi gRPC** → hiện `grpc-status` (0 = OK), message, thời gian, JSON response.

## Thử local không cần server thật

- Viết server gRPC mẫu 20 dòng (Node `@grpc/grpc-js` hoặc Python `grpcio`)
  với `hello.proto` trong app mẫu, chạy ở `:50051`, trước nó chạy
  `grpcwebproxy` ở `:8080`, Base URL `http://localhost:8080`.
- Hoặc dùng server echo gRPC-Web công cộng (nếu còn hoạt động).

## Giới hạn bản web

- Chỉ **unary** (1 request → 1 response). Server/client/bidi streaming cần
  HTTP/2 trailers → phải đợi bản Tauri (dùng tonic qua Rust command).
- JSON ↔ protobuf: `bytes` trả về base64 string, `int64` trả về string
  (tránh tràn số JS), enum trả về tên.
- Không đọc được file `.proto` có `import` file khác (chỉ dùng proto tự chứa).
