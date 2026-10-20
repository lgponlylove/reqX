# Hướng dẫn Build & Phát hành Đa Nền Tảng (Windows, macOS, Linux) — ReqX

ReqX được phát triển trên kiến trúc **Tauri v2 + Rust + React**, cho phép biên dịch và chạy nguyên bản (native) trên cả 3 hệ điều hành máy tính phổ biến nhất hiện nay.

---

## 1. Tự động hóa qua GitHub Actions (Khuyên dùng)

Do Apple và Linux yêu cầu môi trường hệ điều hành tương ứng để biên dịch các bộ thư viện bản địa (Cocoa/WebKit trên macOS, GTK/WebKitGTK trên Linux), cách đơn giản và chuyên nghiệp nhất là sử dụng **GitHub Actions** (được cấp máy ảo miễn phí từ GitHub).

File cấu hình đã được tạo sẵn tại: [`.github/workflows/release.yml`](file:///.github/workflows/release.yml)

### Cách kích hoạt quá trình Build tự động:

#### Cách 1: Tạo Tag phiên bản qua Git
Mỗi khi bạn muốn xuất bản một phiên bản mới, chỉ cần chạy các lệnh sau trong terminal:
```bash
# Đặt tag phiên bản mới (ví dụ v0.1.2)
git tag v0.1.2

# Đẩy tag lên GitHub
git push origin v0.1.2
```

#### Cách 2: Bấm nút thủ công trên giao diện GitHub
1. Mở trang dự án của bạn trên GitHub.
2. Chuyển sang tab **Actions** > Chọn workflow **Release Multi-Platform**.
3. Bấm nút **Run workflow**.

---

## 2. Kết quả đầu ra trên GitHub Releases

Sau khi các máy ảo của GitHub hoàn tất quá trình biên dịch (khoảng 5 - 10 phút), GitHub sẽ tự động tạo một bản phát hành mới (Release) đính kèm đầy đủ các gói cài đặt:

| Hệ điều hành | Định dạng file xuất ra | Đối tượng sử dụng |
| :--- | :--- | :--- |
| **Windows** | `ReqX_0.1.0_x64-setup.exe` / `.msi` | Windows 10, 11 (64-bit) |
| **macOS (Apple Silicon)** | `ReqX_0.1.0_aarch64.dmg` | Mac chip M1, M2, M3, M4 |
| **macOS (Intel)** | `ReqX_0.1.0_x64.dmg` | Các dòng Mac chip Intel cũ hơn |
| **Linux (AppImage)** | `ReqX_0.1.0_amd64.AppImage` | Chạy ngay không cần cài đặt trên Ubuntu, Fedora, Arch, Debian... |
| **Linux (Debian/Ubuntu)** | `ReqX_0.1.0_amd64.deb` | Gói cài đặt chuẩn cho Ubuntu/Debian (`sudo dpkg -i ...`) |

---

## 3. Cách Build trực tiếp trên máy thật (Local Development)

Nếu bạn hoặc cộng tác viên có máy tính chạy Linux hoặc macOS, có thể build trực tiếp như sau:

### Trên macOS:
1. Cài đặt các công cụ cần thiết:
   ```bash
   # Cài Rust
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   # Cài Node.js (nếu chưa có)
   ```
2. Chạy ứng dụng chế độ phát triển:
   ```bash
   npm install
   npm run tauri dev
   ```
3. Đóng gói file `.dmg`:
   ```bash
   npm run tauri build
   ```
   File `.dmg` sẽ nằm trong thư mục `src-tauri/target/release/bundle/dmg/`.

---

### Trên Linux (Ubuntu / Debian):
1. Cài đặt các thư viện hệ thống cần thiết cho Tauri v2:
   ```bash
   sudo apt update
   sudo apt install -y libwebkit2gtk-4.1-dev \
       build-essential \
       curl \
       wget \
       file \
       libxdo-dev \
       libssl-dev \
       libayatana-appindicator3-dev \
       librsvg2-dev
   ```
2. Chạy ứng dụng chế độ phát triển:
   ```bash
   npm install
   npm run tauri dev
   ```
3. Đóng gói file `.AppImage` và `.deb`:
   ```bash
   npm run tauri build
   ```
   File xuất ra sẽ nằm trong `src-tauri/target/release/bundle/deb/` và `bundle/appimage/`.
