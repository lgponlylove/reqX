/**
Che credential trong text trước khi ghi ra bên ngoài (file CSV/HTML, log, toast).

Vì sao tách module: `reporter.ts` import `test-cases.ts`, nên đặt ở một trong hai
file kia sẽ tạo vòng import khi cả hai cần che giống nhau.
*/

/** Che token/password/secret dạng key-value, Bearer và JWT trong text. */
export function maskSensitiveBody(body: string): string {
  if (!body) return '';
  return body
    .replace(/(["']?(?:access_?token|refresh_?token|id_?token|token|password|passwd|pwd|secret|client_?secret|api[-_]?key|apikey|authorization|bearer|set[-_]?cookie|cookie|jsessionid|phpsessid|session[-_]?id)["']?\s*[:=]\s*["'])([^"'\n,}{]{3,})(["']?)/gi, '$1***$3')
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]{6,}/gi, '$1***')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'eyJ***[MASKED_JWT]***');
}

/** Tên tham số truy vấn nghi là credential — dùng để che giá trị khi in URL ra file. */
const SECRET_QUERY_KEY = /^(access_?token|refresh_?token|id_?token|token|api[-_]?key|apikey|key|secret|client[-_]?secret|password|passwd|pwd|code|otp|sig|signature|auth|authorization|session|sessionid|jsessionid|phpsessid|sid)$/i;

/** Che giá trị tham số nhạy cảm trong URL: `?token=abc&x=1` -> `?token=***&x=1`. */
export function maskUrl(url: string): string {
  if (!url) return '';
  const q = url.indexOf('?');
  if (q < 0) return url;
  const head = url.slice(0, q);
  const query = url.slice(q + 1);
  const masked = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq <= 0) return pair;
      let name = pair.slice(0, eq);
      try {
        name = decodeURIComponent(name);
      } catch {
        /* giữ nguyên name nếu encode lỗi */
      }
      return SECRET_QUERY_KEY.test(name) ? `${pair.slice(0, eq)}=***` : pair;
    })
    .join('&');
  return `${head}?${masked}`;
}
