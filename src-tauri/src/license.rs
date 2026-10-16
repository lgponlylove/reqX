use std::path::PathBuf;
use base64::prelude::*;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Khóa công khai Ed25519 được xáo trộn bằng mặt nạ XOR nhiều lớp trong binary ReqX.
/// Giúp ngăn chặn kẻ xấu quét chuỗi byte để hoán đổi Public Key bằng công cụ Hex Editor.
const MASK_KEY: [u8; 8] = [0x8F, 0x3A, 0xC4, 0x71, 0x9B, 0x52, 0xE6, 0x1D];
const MASKED_PUBKEY: [u8; 32] = [
    0xde, 0x3d, 0xf5, 0x7e, 0xe5, 0xe0, 0xe4, 0x29,
    0x60, 0x54, 0xd6, 0x6a, 0x67, 0x1a, 0xf9, 0x39,
    0x64, 0x2b, 0x91, 0xe7, 0xc6, 0x9f, 0x67, 0xff,
    0xf8, 0x78, 0x36, 0x3e, 0xa3, 0x5f, 0x75, 0x98,
];

#[inline(never)]
pub fn get_license_pubkey() -> [u8; 32] {
    let mut key = [0u8; 32];
    for (i, b) in MASKED_PUBKEY.iter().enumerate() {
        key[i] = b ^ MASK_KEY[i % MASK_KEY.len()];
    }
    key
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LicenseInfo {
    pub email: String,
    #[serde(default)]
    pub machine_id: Option<String>, // Mã máy (None hoặc Some("*") = không khóa máy)
    pub tier: String,               // "pro" | "team" | "enterprise"
    pub issued_at: u64,             // timestamp unix ms
    pub expires_at: Option<u64>,    // None = Trọn đời (Lifetime)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LicenseVerificationResult {
    pub valid: bool,
    pub is_pro: bool,
    pub info: Option<LicenseInfo>,
    pub error: Option<String>,
}

impl LicenseVerificationResult {
    pub fn invalid(err: impl Into<String>) -> Self {
        Self {
            valid: false,
            is_pro: false,
            info: None,
            error: Some(err.into()),
        }
    }
}

#[cfg(target_os = "windows")]
fn get_raw_system_machine_id() -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let output = std::process::Command::new("reg")
        .args(["query", r"HKLM\SOFTWARE\Microsoft\Cryptography", "/v", "MachineGuid"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            if line.contains("MachineGuid") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if let Some(val) = parts.last() {
                    let cleaned = val.trim();
                    if !cleaned.is_empty() && cleaned.len() >= 8 {
                        return Some(cleaned.to_string());
                    }
                }
            }
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn get_raw_system_machine_id() -> Option<String> {
    std::fs::read_to_string("/etc/machine-id")
        .or_else(|_| std::fs::read_to_string("/var/lib/dbus/machine-id"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(target_os = "macos")]
fn get_raw_system_machine_id() -> Option<String> {
    let output = std::process::Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            if line.contains("IOPlatformUUID") {
                if let Some(uuid) = line.split('"').nth(3) {
                    let cleaned = uuid.trim();
                    if !cleaned.is_empty() {
                        return Some(cleaned.to_string());
                    }
                }
            }
        }
    }
    None
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn get_raw_system_machine_id() -> Option<String> {
    None
}

/// Tauri Command: Lấy mã máy định danh duy nhất (dạng REQX-XXXX-XXXX-XXXX)
#[tauri::command]
pub fn get_machine_id() -> String {
    let raw_opt = get_raw_system_machine_id();
    let raw = match raw_opt {
        Some(s) if !s.is_empty() => s,
        _ => {
            // Fallback đọc hoặc sinh UUID bền vững lưu trong ~/.reqx/.machine_id
            let home = std::env::var("USERPROFILE")
                .or_else(|_| std::env::var("HOME"))
                .unwrap_or_else(|_| ".".to_string());
            let mid_path = PathBuf::from(home).join(".reqx").join(".machine_id");
            if let Ok(content) = std::fs::read_to_string(&mid_path) {
                let trimmed = content.trim().to_string();
                if !trimmed.is_empty() {
                    return trimmed;
                }
            }
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(123456789);
            let gen = format!("{:016X}", now);
            if let Some(parent) = mid_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&mid_path, &gen);
            gen
        }
    };

    let clean: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase();

    if clean.len() >= 12 {
        format!("REQX-{}-{}-{}", &clean[0..4], &clean[4..8], &clean[8..12])
    } else {
        let padded = format!("{:0<12}", clean);
        format!("REQX-{}-{}-{}", &padded[0..4], &padded[4..8], &padded[8..12])
    }
}

/// Giải mã Base64 hỗ trợ cả Base64 thường và Base64 URL-safe.
fn decode_b64(input: &str) -> Result<Vec<u8>, String> {
    let clean = input.trim().replace(['\r', '\n', ' ', '\t'], "");
    BASE64_STANDARD
        .decode(&clean)
        .or_else(|_| BASE64_URL_SAFE.decode(&clean))
        .or_else(|_| BASE64_URL_SAFE_NO_PAD.decode(&clean))
        .or_else(|_| BASE64_STANDARD_NO_PAD.decode(&clean))
        .map_err(|e| format!("Lỗi giải mã Base64: {e}"))
}

/// Xác thực chuỗi License Key offline bằng Public Key.
pub fn verify_license_string(raw_key: &str) -> LicenseVerificationResult {
    let raw = raw_key
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim();
    if raw.is_empty() {
        return LicenseVerificationResult::invalid("License Key không được để trống.");
    }

    // Bỏ prefix nếu có: REQX1. hoặc REQX-PRO. hoặc REQX1- hoặc REQX-PRO-
    let stripped = raw
        .strip_prefix("REQX1.")
        .or_else(|| raw.strip_prefix("REQX-PRO."))
        .or_else(|| raw.strip_prefix("REQX1-"))
        .or_else(|| raw.strip_prefix("REQX-PRO-"))
        .unwrap_or(raw);

    let parts: Vec<&str> = stripped.split('.').collect();
    if parts.len() != 2 {
        return LicenseVerificationResult::invalid(
            "Cấu trúc License Key không hợp lệ (cần định dạng: PAYLOAD.SIGNATURE).",
        );
    }

    let payload_bytes = match decode_b64(parts[0]) {
        Ok(b) => b,
        Err(e) => return LicenseVerificationResult::invalid(format!("Dữ liệu payload lỗi: {e}")),
    };

    let sig_bytes = match decode_b64(parts[1]) {
        Ok(b) => b,
        Err(e) => return LicenseVerificationResult::invalid(format!("Dữ liệu chữ ký lỗi: {e}")),
    };

    if sig_bytes.len() != 64 {
        return LicenseVerificationResult::invalid(format!(
            "Độ dài chữ ký Ed25519 không hợp lệ (cần 64 bytes, nhận {} bytes).",
            sig_bytes.len()
        ));
    }

    // Khởi tạo VerifyingKey từ public key đã giải mã runtime
    let pubkey_bytes = get_license_pubkey();
    let verifying_key = match VerifyingKey::from_bytes(&pubkey_bytes) {
        Ok(k) => k,
        Err(e) => return LicenseVerificationResult::invalid(format!("Khóa Public không hợp lệ: {e}")),
    };

    // Khởi tạo Signature
    let sig_array: [u8; 64] = sig_bytes.try_into().unwrap();
    let signature = Signature::from_bytes(&sig_array);

    // Xác thực chữ ký số bằng Ed25519
    if let Err(e) = verifying_key.verify(&payload_bytes, &signature) {
        return LicenseVerificationResult::invalid(format!(
            "Chữ ký bản quyền không hợp lệ hoặc đã bị sửa đổi! ({e})"
        ));
    }

    // Parse JSON Payload
    let info: LicenseInfo = match serde_json::from_slice(&payload_bytes) {
        Ok(i) => i,
        Err(e) => {
            return LicenseVerificationResult::invalid(format!(
                "Nội dung bản quyền JSON không hợp lệ: {e}"
            ))
        }
    };

    // Kiểm tra thời hạn nếu có (expires_at)
    if let Some(exp_ms) = info.expires_at {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        if now_ms > exp_ms {
            return LicenseVerificationResult::invalid("Giấy phép bản quyền này đã hết hạn.");
        }
    }

    // Kiểm tra ràng buộc thiết bị (Machine ID) nếu có
    if let Some(mid) = &info.machine_id {
        let mid_clean = mid.trim().to_uppercase();
        let current_mid = get_machine_id();
        if mid_clean != "*" && mid_clean != current_mid {
            return LicenseVerificationResult::invalid(format!(
                "Mã bản quyền này được cấp cho thiết bị '{mid}', không hợp lệ trên thiết bị hiện tại ('{current_mid}')."
            ));
        }
    }

    LicenseVerificationResult {
        valid: true,
        is_pro: true,
        info: Some(info),
        error: None,
    }
}

/// Lấy đường dẫn lưu file bản quyền (reqx.lic) bên cạnh app hoặc trong thư mục AppData.
fn get_license_file_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("reqx.lic");
            // Kiểm tra xem có ghi được vào thư mục app không (tránh lỗi khi cài trong Program Files)
            if let Ok(m) = std::fs::metadata(parent) {
                if !m.permissions().readonly() {
                    return candidate;
                }
            }
        }
    }

    // Fallback sang thư mục Home / UserProfile
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".reqx").join("reqx.lic")
}

