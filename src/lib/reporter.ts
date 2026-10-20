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

/** Sinh HTML Báo Cáo cho Runner (Collection / Folder) với Charts & Lọc tương tác */
export function generateRunnerHtmlReport(opts: {
  collectionName: string;
  scopeName: string;
  results: RunItemResult[];
  totalTimeMs: number;
  environmentName?: string;
  lang?: 'vi' | 'en';
}): string {
  const { collectionName, scopeName, results, totalTimeMs, environmentName, lang = 'vi' } = opts;
  const isEn = lang === 'en';
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  const failed = total - passed;
  const passPercent = total > 0 ? Math.round((passed / total) * 100) : 0;
  const totalTests = results.reduce((acc, r) => acc + (r.testsTotal || 0), 0);
  const passedTests = results.reduce((acc, r) => acc + (r.testsPassed || 0), 0);
  const nowStr = new Date().toLocaleString(isEn ? 'en-US' : 'vi-VN');

  // Thống kê thời gian phản hồi (Response times)
  const times = results.map((r) => r.timeMs ?? 0).filter((t) => t > 0);
  const avgTime = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const sortedTimes = [...times].sort((a, b) => a - b);
  const p95Time = sortedTimes.length > 0 ? sortedTimes[Math.floor(sortedTimes.length * 0.95)] : 0;
  const maxTime = sortedTimes.length > 0 ? sortedTimes[sortedTimes.length - 1] : 0;
  const minTime = sortedTimes.length > 0 ? sortedTimes[0] : 0;

  // Tính toán góc cho SVG Donut Chart (chu vi = 2 * PI * 40 = 251.327)
  const circumference = 251.327;
  const passDash = total > 0 ? (passed / total) * circumference : 0;
  const failDash = total > 0 ? (failed / total) * circumference : 0;

  const rowsHtml = results
    .map((r, i) => {
      const isOk = r.ok;
      const statusBadge = isOk
        ? `<span class="badge badge-success">${isEn ? 'PASSED' : 'ĐẠT'}</span>`
        : `<span class="badge badge-danger">${isEn ? 'FAILED' : 'LỖI'}</span>`;

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
          ? `<div class="sub-box"><b>${isEn ? 'Execution Logs:' : 'Nhật ký thực thi (Logs):'}</b><pre>${escapeHtml(maskSensitiveBody(r.logs.join('\n')))}</pre></div>`
          : '';

      const errHtml = r.error
        ? `<div class="sub-box error-box"><b>${isEn ? 'Failure Reason:' : 'Nguyên nhân lỗi:'}</b><pre>${escapeHtml(maskSensitiveBody(r.error))}</pre></div>`
        : '';

      const maskedBody = r.response?.body ? maskSensitiveBody(r.response.body) : '';
      const bodyHtml = maskedBody
        ? `<details class="sub-details"><summary>${isEn ? 'Inspect Response Body' : 'Xem Response Body'}</summary><pre>${escapeHtml(maskedBody.slice(0, 4000))}${maskedBody.length > 4000 ? (isEn ? '\n...[truncated]' : '\n...[đã rút gọn]') : ''}</pre></details>`
        : '';

      // curl tái hiện tối giản (method + URL đã mask) — RunItemResult không giữ request gốc nên thiếu header/auth/body
      const maskedCurlUrl = maskUrl(r.url);
      const curlLines: string[] = [`curl -X ${r.method} '${maskedCurlUrl}'`];
      const curlCommand = curlLines.join(' ');

      return `
        <tr class="item-row ${isOk ? 'row-pass' : 'row-fail'}" data-status="${isOk ? 'pass' : 'fail'}">
          <td>#${i + 1}</td>
          <td>${statusBadge}</td>
          <td><b style="${methodColor}">${escapeHtml(r.method)}</b></td>
          <td>
            <div style="font-weight: 600; color: #f1f5f9;">${escapeHtml(r.name)}</div>
            <div style="color: var(--muted); font-size: 11px; font-family: monospace;">${escapeHtml(maskUrl(r.url))}</div>
          </td>
          <td><code>${r.status != null ? r.status : '—'}</code></td>
          <td><b>${r.timeMs != null ? r.timeMs + 'ms' : '—'}</b></td>
          <td>${testRatio}</td>
        </tr>
        ${
          !isOk || logsHtml || bodyHtml
            ? `
        <tr class="detail-row ${isOk ? 'row-pass' : 'row-fail'}" data-status="${isOk ? 'pass' : 'fail'}">
          <td colspan="7">
            ${errHtml}
            ${logsHtml}
            ${bodyHtml}
            <div class="sub-box curl-box">
              <div class="curl-header">
                <span>cURL Quick Replay:</span>
                <button type="button" class="copy-btn" onclick="navigator.clipboard.writeText(this.getAttribute('data-curl')); this.innerText = '${isEn ? '✓ Copied' : '✓ Đã sao chép'}'; setTimeout(() => this.innerText = '${isEn ? 'Copy cURL' : 'Sao chép cURL'}', 2000)" data-curl="${escapeHtml(curlCommand)}">
                  ${isEn ? 'Copy cURL' : 'Sao chép cURL'}
                </button>
              </div>
              <pre>${escapeHtml(curlCommand)}</pre>
            </div>
          </td>
        </tr>`
            : ''
        }
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="${isEn ? 'en' : 'vi'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReqX Test Report — ${escapeHtml(collectionName)}</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #111827;
      --border: #1f2937;
      --text: #f3f4f6;
      --muted: #94a3b8;
      --emerald: #10b981;
      --rose: #f43f5e;
      --cyan: #06b6d4;
      --amber: #f59e0b;
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
    .brand { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: gap; gap: 12px; }
    .logo { font-size: 22px; font-weight: 900; color: var(--emerald); letter-spacing: 0.5px; display: flex; align-items: center; gap: 8px; }
    .badge { padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; font-family: monospace; display: inline-block; }
    .badge-success { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3); }
    .badge-danger { background: rgba(244,63,94,0.15); color: #fb7185; border: 1px solid rgba(244,63,94,0.3); }
    .text-success { color: #34d399; font-weight: bold; }
    .text-danger { color: #fb7185; font-weight: bold; }
    .text-muted { color: var(--muted); }

    /* Visual Chart Card */
    .dashboard-grid {
      display: grid;
      grid-template-columns: 260px 1fr;
      gap: 20px;
      margin-top: 16px;
      align-items: center;
    }
    @media (max-width: 800px) {
      .dashboard-grid { grid-template-columns: 1fr; }
    }
    
    .chart-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.35);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px;
    }
    .donut-chart {
      position: relative;
      width: 140px;
      height: 140px;
    }
    .donut-chart svg {
      transform: rotate(-90deg);
      width: 100%;
      height: 100%;
    }
    .donut-hole {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }
    .donut-val { font-size: 24px; font-weight: 900; font-family: monospace; }
    .donut-sub { font-size: 10px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.5px; }

    .stats-grid { 
      display: grid; 
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); 
      gap: 14px; 
    }
    .stat-card {
      background: rgba(0,0,0,0.3);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      text-align: center;
      transition: transform 0.2s;
    }
    .stat-card:hover { transform: translateY(-2px); border-color: #374151; }
    .stat-val { font-size: 22px; font-weight: 900; font-family: monospace; }
    .stat-label { font-size: 11px; color: var(--muted); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }

    /* Filter Toolbar */
    .filter-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      flex-wrap: wrap;
      gap: 10px;
    }
    .filter-group {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--card);
      border: 1px solid var(--border);
      padding: 4px 6px;
      border-radius: 10px;
    }
    .filter-btn {
      background: transparent;
      border: none;
      color: var(--muted);
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .filter-btn.active {
      background: #1f2937;
      color: #fff;
    }
    .filter-btn:hover:not(.active) { color: #f1f5f9; }
    
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
    
    .detail-row td { background: rgba(0,0,0,0.3); padding: 14px 24px; }
    .sub-box { margin-bottom: 10px; font-size: 12px; }
    .error-box pre { color: #fda4af; background: rgba(244,63,94,0.1); border: 1px solid rgba(244,63,94,0.25); padding: 10px 14px; border-radius: 8px; overflow-x: auto; font-family: monospace; margin-top: 4px; white-space: pre-wrap; }
    .sub-box pre { background: #030712; padding: 10px 14px; border-radius: 8px; overflow-x: auto; font-family: monospace; margin-top: 4px; color: #cbd5e1; border: 1px solid rgba(255,255,255,0.05); }
    .sub-details summary { cursor: pointer; color: var(--cyan); font-weight: 600; font-size: 12px; outline: none; margin-bottom: 4px; }
    .sub-details pre { background: #030712; padding: 12px; border-radius: 8px; overflow-x: auto; margin-top: 6px; font-family: monospace; font-size: 11px; color: #a7f3d0; max-height: 280px; border: 1px solid rgba(6,182,212,0.2); }
    
    .curl-box {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 8px;
      padding: 10px;
    }
    .curl-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
      font-size: 11px;
      color: #38bdf8;
      font-weight: 600;
    }
    .copy-btn {
      background: #1e293b;
      color: #38bdf8;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 10px;
      cursor: pointer;
      font-weight: bold;
    }
    .copy-btn:hover { background: #334155; color: #fff; }

    .print-btn {
      background: linear-gradient(135deg, #10b981, #06b6d4);
      color: #022c22;
      border: none;
      border-radius: 8px;
      padding: 8px 18px;
      font-weight: 700;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(16,185,129,0.25);
    }
    .print-btn:hover { opacity: 0.95; transform: translateY(-1px); }
    @media print {
      body { background: #fff; color: #000; padding: 0; }
      .print-btn, .filter-toolbar, .copy-btn { display: none !important; }
      header, .table-card, .chart-box, .stat-card { border-color: #ccc; box-shadow: none; background: #fff; color: #000; }
      .stat-card { background: #f9f9f9; border-color: #ddd; }
      th { background: #f0f0f0; color: #333; }
      td { border-bottom-color: #eee; }
      .sub-box pre, .error-box pre, .sub-details pre { background: #f8fafc; color: #000; border-color: #ccc; }
      .badge-success { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
      .badge-danger { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div>
          <div class="logo">
            <span>⚡ ReqX</span>
            <span style="font-size: 13px; font-weight: 600; color: var(--muted); border-left: 2px solid var(--border); padding-left: 10px; margin-left: 4px;">
              ${isEn ? 'QA AUTOMATION REPORT' : 'BÁO CÁO KIỂM THỬ TỰ ĐỘNG'}
            </span>
          </div>
          <p style="color: var(--muted); font-size: 13px; margin-top: 6px;">
            Collection: <b style="color: #f1f5f9;">${escapeHtml(collectionName)}</b> • ${isEn ? 'Scope:' : 'Phạm vi:'} <b>${escapeHtml(scopeName)}</b>
            ${environmentName ? ` • ${isEn ? 'Environment:' : 'Môi trường:'} <b style="color: var(--cyan);">${escapeHtml(environmentName)}</b>` : ''}
          </p>
        </div>
        <div style="text-align: right;">
          <button class="print-btn" onclick="window.print()">🖨 ${isEn ? 'Print / Save PDF' : 'In báo cáo / Lưu PDF'}</button>
          <p style="color: var(--muted); font-size: 11px; margin-top: 6px;">${isEn ? 'Executed on:' : 'Thời gian:'} ${nowStr}</p>
        </div>
      </div>

      <div class="dashboard-grid">
        <!-- SVG Donut Chart -->
        <div class="chart-box">
          <div class="donut-chart">
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" fill="transparent" stroke="#1f2937" stroke-width="12"></circle>
              <!-- Pass segment -->
              <circle cx="50" cy="50" r="40" fill="transparent" stroke="#10b981" stroke-width="12" stroke-dasharray="${passDash} ${circumference}" stroke-dashoffset="0"></circle>
              <!-- Fail segment -->
              <circle cx="50" cy="50" r="40" fill="transparent" stroke="#f43f5e" stroke-width="12" stroke-dasharray="${failDash} ${circumference}" stroke-dashoffset="-${passDash}"></circle>
            </svg>
            <div class="donut-hole">
              <div class="donut-val" style="color: ${passPercent === 100 ? 'var(--emerald)' : 'var(--rose)'};">${passPercent}%</div>
              <div class="donut-sub">${isEn ? 'PASSED' : 'ĐẠT'}</div>
            </div>
          </div>
          <div style="display: flex; gap: 12px; margin-top: 10px; font-size: 11px; font-weight: bold;">
            <span style="color: var(--emerald);">● ${passed} ${isEn ? 'Pass' : 'Đạt'}</span>
            <span style="color: var(--rose);">● ${failed} ${isEn ? 'Fail' : 'Lỗi'}</span>
          </div>
        </div>

        <!-- Metric Grid -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-val" style="color: var(--emerald);">${passed}/${total}</div>
            <div class="stat-label">${isEn ? 'Requests Passed' : 'Requests Đạt'}</div>
          </div>
          <div class="stat-card">
            <div class="stat-val" style="color: var(--rose);">${failed}</div>
            <div class="stat-label">${isEn ? 'Requests Failed' : 'Requests Lỗi'}</div>
          </div>
          <div class="stat-card">
            <div class="stat-val" style="color: var(--cyan);">${passedTests}/${totalTests}</div>
            <div class="stat-label">${isEn ? 'Assertions' : 'Kiểm thử Assertions'}</div>
          </div>
          <div class="stat-card">
            <div class="stat-val" style="color: #e2e8f0;">${totalTimeMs}ms</div>
            <div class="stat-label">${isEn ? 'Total Execution' : 'Tổng thời gian'}</div>
          </div>
          <div class="stat-card">
            <div class="stat-val" style="color: #38bdf8;">${avgTime}ms</div>
            <div class="stat-label">${isEn ? 'Avg Response' : 'Thời gian TB'}</div>
          </div>
          <div class="stat-card">
            <div class="stat-val" style="color: var(--amber);">${p95Time}ms</div>
            <div class="stat-label">P95 Latency</div>
          </div>
        </div>
      </div>
    </header>

    <!-- Interactive Filter Toolbar -->
    <div class="filter-toolbar">
      <div class="filter-group">
        <button type="button" class="filter-btn active" onclick="filterTable('all', this)">${isEn ? 'All Requests' : 'Tất cả'} (${total})</button>
        <button type="button" class="filter-btn" onclick="filterTable('fail', this)">${isEn ? 'Failed Only' : 'Chỉ lỗi'} (${failed})</button>
        <button type="button" class="filter-btn" onclick="filterTable('pass', this)">${isEn ? 'Passed Only' : 'Chỉ đạt'} (${passed})</button>
      </div>
      <div style="font-size: 12px; color: var(--muted);">
        ${isEn ? 'Tip: Click any row details to expand logs, response body and cURL replay.' : 'Gợi ý: Mở rộng dòng chi tiết để xem log, response body và cURL tái hiện lỗi.'}
      </div>
    </div>

    <div class="table-card">
      <table id="resultsTable">
        <thead>
          <tr>
            <th style="width: 50px;">#</th>
            <th style="width: 90px;">${isEn ? 'Status' : 'Kết quả'}</th>
            <th style="width: 80px;">Method</th>
            <th>${isEn ? 'Request Name / Endpoint' : 'Tên Request / Endpoint'}</th>
            <th style="width: 80px;">Code</th>
            <th style="width: 90px;">${isEn ? 'Time' : 'Thời gian'}</th>
            <th style="width: 100px;">Tests</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    function filterTable(filter, btn) {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const rows = document.querySelectorAll('#resultsTable tbody tr');
      rows.forEach(r => {
        const st = r.getAttribute('data-status');
        if (filter === 'all' || st === filter) {
          r.style.display = '';
        } else {
          r.style.display = 'none';
        }
      });
    }
  </script>
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
      --cyan: #06b6d4;
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
