import { describe, expect, it } from 'vitest';
import type { ApiRequest, Collection, Folder } from '../../types/api';
import {
  docsFileName,
  pathOf,
  renderCollectionDocs,
  renderRequestDocs,
  renderSingleRequestDocs,
  type DocsFlow,
  type DocsSample,
  type DocsTestRun,
} from '../../lib/api-docs';
import type { CaseRunResult, TestCase } from '../../lib/test-cases';

function req(over: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: over.id ?? 'r1',
    name: 'Login',
    method: 'POST',
    url: 'http://api.test/v1/login',
    params: [],
    headers: [],
    bodyType: 'none',
    body: '',
    auth: { type: 'none' },
    updatedAt: 0,
    ...over,
  };
}

const env = { name: 'Staging', variables: { baseUrl: 'http://api.test' }, globals: { tenant: 'ACME' } };
const NOW = new Date(2026, 9, 15); // 15/10/2026 — truyền vào để ngày trong file không đổi khi chạy lại

describe('pathOf', () => {
  it('cắt scheme+host, cả khi URL còn {{baseUrl}}', () => {
    expect(pathOf('http://api.test:3000/v1/login?x=1')).toBe('/v1/login?x=1');
    expect(pathOf('{{baseUrl}}/v1/login?x=1')).toBe('/v1/login?x=1');
    expect(pathOf('{{baseUrl}}:3000/v1/login')).toBe('/v1/login');
    expect(pathOf('/v1/login')).toBe('/v1/login');
    expect(pathOf('api/v1/login')).toBe('/api/v1/login');
    expect(pathOf('{{baseUrl}}')).toBe('{{baseUrl}}');
    expect(pathOf('')).toBe('/');
  });
});

