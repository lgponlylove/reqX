import { describe, expect, it } from 'vitest';
import type { ApiRequest, Collection } from '../../types/api';
import { renderCollectionDocs, renderSingleRequestDocs } from '../../lib/api-docs';
import { renderDocsHtml } from '../../lib/docs-html';

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
const NOW = new Date(2026, 9, 15);

/** request → file HTML một khối, đủ để kiểm tra escaping + bố cục. */
function htmlOf(over: Partial<ApiRequest> = {}, lang: 'vi' | 'en' = 'vi'): string {
  return renderDocsHtml(renderSingleRequestDocs(req(over), { lang, env, now: NOW }), { lang });
}

describe('renderDocsHtml — an toàn', () => {
  it('tên request/URL có thẻ HTML chỉ hiện chữ, không chạy được', () => {
    const html = htmlOf({
      name: '<img src=x onerror=alert(1)>',
      url: '{{baseUrl}}/<script>alert(2)</script>',
      description: '<svg/onload=alert(3)>',
    });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<svg/onload');
  });

  it('không rò rỉ token/mật khẩu thật vào file HTML', () => {
    const html = htmlOf({
      url: '{{baseUrl}}/v1/login?token=ABCDEF123456',
      bodyType: 'json',
      body: '{"username":"minh","password":"MatKhauThat"}',
      auth: { type: 'bearer', token: 'ABCDEF123456' },
    });
    expect(html).not.toContain('ABCDEF123456');
    expect(html).not.toContain('MatKhauThat');
    expect(html).toContain('token=***');
  });
});

describe('renderDocsHtml — bố cục', () => {
  it('ra file HTML hoàn chỉnh: doctype, sidebar, badge method, nút in', () => {
    const html = htmlOf();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="vi">');
    expect(html).toContain('<nav class="toc">');
    expect(html).toContain('<span class="m m-post">POST</span>');
    expect(html).toContain('onclick="window.print()"');
    expect(html).toContain('id="post-login"');
    expect(html).toContain('href="#post-login"');
    expect(html).toContain('Sinh tự động bởi ReqX');
  });

  it('mục lục Markdown bị bỏ khỏi nội dung (sidebar đã thay)', () => {
    const col: Collection = { id: 'c1', name: 'Demo', folders: [], rootRequestIds: ['r1'] };
    const md = renderCollectionDocs(col, { r1: req() }, { env, now: NOW });
    expect(md).toContain('## Mục lục');
    const html = renderDocsHtml(md, { lang: 'vi' });
    // Sidebar đã liệt kê request rồi nên list mục lục trong Markdown bị bỏ.
    expect(html).not.toContain('<ul><li><b>Demo</b>');
    expect(html).toContain('<h2 id="muc-luc">Mục lục</h2>');
    expect(html).toContain('<a class="t3" href="#post-login">');
  });

  it('dấu `|` escape trong ô bảng trở lại thành chữ, không tạo cột mới', () => {
    const html = htmlOf({
      headers: [{ id: 'h1', key: 'X-Tenant|Id', value: 'ACME|1', enabled: true }],
    });
    expect(html).toContain('<td>X-Tenant|Id</td>');
    expect(html).toContain('<td>ACME|1</td>');
    expect(html).not.toContain('\\|');
  });

  it('nội dung trong fence có # và | không bị parse thành heading/bảng', () => {
    const html = htmlOf({
      bodyType: 'json',
      body: '{\n  "note": "# not a heading",\n  "path": "a|b"\n}',
    });
    const pres = [...html.matchAll(/<pre([^>]*)><code>([\s\S]*?)<\/code>/g)].map((m) => m[2]);
    const bodyBlock = pres.find((p) => p.includes('note')) ?? '';
    expect(bodyBlock).toContain('# not a heading');
    expect(bodyBlock).toContain('a|b');
    expect(html).toMatch(/<pre class="language-bash">/);
    expect(html).not.toContain('<h2 id="note');
  });

  it('ngôn ngữ en đổi nhãn trong file (mục lục, in, copy)', () => {
    const html = htmlOf({ name: 'Login' }, 'en');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('>Contents<');
    expect(html).toContain('Print / Save PDF');
    expect(html).toContain('Copied ✓');
    expect(html).not.toContain('Mục lục');
  });

  it('tài liệu rỗng vẫn là file HTML hợp lệ, báo "chưa có mục"', () => {
    const html = renderDocsHtml('', { lang: 'vi' });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('Chưa có mục nào.');
    expect(html).toContain('<title>ReqX API Docs</title>');
  });

  it('bỏ hoàn toàn phần "Phần nào ReqX lấy từ đâu" khỏi tài liệu HTML (sidebar lẫn nội dung)', () => {
    const col: Collection = { id: 'c1', name: 'Demo', folders: [], rootRequestIds: ['r1'] };
    const md = renderCollectionDocs(col, { r1: req() }, { env, now: NOW });
    expect(md).toContain('## Phần nào ReqX lấy từ đâu');
    const html = renderDocsHtml(md, { lang: 'vi' });
    expect(html).not.toContain('Phần nào ReqX lấy từ đâu');
    expect(html).not.toContain('suy từ cấu hình xác thực');
    expect(html).not.toContain('Where each section comes from');
  });
});