/// Tauri Command: Xác thực License Key kèm Email và Machine ID, sau đó lưu lại máy
#[tauri::command]
pub fn activate_license(email: String, key: String) -> Result<LicenseVerificationResult, String> {
    let raw_email = email.trim();
    if raw_email.is_empty() {
        return Ok(LicenseVerificationResult::invalid("Vui lòng nhập Email đã đăng ký bản quyền."));
    }

    let res = verify_license_string(&key);
    if !res.valid {
        return Ok(res);
    }

    // Kiểm tra khớp email
    if let Some(info) = &res.info {
        if !info.email.trim().eq_ignore_ascii_case(raw_email) {
            return Ok(LicenseVerificationResult::invalid(format!(
                "Email kích hoạt ('{}') không khớp với thông tin trong mã bản quyền ('{}').",
                raw_email, info.email
            )));
        }
    }

    // Lưu vào file reqx.lic
    let path = get_license_file_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    if let Err(e) = std::fs::write(&path, key.trim()) {
        eprintln!("Cảnh báo: Không thể ghi file bản quyền tại {:?}: {e}", path);
    }

    Ok(res)
}

/// Tauri Command: Kiểm tra bản quyền đã lưu khi mở app
#[tauri::command]
pub fn check_license() -> LicenseVerificationResult {
    let path = get_license_file_path();
    if !path.exists() {
        return LicenseVerificationResult {
            valid: false,
            is_pro: false,
            info: None,
            error: None, // Chưa kích hoạt
        };
    }

    match std::fs::read_to_string(&path) {
        Ok(content) => verify_license_string(&content),
        Err(e) => LicenseVerificationResult::invalid(format!("Không thể đọc file bản quyền: {e}")),
    }
}