describe('renderRequestDocs', () => {
  it('đủ mục theo mẫu: URL, Headers 3 cột, Body 4 cột, cURL — và không lộ token thật', () => {
    const md = renderRequestDocs(
      req({
        description: 'Đăng nhập lấy token',
        url: '{{baseUrl}}/v1/login?token=ABCDEF123456&lang=vi',
        headers: [
          { id: 'h1', key: 'Content-Type', value: 'application/json', enabled: true },
          { id: 'h2', key: 'X-Tenant', value: '{{tenant}}', enabled: true },
          { id: 'h3', key: 'Accept', value: 'application/json', enabled: false },
        ],
        bodyType: 'json',
        body: '{\n  "username": "minh",\n  "password": "MatKhauThat",\n  "profile": { "age": 24 }\n}',
        auth: { type: 'bearer', token: 'ABCDEF123456' },
      }),
      { env },
    );
    expect(md).toContain('### POST Login');
    expect(md).toContain('Đăng nhập lấy token'); // mô tả in nguyên văn, không phải ô bảng
    expect(md).toContain('**URL**');
    expect(md).toContain('POST {{baseUrl}}/v1/login?token=***&lang=vi');
    expect(md).not.toContain('ABCDEF123456');
    expect(md).not.toContain('MatKhauThat');
    expect(md).toContain('| Key | Value | Bắt buộc |');
    expect(md).toContain('| Content-Type | application/json | ✓ |');
    expect(md).toContain('| X-Tenant | {{tenant}} | — |');
    expect(md).not.toContain('Accept'); // header disabled không vào tài liệu
    expect(md).toContain('| Field | Kiểu | Bắt buộc | Mô tả |');
    expect(md).toContain('| profile.age | number |');
    expect(md).toContain('🔒 secret — đã ẩn');
    expect(md).toContain('**cURL**');
    expect(md).toContain('curl -X POST');
    expect(md).toContain('_Chưa có mẫu');
  });

  it('lấy mẫu Response 200 + 401 từ lịch sử và liệt kê biến Flow trích ra', () => {
    const samples: DocsSample[] = [
      { requestId: 'r1', method: 'POST', url: '{{baseUrl}}/v1/login', status: 200, body: '{"access_token":"XYZSECRET","token_type":"Bearer","expires_in":3600}', timeMs: 1 },
      { requestId: 'r1', method: 'POST', url: '{{baseUrl}}/v1/login', status: 401, body: '{"error":"invalid_grant"}', timeMs: 2 },
    ];
    const flows: DocsFlow[] = [{ name: 'ss0+print', steps: [{ requestId: 'r1', extract: [{ name: 'access_token' }, { name: 'token_type' }] }] }];
    const md = renderRequestDocs(
      req({ url: '{{baseUrl}}/v1/login', bodyType: 'json', body: '{"grant_type":"client_credential"}' }),
      { samples, flows },
    );
    expect(md).toContain('**Response 200**');
    expect(md).toContain('"expires_in": 3600');
    expect(md).not.toContain('XYZSECRET');
    expect(md).toContain('| token_type | string |');
    expect(md).toContain('**Response 401**');
    expect(md).toContain('invalid_grant');
    expect(md).toContain('**Biến được trích ra** — Flow `ss0+print`: `{{access_token}}`, `{{token_type}}`');
  });

  it('bảng Key test: mỗi case 1 dòng ✅ ❌ ⏳ kèm dòng tổng kết', () => {
    const cases: TestCase[] = [
      { id: 'c1', name: 'Thiếu password', group: 'missing', data: { password: '<<xóa field>>' }, expect: { status: '4xx' } },
      { id: 'c2', name: 'Đúng hết', group: 'valid', data: {}, expect: { status: '2xx' } },
      { id: 'c3', name: 'Số âm', group: 'boundary', data: { age: '-1' }, expect: { status: '4xx' } },
    ];
    const results: Record<string, CaseRunResult> = {
      c1: { caseId: 'c1', pass: true, expected: '4xx', status: 400, why: '400 khớp 4xx', body: '', curl: '' },
      c2: { caseId: 'c2', pass: false, expected: '2xx', status: 500, why: 'Mong đợi 2xx, nhận 500', body: '', curl: '' },
    };
    const testRun: DocsTestRun = { requestId: 'r1', cases, results };
    const md = renderRequestDocs(req(), { testRun });
    expect(md).toContain('**Kết quả Key test gần nhất**');
    expect(md).toContain('| Nhóm | Case | Mong đợi | Thực tế | Kết quả |');
    expect(md).toContain('| Thiếu field | Thiếu password | 4xx | 400 · 400 khớp 4xx | ✅ |');
    expect(md).toContain('| Hợp lệ | Đúng hết | 2xx | 500 · Mong đợi 2xx, nhận 500 | ❌ |');
    expect(md).toContain('| Biên | Số âm | 4xx | chưa chạy | ⏳ |');
    expect(md).toContain('3 case · 1 ✅ · 1 ❌');
  });

  it('ngôn ngữ đang chọn = en thì mọi nhãn sang tiếng Anh, không còn chữ Việt', () => {
    const md = renderRequestDocs(
      req({
        url: '',
        headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer ABCDEF123456', enabled: true }],
        bodyType: 'json',
        body: '{"password":"MatKhauThat"}',
        auth: { type: 'basic', username: 'minh', password: 'MatKhauThat' },
      }),
      { lang: 'en' },
    );
    expect(md).toContain('| Key | Value | Required |');
    expect(md).toContain('| Authorization | *** | ✓ |');
    expect(md).not.toContain('ABCDEF123456');
    expect(md).toContain('| Field | Type | Required | Notes |');
    expect(md).toContain('🔒 secret — hidden');
    expect(md).toContain('Basic auth — username `minh`, password **is not written into this document**');
    expect(md).not.toContain('MatKhauThat');
    expect(md).not.toContain('Bắt buộc');
    expect(md).not.toContain('không ghi trong tài liệu');
    expect(md).toContain('_No description yet');
  });

  it('form-data/raw vẫn có fence, không có bảng field', () => {
    const md = renderRequestDocs(
      req({ bodyType: 'form-data', body: 'file=/tmp/data.txt', auth: { type: 'basic', username: 'minh', password: 'MatKhauThat' } }),
      { env },
    );
    expect(md).toContain('_`form-data`_');
    expect(md).not.toContain('| Field |');
    expect(md).toContain('mật khẩu **không ghi trong tài liệu**');
    expect(md).not.toContain('MatKhauThat');
  });

  it('request rỗng vẫn sinh được, có ghi chú script khi có script', () => {
    const md = renderRequestDocs(req({ url: '', name: '', preRequest: "pm.environment.set('a','b')", tests: 'pm.test("x", ()=>{})' }), {});
    expect(md).toContain('### POST (không tên)');
    expect(md).toContain('(chưa đặt URL)');
    expect(md).toContain('_Không có body._');
    expect(md).toContain('Có script **Pre-request**');
    expect(md).toContain('Có script **Tests**');
  });
});

