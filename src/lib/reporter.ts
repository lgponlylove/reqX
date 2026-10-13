import type { RunItemResult } from './runner';
import type { ApiRequest } from '../types/api';
import { GROUP_LABEL, dataPreview, type TestCase, type CaseRunResult, type CaseGroup } from './test-cases';
import { maskSensitiveBody, maskUrl } from './mask';

function escapeHtml(str: string | number | undefined | null): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Sinh HTML Báo Cáo cho Runner (Collection / Folder) */
export function generateRunnerHtmlReport(opts: {
  collectionName: string;
  scopeName: string;
  results: RunItemResult[];
  totalTimeMs: number;
  environmentName?: string;
}): string {
  const { collectionName, scopeName, results, totalTimeMs, environmentName } = opts;
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  const failed = total - passed;
  const passPercent = total > 0 ? Math.round((passed / total) * 100) : 0;
  const totalTests = results.reduce((acc, r) => acc + (r.testsTotal || 0), 0);
  const passedTests = results.reduce((acc, r) => acc + (r.testsPassed || 0), 0);
  const nowStr = new Date().toLocaleString('vi-VN');

  const rowsHtml = results
    .map((r, i) => {
      const isOk = r.ok;
      const statusBadge = isOk
        ? '<span class="badge badge-success">PASSED</span>'
        : '<span class="badge badge-danger">FAILED</span>';

      const methodColor =
        r.method === 'GET'
          ? 'color: #10b981;'
          : r.method === 'POST'
          ? 'color: #38bdf8;'
          : r.method === 'DELETE'
          ? 'color: #f43f5e;'
          : 'color: #fbbf24;';

      const testRatio =
        r.testsTotal > 0
          ? `<span class="${r.testsPassed === r.testsTotal ? 'text-success' : 'text-danger'}">${r.testsPassed}/${r.testsTotal}</span>`
          : '<span class="text-muted">—</span>';

      const logsHtml =
        r.logs && r.logs.length > 0
          ? `<div class="sub-box"><b>Logs:</b><pre>${escapeHtml(maskSensitiveBody(r.logs.join('\n')))}</pre></div>`
          : '';

      const errHtml = r.error
        ? `<div class="sub-box error-box"><b>Lỗi:</b><pre>${escapeHtml(maskSensitiveBody(r.error))}</pre></div>`
        : '';

      const maskedBody = r.response?.body ? maskSensitiveBody(r.response.body) : '';
      const bodyHtml = maskedBody
        ? `<details class="sub-details"><summary>Xem Response Body</summary><pre>${escapeHtml(maskedBody.slice(0, 3000))}${maskedBody.length > 3000 ? '\n...[đã rút gọn]' : ''}</pre></details>`
        : '';

      return `
        <tr class="${isOk ? 'row-pass' : 'row-fail'}">
          <td>#${i + 1}</td>
          <td>${statusBadge}</td>
          <td><b style="${methodColor}">${escapeHtml(r.method)}</b></td>
          <td><b>${escapeHtml(r.name)}</b><br><small class="text-muted">${escapeHtml(maskUrl(r.url))}</small></td>
          <td><code>${r.status != null ? r.status : '—'}</code></td>
          <td>${r.timeMs != null ? r.timeMs + 'ms' : '—'}</td>
          <td>${testRatio}</td>
        </tr>
        ${
          !isOk || logsHtml || bodyHtml
            ? `
        <tr class="detail-row">
          <td colspan="7">
            ${errHtml}
            ${logsHtml}
            ${bodyHtml}
          </td>
        </tr>`
            : ''
        }
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>ReqX Test Report — ${escapeHtml(collectionName)}</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #111827;
      --border: #1f2937;
      --text: #f3f4f6;
      --muted: #9ca3af;
      --emerald: #10b981;
      --rose: #f43f5e;
      --cyan: #06b6d4;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 30px 20px;
      line-height: 1.5;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
    }
    .brand { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .logo { font-size: 20px; font-weight: 900; color: var(--emerald); letter-spacing: 1px; }
    .badge { padding: 3px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; font-family: monospace; }
    .badge-success { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3); }
    .badge-danger { background: rgba(244,63,94,0.15); color: #fb7185; border: 1px solid rgba(244,63,94,0.3); }
    .text-success { color: #34d399; font-weight: bold; }
    .text-danger { color: #fb7185; font-weight: bold; }
    .text-muted { color: var(--muted); }
    
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-top: 16px; }
    .stat-card {
      background: rgba(0,0,0,0.3);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      text-align: center;
    }
    .stat-val { font-size: 26px; font-weight: 900; font-family: monospace; }
    .stat-label { font-size: 12px; color: var(--muted); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }

    .table-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
    }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
    th { background: rgba(0,0,0,0.4); padding: 12px 16px; font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
    td { padding: 12px 16px; border-bottom: 1px solid rgba(31,41,55,0.6); }
    tr:hover td { background: rgba(255,255,255,0.02); }
    .row-fail td { border-left: 3px solid var(--rose); }
    .row-pass td { border-left: 3px solid var(--emerald); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    
    .detail-row td { background: rgba(0,0,0,0.25); padding: 12px 24px; }
    .sub-box { margin-bottom: 8px; font-size: 12px; }
    .error-box pre { color: #fda4af; background: rgba(244,63,94,0.1); border: 1px solid rgba(244,63,94,0.2); padding: 8px 12px; border-radius: 6px; overflow-x: auto; font-family: monospace; margin-top: 4px; }
    .sub-box pre { background: #030712; padding: 8px 12px; border-radius: 6px; overflow-x: auto; font-family: monospace; margin-top: 4px; color: #cbd5e1; }
    .sub-details summary { cursor: pointer; color: var(--cyan); font-weight: 600; font-size: 12px; outline: none; }
    .sub-details pre { background: #030712; padding: 10px; border-radius: 6px; overflow-x: auto; margin-top: 6px; font-family: monospace; font-size: 11px; color: #a7f3d0; max-height: 250px; }
    
    .print-btn {
      background: var(--emerald);
      color: #022c22;
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      font-weight: 700;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
    }
    .print-btn:hover { opacity: 0.9; transform: translateY(-1px); }
    @media print {
      body { background: #fff; color: #000; }
      .print-btn { display: none; }
      header, .table-card { border-color: #ccc; box-shadow: none; background: #fff; }
      .stat-card { background: #f9f9f9; border-color: #ddd; }
      th { background: #f0f0f0; color: #333; }
      td { border-bottom-color: #eee; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div>
          <div class="logo">ReqX • AUTOMATION REPORT</div>
          <p style="color: var(--muted); font-size: 13px; margin-top: 2px;">
            Collection: <b>${escapeHtml(collectionName)}</b> • Phạm vi: <b>${escapeHtml(scopeName)}</b>
            ${environmentName ? ` • Môi trường: <b>${escapeHtml(environmentName)}</b>` : ''}
          </p>
        </div>
        <div style="text-align: right;">
          <button class="print-btn" onclick="window.print()">🖨 In báo cáo / Lưu PDF</button>
          <p style="color: var(--muted); font-size: 11px; margin-top: 6px;">Thời gian: ${nowStr}</p>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-val" style="color: ${passPercent === 100 ? 'var(--emerald)' : 'var(--rose)'};">${passPercent}%</div>
          <div class="stat-label">Tỷ lệ Pass</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="color: var(--emerald);">${passed}/${total}</div>
          <div class="stat-label">Requests Đạt</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="color: var(--rose);">${failed}</div>
          <div class="stat-label">Requests Lỗi</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="color: var(--cyan);">${passedTests}/${totalTests}</div>
          <div class="stat-label">Test Assertions</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="color: #e2e8f0;">${totalTimeMs}ms</div>
          <div class="stat-label">Tổng thời gian</div>
        </div>
      </div>
    </header>

    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th style="width: 50px;">STT</th>
            <th style="width: 90px;">Kết quả</th>
            <th style="width: 80px;">Method</th>
            <th>Tên Request / Endpoint</th>
            <th style="width: 80px;">Status</th>
            <th style="width: 90px;">Thời gian</th>
            <th style="width: 100px;">Tests</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

/** Sinh HTML Báo Cáo cho Key Test (Edge cases / Negative testing) */
export function generateKeyTestHtmlReport(opts: {
  baseRequest: ApiRequest;
  cases: TestCase[];
  results: Record<string, CaseRunResult>;
}): string {
  const { baseRequest, cases, results } = opts;
  const total = cases.length;
  const passed = cases.filter((c) => results[c.id]?.pass).length;
  const failed = cases.filter((c) => results[c.id] && !results[c.id].pass).length;
  const passPercent = total > 0 ? Math.round((passed / total) * 100) : 0;
  const nowStr = new Date().toLocaleString('vi-VN');

  const rowsHtml = cases
    .map((c, i) => {
      const r = results[c.id];
      const isPass = r?.pass;
      const statusBadge = !r
        ? '<span class="badge" style="background:#334155;color:#94a3b8;">CHƯA CHẠY</span>'
        : isPass
        ? '<span class="badge badge-success">KHỚP (PASS)</span>'
        : '<span class="badge badge-danger">LỖI (FAIL)</span>';

      const dataStr = dataPreview(c);

      return `
        <tr class="${!r ? '' : isPass ? 'row-pass' : 'row-fail'}">
          <td>#${i + 1}</td>
          <td>${statusBadge}</td>
          <td><b>${escapeHtml(c.name)}</b></td>
          <td><span class="badge" style="background:#1e1b4b;color:#a5b4fc;">${GROUP_LABEL[c.group as CaseGroup] || c.group}</span></td>
          <td><code>${escapeHtml(dataStr)}</code></td>
          <td><code>${escapeHtml(c.expect.status || 'any')}</code></td>
          <td><code>${r?.status != null ? r.status : '—'}</code></td>
          <td><small>${escapeHtml(maskSensitiveBody(r?.why || '—'))}</small></td>
        </tr>
        ${
          r && (!isPass || r.curl)
            ? `
        <tr class="detail-row">
          <td colspan="8">
            ${r.error ? `<div class="sub-box error-box"><b>Chi tiết lỗi:</b><pre>${escapeHtml(maskSensitiveBody(r.error))}</pre></div>` : ''}
            ${r.curl ? `<div class="sub-box"><b>Lệnh cURL tái hiện:</b><pre>${escapeHtml(r.curl)}</pre></div>` : ''}
          </td>
        </tr>`
            : ''
        }
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>ReqX Key Test Report — ${escapeHtml(baseRequest.name)}</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #111827;
      --border: #1f2937;
      --text: #f3f4f6;
      --muted: #9ca3af;
      --emerald: #10b981;
      --rose: #f43f5e;
      --violet: #8b5cf6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 30px 20px;
      line-height: 1.5;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
    }
    .brand { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .logo { font-size: 20px; font-weight: 900; color: var(--violet); letter-spacing: 1px; }
    .badge { padding: 3px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; font-family: monospace; }
    .badge-success { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3); }
    .badge-danger { background: rgba(244,63,94,0.15); color: #fb7185; border: 1px solid rgba(244,63,94,0.3); }
    
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-top: 16px; }
    .stat-card {
      background: rgba(0,0,0,0.3);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      text-align: center;
    }
    .stat-val { font-size: 26px; font-weight: 900; font-family: monospace; }
    .stat-label { font-size: 12px; color: var(--muted); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }

    .table-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
    }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
    th { background: rgba(0,0,0,0.4); padding: 12px 16px; font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
    td { padding: 12px 16px; border-bottom: 1px solid rgba(31,41,55,0.6); }
    tr:hover td { background: rgba(255,255,255,0.02); }
    .row-fail td { border-left: 3px solid var(--rose); }
    .row-pass td { border-left: 3px solid var(--emerald); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    
    .detail-row td { background: rgba(0,0,0,0.25); padding: 12px 24px; }
    .sub-box { margin-bottom: 8px; font-size: 12px; }
    .error-box pre { color: #fda4af; background: rgba(244,63,94,0.1); border: 1px solid rgba(244,63,94,0.2); padding: 8px 12px; border-radius: 6px; overflow-x: auto; font-family: monospace; margin-top: 4px; }
    .sub-box pre { background: #030712; padding: 8px 12px; border-radius: 6px; overflow-x: auto; font-family: monospace; margin-top: 4px; color: #a7f3d0; }
    
    .print-btn {
      background: var(--violet);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      font-weight: 700;
      cursor: pointer;
      font-size: 12px;
    }
    @media print {
      body { background: #fff; color: #000; }
      .print-btn { display: none; }
      header, .table-card { border-color: #ccc; box-shadow: none; background: #fff; }
      .stat-card { background: #f9f9f9; border-color: #ddd; }
      th { background: #f0f0f0; color: #333; }
      td { border-bottom-color: #eee; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div>
          <div class="logo">🧪 ReqX • KEY TEST REPORT</div>
          <p style="color: var(--muted); font-size: 13px; margin-top: 2px;">
            Request: <b>${escapeHtml(baseRequest.name)}</b> (${escapeHtml(baseRequest.method)} <code>${escapeHtml(maskUrl(baseRequest.url))}</code>)
          </p>
        </div>
        <div style="text-align: right;">
          <button class="print-btn" onclick="window.print()">🖨 In báo cáo / Lưu PDF</button>
          <p style="color: var(--muted); font-size: 11px; margin-top: 6px;">Thời gian: ${nowStr}</p>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-val" style="color: ${passPercent === 100 ? 'var(--emerald)' : 'var(--rose)'};">${passPercent}%</div>
          <div class="stat-label">Khớp mong đợi</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="color: var(--emerald);">${passed}/${total}</div>
          <div class="stat-label">Cases Đạt</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="color: var(--rose);">${failed}</div>
          <div class="stat-label">Cases Lỗi / Bất thường</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="color: var(--violet);">${total}</div>
          <div class="stat-label">Tổng Edge Cases</div>
        </div>
      </div>
    </header>

    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th style="width: 50px;">STT</th>
            <th style="width: 120px;">Kết quả</th>
            <th>Tên Case</th>
            <th style="width: 100px;">Nhóm</th>
            <th>Dữ liệu thay thế</th>
            <th style="width: 80px;">Mong đợi</th>
            <th style="width: 70px;">Thực tế</th>
            <th>Giải thích</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}
