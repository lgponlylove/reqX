#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct NativeHttpRequest {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<NativeBody>,
    timeout_secs: u64,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum NativeBody {
    Text { content_type: Option<String>, text: String },
    Form { fields: Vec<(String, String)> },
}

#[derive(Debug, Serialize)]
struct NativeHttpResponse {
    status: u16,
    status_text: Option<String>,
    headers: Vec<(String, String)>,
    body: String,
    /// "text": body gốc; "binary": body là base64
    body_kind: String,
    size_bytes: usize,
    time_ms: u64,
}

/// Content-Type text thì luôn decode lossy; còn lại: UTF-8 hợp lệ + không có byte 0 → text, else base64.
fn is_text_ct(ct: &str) -> bool {
    let c = ct.to_lowercase();
    let c = c.split(';').next().unwrap_or("").trim();
    c.starts_with("text/")
        || c == "application/json"
        || c == "application/xml"
        || c == "application/javascript"
        || c == "application/x-www-form-urlencoded"
        || c == "application/graphql"
        || c.ends_with("+json")
        || c.ends_with("+xml")
        || c.ends_with("+text")
}

/// Gửi HTTP native bằng reqwest — KHÔNG bị CORS như fetch trong WebView.
#[tauri::command]
async fn http_send(req: NativeHttpRequest) -> Result<NativeHttpResponse, String> {
    let t0 = std::time::Instant::now();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(req.timeout_secs.max(1)))
        .build()
        .map_err(|e| format!("Không tạo được HTTP client: {e}"))?;

    let mut rb = client.request(
        req.method
            .parse()
            .map_err(|_| format!("Method lạ: {}", req.method))?,
        &req.url,
    );
    for (k, v) in &req.headers {
        rb = rb.header(k.as_str(), v.as_str());
    }
    if let Some(body) = req.body {
        match body {
            NativeBody::Text { content_type, text } => {
                if let Some(ct) = content_type {
                    rb = rb.header("content-type", ct);
                }
                rb = rb.body(text);
            }
            NativeBody::Form { fields } => {
                rb = rb.form(&fields);
            }
        }
    }

    let res = rb.send().await.map_err(|e| {
        if e.is_timeout() {
            format!("Timeout sau {}s", req.timeout_secs)
        } else if e.is_connect() {
            format!("Không kết nối được tới server: {e}")
        } else {
            format!("Lỗi gửi request: {e}")
        }
    })?;

    let status = res.status();
    let headers: Vec<(String, String)> = res
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("Lỗi đọc body: {e}"))?;

    let ct = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    let (body, body_kind) = if is_text_ct(&ct) {
        (
            String::from_utf8_lossy(&bytes).into_owned(),
            "text".to_string(),
        )
    } else {
        match String::from_utf8(bytes.to_vec()) {
            Ok(s) if !s.contains('\0') => (s, "text".to_string()),
            _ => (
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes),
                "binary".to_string(),
            ),
        }
    };

    Ok(NativeHttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().map(|s| s.to_string()),
        headers,
        body,
        body_kind,
        size_bytes: bytes.len(),
        time_ms: t0.elapsed().as_millis() as u64,
    })
}

/// Mở thư mục Downloads trong Explorer (nơi trình duyệt/WebView lưu file tải về).
#[tauri::command]
fn open_downloads() -> Result<(), String> {
    let home = std::env::var("USERPROFILE")
        .map_err(|_| "Không tìm được thư mục người dùng".to_string())?;
    let dir = std::path::Path::new(&home).join("Downloads");
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("Không mở được thư mục: {e}"))?;
    Ok(())
}

/// Lưu file export ngay cạnh file .exe (không qua Downloads), trả về đường dẫn đầy đủ.
/// Gia cố: chặn path traversal (.., /, tuyệt đối), giới hạn độ dài + whitelist đuôi file.
#[tauri::command]
fn save_export_file(filename: String, content: String) -> Result<String, String> {
    const ALLOWED_EXT: [&str; 7] = ["json", "txt", "md", "html", "csv", "har", "log"];
    const MAX_NAME_LEN: usize = 120;
    const MAX_CONTENT_LEN: usize = 50 * 1024 * 1024; // 50MB
    let clean: String = filename
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let clean = clean.trim().to_string();
    if clean.is_empty() || clean == "." || clean == ".." {
        return Err("Tên file không hợp lệ".to_string());
    }
    if clean.len() > MAX_NAME_LEN {
        return Err("Tên file quá dài (tối đa 120 ký tự)".to_string());
    }
    let ext = clean.rsplit('.').next().unwrap_or("").to_lowercase();
    if !ALLOWED_EXT.contains(&ext.as_str()) {
        return Err(format!("Đuôi file không cho phép (chỉ nhận: {})", ALLOWED_EXT.join(", ")));
    }
    if content.len() > MAX_CONTENT_LEN {
        return Err("Nội dung file quá lớn (tối đa 50MB)".to_string());
    }
    let dir = std::env::current_exe()
        .map_err(|e| format!("Không xác định được đường dẫn app: {e}"))?;
    let dir = dir
        .parent()
        .ok_or("Không tìm được thư mục chứa app".to_string())?;
    let path = dir.join(&clean);
    std::fs::write(&path, content).map_err(|e| format!("Không ghi được file: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Mở Explorer tới thư mục chứa file + bôi đen sẵn file đó.
/// Gia cố: chỉ nhận path tồn tại thật (file hoặc thư mục), chặn chuỗi rỗng.
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Đường dẫn trống".to_string());
    }
    let p = std::path::Path::new(trimmed);
    if !p.exists() {
        return Err("File/thư mục không tồn tại".to_string());
    }
    if !p.is_file() && !p.is_dir() {
        return Err("Đường dẫn không phải file hay thư mục".to_string());
    }
    std::process::Command::new("explorer")
        .arg(format!("/select,{trimmed}"))
        .spawn()
        .map_err(|e| format!("Không mở được thư mục: {e}"))?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            http_send,
            open_downloads,
            save_export_file,
            reveal_in_explorer
        ])
        .run(tauri::generate_context!())
        .expect("loi khi chay ReqX");
}