describe('renderCollectionDocs', () => {
  const folder: Folder = { id: 'f1', name: 'Auth', requestIds: ['r2'], folderIds: ['f2'] };
  const nested: Folder = { id: 'f2', name: 'Nâng cao', requestIds: ['r3'], folderIds: [] };
  const col: Collection = {
    id: 'c1',
    name: 'API Thanh Toan',
    folders: [folder, nested],
    rootRequestIds: ['r1'],
    preRequest: 'pm.environment.set("token", pm.response.json().token);',
  };
  const map: Record<string, ApiRequest> = {
    r1: req({ id: 'r1', name: 'Login', url: '{{baseUrl}}/login', bodyType: 'json', body: '{"user":"minh"}', auth: { type: 'bearer', token: 'TOKENthat' } }),
    r2: req({ id: 'r2', name: 'Me | current', method: 'GET', url: '{{baseUrl}}/me', collectionId: 'c1' }),
    r3: req({ id: 'r3', name: 'Refresh', url: '{{baseUrl}}/oauth/refresh', collectionId: 'c1' }),
  };

  it('tiêu đề = tên collection, dòng nguồn, mục lục theo folder, bảng nguồn', () => {
    const md = renderCollectionDocs(col, map, { env, now: NOW });
    expect(md).toContain('# API Thanh Toan');
    expect(md).toContain('Sinh tự động bởi ReqX · Môi trường: **Staging** · Cập nhật: 15/10/2026');
    expect(md).toContain('## Mục lục');
    expect(md).toContain('- **Auth**: `GET` Me \\| current');
    expect(md).toContain('- **Auth / Nâng cao**: `POST` Refresh');
    expect(md).toContain('## Auth');
    expect(md).toContain('## Auth / Nâng cao'); // folder lồng nhau vẫn thành mục riêng
    expect(md).toContain('| `{{baseUrl}}` | có |');
    expect(md).not.toContain('TOKENthat');
    expect(md).toContain('## Phần nào ReqX lấy từ đâu');
    expect(md).toContain('Bắt buộc | suy từ cấu hình xác thực');
  });

  it('bản en dịch cả dòng nguồn, mục lục và bảng nguồn', () => {
    const md = renderCollectionDocs(col, map, { env, now: NOW, lang: 'en' });
    expect(md).toContain('Auto-generated by ReqX · Environment: **Staging** · Updated: 2026-10-15');
    expect(md).toContain('## Contents');
    expect(md).toContain('## Where each section comes from');
    expect(md).not.toContain('Bắt buộc');
    expect(md).not.toContain('Môi trường');
  });

  it('hai bản vi/en cùng số dòng bảng nguồn — không thiếu nhãn nào ở bản dịch', () => {
    const dem = (md: string) => {
      const i = md.lastIndexOf('## ');
      return md.slice(i).split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('|---')).length;
    };
    const vi = dem(renderCollectionDocs(col, map, { env, now: NOW, lang: 'vi' }));
    const en = dem(renderCollectionDocs(col, map, { env, now: NOW, lang: 'en' }));
    expect(vi).toBeGreaterThan(10);
    expect(en).toBe(vi);
  });

  it('folderId = chỉ xuất thư mục đó + folder con, bỏ request gốc của collection', () => {
    const md = renderCollectionDocs(col, map, { env, folderId: 'f1', now: NOW });
    expect(md).toContain('# API Thanh Toan');
    expect(md).toContain('Phạm vi: **Auth**');
    expect(md).toContain('Auth / Nâng cao');
    expect(md).not.toContain('/login'); // r1 nằm ngoài folder
  });

  it('folderId trỏ thẳng folder lồng: chỉ đúng request bên trong nó', () => {
    const md = renderCollectionDocs(col, map, { env, folderId: 'f2', now: NOW });
    expect(md).toContain('Refresh');
    expect(md).not.toContain('/me');
  });

  it('folderId không tồn tại (vừa đổi tên/xóa) → nói rõ, không sinh tài liệu rỗng', () => {
    expect(renderCollectionDocs(col, map, { env, folderId: 'f-chet' })).toContain('Không tìm thấy thư mục được chọn');
  });

  it('collection rỗng không crash và nói rõ chưa có request', () => {
    const md = renderCollectionDocs({ id: 'c0', name: 'Trống', folders: [], rootRequestIds: [] }, {}, { env });
    expect(md).toContain('_Chưa có request nào ở phạm vi này._');
  });

  it('biến chưa có trong môi trường bị đánh dấu "chưa đặt"', () => {
    const md = renderCollectionDocs(col, { r1: req({ id: 'r1', name: 'A', url: '{{hostmissing}}/x' }) }, { env });
    expect(md).toContain('| `{{hostmissing}}` | **chưa đặt** |');
  });

  it('tên file slug không dấu, có ngày', () => {
    expect(docsFileName('API Thanh Toán')).toMatch(/^reqx-tai-lieu-api-thanh-toan-\d{8}\.md$/);
    expect(docsFileName('***')).toMatch(/^reqx-tai-lieu-api-\d{8}\.md$/);
    expect(docsFileName('')).toMatch(/^reqx-tai-lieu-api-\d{8}\.md$/);
  });
});

describe('renderSingleRequestDocs (nút ▼ Send)', () => {
  it('chỉ đúng 1 request, có tiêu đề + dòng nguồn, token vẫn bị che', () => {
    const md = renderSingleRequestDocs(
      req({ name: 'Login', url: '{{baseUrl}}/login?token=ABCDEF123456', auth: { type: 'bearer', token: 'ABCDEF123456' } }),
      { env, now: NOW },
    );
    expect(md).toContain('# Login');
    expect(md).toContain('Cập nhật: 15/10/2026');
    expect(md).toContain('Token / mật khẩu / API key **đã ẩn**');
    expect(md).toContain('### POST Login');
    expect(md).not.toContain('ABCDEF123456');
  });

  it('request chưa đặt tên thì lấy path URL làm tiêu đề', () => {
    expect(renderSingleRequestDocs(req({ name: '', url: '{{baseUrl}}/v1/me' }), { now: NOW })).toContain('# /v1/me');
  });
});
