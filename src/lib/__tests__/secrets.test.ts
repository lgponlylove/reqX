import { describe, expect, it } from 'vitest';
import { looksSecret } from '../secrets';

/**
 * Quy ước bảo mật của app: tên biến HOẶC giá trị trông như credential ⇒ biến là secret
 * (chỉ nằm trong RAM, bị strip khi xuất Public). Mẫu "Bearer <token>" là trường hợp
 * autoSaveFormat 'with_type' ghi ra, nên phải bị bắt.
 */
describe('looksSecret', () => {
  it('theo TÊN biến', () => {
    expect(looksSecret('accessToken', 'x')).toBe(true);
    expect(looksSecret('client_secret', 'x')).toBe(true);
    expect(looksSecret('apiKey', 'x')).toBe(true);
    expect(looksSecret('monkeyKey', 'x')).toBe(false); // key đứng một mình không tính
    expect(looksSecret('baseUrl', 'https://api.test')).toBe(false);
  });

  it('theo GIÁ TRỊ JWT/PEM kể cả khi tên vô tội', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abcDEF123456';
    expect(looksSecret('authen-get-permissions', jwt)).toBe(true);
    expect(looksSecret('blob', '-----BEGIN PRIVATE KEY-----\nabc')).toBe(true);
  });

  it('theo giá trị "Bearer <token>" / "Basic <...>" — dạng autoSave ghi nguyên cụm', () => {
    expect(looksSecret('authen-get-permissions', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig')).toBe(true);
    expect(looksSecret('proxyAuth', 'Basic ZGVmYXVsdDpkZWZhdWx0')).toBe(true);
    // không chặn nhầm ghi chú thường ngày
    expect(looksSecret('note', 'basic info about the order')).toBe(false);
    expect(looksSecret('scheme', 'bearer')).toBe(false);
    expect(looksSecret('placeholder', 'Bearer {{token}}')).toBe(false);
  });

  it('giá trị thường không bị coi là secret', () => {
    expect(looksSecret('tenant', 'ACME')).toBe(false);
    expect(looksSecret('userId', '12345')).toBe(false);
  });
});