/// Tauri Command: Xóa bản quyền (Hủy kích hoạt)
#[tauri::command]
pub fn deactivate_license() -> Result<(), String> {
    let path = get_license_file_path();
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_license_verification() {
        let sample_key = "REQX-PRO.eyJlbWFpbCI6InByb0ByZXF4LmRldiIsInRpZXIiOiJwcm8iLCJpc3N1ZWRfYXQiOjE3MDAwMDAwMDAwMDAsImV4cGlyZXNfYXQiOm51bGx9.2vyQDsbrcKvFbd4g4+J81cf3eZoomDYd7mX5tFqkgDo/161k2dRU/J1HXp9aWI8XfDi6nfIUDXNk73vmsamCDQ==";
        let res = verify_license_string(sample_key);
        assert!(res.valid, "License should be valid, got error: {:?}", res.error);
        assert!(res.is_pro);
        let info = res.info.expect("Should have info");
        assert_eq!(info.email, "pro@reqx.dev");
        assert_eq!(info.tier, "pro");
        assert_eq!(info.expires_at, None);
    }

    #[test]
    fn test_tampered_license_fails() {
        // Tamper signature
        let tampered_key = "REQX-PRO.eyJlbWFpbCI6InByb0ByZXF4LmRldiIsInRpZXIiOiJwcm8iLCJpc3N1ZWRfYXQiOjE3MDAwMDAwMDAwMDAsImV4cGlyZXNfYXQiOm51bGx9.AvyQDsbrcKvFbd4g4+J81cf3eZoomDYd7mX5tFqkgDo/161k2dRU/J1HXp9aWI8XfDi6nfIUDXNk73vmsamCDQ==";
        let res = verify_license_string(tampered_key);
        assert!(!res.valid);
        assert!(!res.is_pro);
    }

    #[test]
    fn test_empty_or_malformed_license() {
        assert!(!verify_license_string("").valid);
        assert!(!verify_license_string("REQX-PRO.abc").valid);
        assert!(!verify_license_string("invalid.key.format").valid);
    }

    #[test]
    fn test_pubkey_unmasking() {
        let key = get_license_pubkey();
        assert_eq!(key.len(), 32);
        assert_eq!(key[0], 0x51);
        assert_eq!(key[31], 0x85);
    }
}

