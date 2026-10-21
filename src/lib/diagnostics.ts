import type { ApiRequest, ApiResponse } from '../types/api';
import type { ReqSubTab } from '../stores/request';

export interface DiagnosticsFocus {
  subTab: ReqSubTab;
  fieldKey?: string; // Tên header, param key, hoặc body field
  reason: string;
  suggestion: string;
}

/**
 * Tự động phân tích Status code, Response body, Error message và Request config
 * để tìm ra vị trí chính xác gây ra lỗi và điều hướng con trỏ focus tới đó.
 */
export function diagnoseError(
  request: ApiRequest,
  response: ApiResponse | null,
  sendError: string | null
): DiagnosticsFocus | null {
  // 1. Kiểm tra lỗi mất kết nối / DNS / Timeout / Invalid URL
  if (sendError) {
    const errLow = sendError.toLowerCase();
    if (errLow.includes('enotfound') || errLow.includes('getaddrinfo') || errLow.includes('invalid url')) {
      return {
        subTab: 'params',
        reason: 'URL máy chủ không hợp lệ hoặc DNS không phân giải được',
        suggestion: 'Kiểm tra lại domain/host trong URL hoặc biến môi trường {{baseUrl}}.',
      };
    }
  }

  if (!response) return null;

  const status = response.status;
  const bodyText = (response.body || '').toLowerCase();

  // 2. Lỗi 401 Unauthorized (Auth / Token / Authorization Header / Cookie)
  if (status === 401) {
    // Nếu request có cấu hình Auth tab ('inherit' chưa có auth ở đây → xem header trước)
    if (request.auth && request.auth.type !== 'none' && request.auth.type !== 'inherit') {
      return {
        subTab: 'auth',
        reason: `Mã 401 Unauthorized (${response.statusText || 'Unauthorized'})`,
        suggestion: 'Token xác thực đã hết hạn hoặc không hợp lệ. Hãy làm mới Token hoặc kiểm tra Auth cấu hình.',
      };
    }

    // Nếu request cấu hình Authorization trong bảng Headers
    const hasAuthHeader = (request.headers || []).some(
      (h) => h.enabled && h.key.trim().toLowerCase() === 'authorization'
    );
    if (hasAuthHeader) {
      return {
        subTab: 'headers',
        fieldKey: 'authorization',
        reason: 'Header Authorization bị từ chối hoặc Token không tồn tại (401)',
        suggestion: 'Token trong header Authorization đã hết hạn hoặc không tồn tại. Hãy cập nhật token mới.',
      };
    }

    // Nếu có Cookie
    const hasCookieHeader = (request.headers || []).some(
      (h) => h.enabled && h.key.trim().toLowerCase() === 'cookie'
    );
    if (hasCookieHeader && (bodyText.includes('session') || bodyText.includes('cookie'))) {
      return {
        subTab: 'headers',
        fieldKey: 'cookie',
        reason: 'Phiên làm việc (Cookie / Session) đã hết hạn',
        suggestion: 'Kiểm tra lại giá trị JSESSIONID / session cookie trong Headers.',
      };
    }

    // Mặc định chuyển sang Headers nếu có headers, hoặc Auth
    return {
      subTab: (request.headers || []).length > 0 ? 'headers' : 'auth',
      fieldKey: 'authorization',
      reason: 'Server yêu cầu xác thực người dùng (401 Unauthorized)',
      suggestion: 'Thêm Header Authorization Bearer token hoặc thiết lập cấu hình trong tab Auth.',
    };
  }

  // 3. Lỗi 403 Forbidden (Quyền hạn / API Key / CSRF / Forbidden)
  if (status === 403) {
    if (bodyText.includes('csrf')) {
      return {
        subTab: 'headers',
        fieldKey: 'x-csrf-token',
        reason: 'Lỗi thiếu hoặc sai mã xác thực CSRF Token (403 Forbidden)',
        suggestion: 'Thêm Header X-CSRF-Token hoặc kiểm tra cookie phiên.',
      };
    }
    return {
      subTab: 'auth',
      reason: 'Tài khoản không đủ quyền truy cập tài nguyên này (403 Forbidden)',
      suggestion: 'Kiểm tra phân quyền tài khoản (Role/Permission) hoặc API key.',
    };
  }

  // 4. Lỗi 400 Bad Request (Tham số thiếu, sai cú pháp body JSON, hoặc Param thiếu)
  if (status === 400 || status === 422) {
    // Thử bóc tách tên trường bị lỗi trong response JSON
    try {
      const parsed = JSON.parse(response.body);
      const errStr = JSON.stringify(parsed).toLowerCase();

      // Quét xem có khớp với param nào trong query params không
      for (const p of request.params || []) {
        if (p.key.trim() && errStr.includes(p.key.trim().toLowerCase())) {
          return {
            subTab: 'params',
            fieldKey: p.key.trim(),
            reason: `Tham số query "${p.key}" không hợp lệ hoặc thiếu dữ liệu`,
            suggestion: `Server trả về lỗi liên quan đến tham số "${p.key}". Hãy kiểm tra giá trị gửi lên.`,
          };
        }
      }

      // Quét xem có khớp với trường nào trong body JSON không
      if (['POST', 'PUT', 'PATCH'].includes(request.method) && request.body) {
        return {
          subTab: 'body',
          reason: `Dữ liệu Request Body không hợp lệ (${status})`,
          suggestion: 'Server từ chối dữ liệu body. Hãy kiểm tra lại các trường bắt buộc hoặc format JSON.',
        };
      }
    } catch {
      // Không phải JSON
    }

    if (['POST', 'PUT', 'PATCH'].includes(request.method) && request.body) {
      return {
        subTab: 'body',
        reason: `Dữ liệu gửi lên không đúng định dạng (${status})`,
        suggestion: 'Kiểm tra lại nội dung Request Body.',
      };
    }

    return {
      subTab: 'params',
      reason: `Tham số yêu cầu không hợp lệ (${status})`,
      suggestion: 'Kiểm tra lại Params hoặc Headers của request.',
    };
  }

  // 5. Lỗi 415 Unsupported Media Type (Content-Type)
  if (status === 415) {
    return {
      subTab: 'headers',
      fieldKey: 'content-type',
      reason: 'Server không hỗ trợ định dạng Content-Type này (415)',
      suggestion: 'Đảm bảo Header Content-Type là application/json hoặc đúng loại server yêu cầu.',
    };
  }

  // 6. Lỗi 405 Method Not Allowed
  if (status === 405) {
    return {
      subTab: 'params',
      reason: `Phương thức ${request.method} không được hỗ trợ trên Endpoint này (405)`,
      suggestion: 'Đổi phương thức HTTP (GET, POST, PUT, DELETE...) phù hợp với tài liệu API.',
    };
  }

  return null;
}
