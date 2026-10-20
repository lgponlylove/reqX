import { describe, expect, it } from 'vitest';
import { bugFileName, buildBugReport } from '../bug-report';
import type { ApiRequest, ApiResponse } from '../../types/api';

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEifQ.ZmFrZXNpZ25hdHVyZQ';
const CUSTOM = 'CUSTOM-SECRET-VALUE-999';
const URL_TOKEN = 'URL-TOKEN-VALUE-123';
const PASSWORD = 'P@ssw0rd-123456';
const COOKIE = 'COOKIE-SECRET-123456';

function req(): ApiRequest {
  return {
    id: 'r1',
    name: 'Tạo đơn hàng',
    method: 'POST',
    url: `https://api.test/order?token=${URL_TOKEN}`,
    params: [],
    headers: [
      { id: 'h1', key: 'Authorization', value: `Bearer ${JWT}`, enabled: true },
      { id: 'h2', key: 'X-Custom-Secret', value: CUSTOM, enabled: true },
      { id: 'h3', key: 'Accept', value: 'application/json', enabled: true },
      { id: 'h4', key: 'X-Disabled', value: 'khong-bat', enabled: false },
    ],
    bodyType: 'json',
    body: `{"name":"mon A","password":"${PASSWORD}"}`,
    auth: { type: 'bearer', token: JWT },
    updatedAt: 1,
  } as ApiRequest;
}

const res = (over: Partial<ApiResponse> = {}) =>
  ({
    status: 500,
    statusText: 'Internal Server Error',
    timeMs: 128,
    sizeBytes: 64,
    headers: { 'content-type': 'application/json', 'set-cookie': `sid=${COOKIE}` },
    body: `{"error":"boom","access_token":"${JWT}"}`,
    bodyKind: 'text',
    ...over,
  }) as ApiResponse;

const base = {
  req: req(),
  res: res(),
  envName: 'DEV-Saigon',
  envVars: { token: URL_TOKEN, customSecret: CUSTOM },
  secretValues: [JWT, CUSTOM, URL_TOKEN, PASSWORD],
  testRun: {
    results: [
      { name: 'Status 200', passed: false, error: 'expected 500 to be 200' },
      { name: 'Có id đơn hàng', passed: true },
    ],
  },
  expected: 'API phải trả 200 và có id đơn hàng.',
  note: 'Bấm Tạo đơn 3 lần, lần nào cũng 500.',
  at: new Date('2026-10-20T09:30:00').getTime(),
};

describe('bằng chứng lỗi (bug report)', () => {
  it('không để lọt giá trị secret nào ra file', () => {
    const md = buildBugReport(base);
    for (const leak of [JWT, CUSTOM, URL_TOKEN, PASSWORD, COOKIE]) {
      expect(md.includes(leak)).toBe(false);
    }
  });

  it('đủ mục để Dev đọc mà không cần hỏi lại', () => {
    const md = buildBugReport(base);
    expect(md).toContain('# 🐞 Tạo đơn hàng');
    expect(md).toContain('**Kết quả nhận được:** 500 Internal Server Error • 128 ms • 64 bytes');
    expect(md).toContain('curl -X POST');
    expect(md).toContain('❌ Status 200');
    expect(md).toContain('✅ Có id đơn hàng');
    expect(md).toContain('Điều mong đợi');
    expect(md).toContain('Bấm Tạo đơn 3 lần');
    expect(md).toContain('DEV-Saigon');
  });

  it('header credential bị bỏ hẳn dòng, header thường vẫn còn', () => {
    const md = buildBugReport(base);
    expect(md).toContain('🔒 đã bỏ (credential)');
    expect(md).toContain('| Accept | application/json |');
    expect(md).not.toContain('khong-bat'); // header đang tắt không đưa vào
  });

  it('response nhị phân chỉ ghi mô tả, không nhét base64', () => {
    const md = buildBugReport({ ...base, res: res({ bodyKind: 'binary', body: 'QUFB'.repeat(500) }) });
    expect(md).toContain('file nhị phân');
    expect(md).not.toContain('QUFBQUFB');
  });

  it('body dài quá thì cắt và báo rõ đã cắt', () => {
    const md = buildBugReport({ ...base, res: res({ body: 'x'.repeat(9000) }) });
    expect(md).toContain('cắt giữa');
    expect(md).toContain('tổng 9000 ký tự');
  });

  it('không có testRun thì nói thẳng là chưa có điều kiện kiểm thử', () => {
    const md = buildBugReport({ ...base, testRun: null });
    expect(md).toContain('chưa có điều kiện kiểm thử');
  });

  it('tên file không chứa ký tự cấm của Windows', () => {
    const name = bugFileName({ ...req(), name: 'Tạo đơn / đơn hàng: A?' } as ApiRequest, base.at);
    expect(name).toMatch(/^reqx-bug-.+-20261020-0930\.md$/);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });
});
