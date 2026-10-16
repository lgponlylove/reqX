use std::path::PathBuf;
use base64::prelude::*;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Khóa công khai Ed25519 nhúng trực tiếp trong binary ReqX.
/// Được dùng để xác thực chữ ký của License Key hoàn toàn offline.
pub const LICENSE_PUBKEY: &[u8; 32] = &[
    0x51, 0x07, 0x31, 0x0f, 0x7e, 0xb2, 0x02, 0x34, 0xef, 0x6e, 0x12, 0x1b, 0xfc, 0x48, 0x1f, 0x24,
    0xeb, 0x11, 0x55, 0x96, 0x5d, 0xcd, 0x81, 0xe2, 0x77, 0x42, 0xf2, 0x4f, 0x38, 0x0d, 0x93, 0x85,
];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LicenseInfo {
    pub email: String,
    pub tier: String,            // "pro" | "team" | "enterprise"
    pub issued_at: u64,          // timestamp unix ms
    pub expires_at: Option<u64>, // None = Trọn đời (Lifetime)
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

    // Khởi tạo VerifyingKey
    let verifying_key = match VerifyingKey::from_bytes(LICENSE_PUBKEY) {
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

/// Tauri Command: Xác thực License Key và lưu lại máy
#[tauri::command]
pub fn activate_license(key: String) -> Result<LicenseVerificationResult, String> {
    let res = verify_license_string(&key);
    if !res.valid {
        return Ok(res);
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
}

