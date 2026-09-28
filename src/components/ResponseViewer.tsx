import { useMemo, useState } from 'react';
import { useAppStore } from '../stores/app';
import { contentTypeOf, downloadResponse, guessFileName, openDownloadsFolder, responseDataUrl } from '../lib/response-file';
import { isTauri } from '../lib/http-client';

type View = 'pretty' | 'raw' | 'headers' | 'preview' | 'tests' | 'file';

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'bg-emerald-600';
  if (status >= 300 && status < 400) return 'bg-sky-600';
  if (status >= 400 && status < 500) return 'bg-amber-600';
  if (status >= 500) return 'bg-red-600';
  return 'bg-slate-600';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function tryPretty(body: string): { ok: boolean; text: string } {
  try {
    const obj = JSON.parse(body);
    return { ok: true, text: JSON.stringify(obj, null, 2) };
  } catch {
    return { ok: false, text: body };
  }
}

/** Highlight JSON đơn giản: key / string / number / boolean / null. */
function highlightJson(pretty: string): string {
  const esc = pretty
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc.replace(
    /(&quot;|")([^"\\]*(?:\\.[^"\\]*)*)(")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (m, _q1, key, _q2, colon, bool, _num) => {
      if (colon) return `<span class="text-sky-300">"${key}"</span><span class="text-slate-400">:</span>`;
      if (bool) return `<span class="text-amber-300">${bool}</span>`;
      if (/^-?\d/.test(m)) return `<span class="text-emerald-300">${m}</span>`;
      return `<span class="text-orange-200">${m}</span>`;
    },
  );
}

export default function ResponseViewer() {
  const { response, sending, testRun } = useAppStore();
  const [view, setView] = useState<View>('pretty');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [folderMsg, setFolderMsg] = useState('');

  const pretty = useMemo(
    () => (response && response.bodyKind !== 'binary' ? tryPretty(response.body) : { ok: false, text: '' }),
    [response],
  );
  const highlighted = useMemo(
    () => (pretty.ok ? highlightJson(pretty.text) : ''),
    [pretty],
  );

  if (sending) {
    return (
      <div className="border border-slate-700 rounded p-6 text-center text-slate-300">
        <span className="animate-pulse">Đang gửi request...</span>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="border border-dashed border-slate-700 rounded p-6 text-center text-slate-400">
        Chưa có response. Nhấn <b className="text-slate-200">Gửi</b> để test API.
      </div>
    );
  }

  const headerEntries = Object.entries(response.headers);
  const isBinary = response.bodyKind === 'binary';
  // Binary thì các tab text không có ý nghĩa → ép sang tab File
  const effectiveView: View =
    isBinary && (view === 'pretty' || view === 'raw' || view === 'preview') ? 'file' : view;
  const ct = contentTypeOf(response.headers).toLowerCase();
  const dataUrl = responseDataUrl(response);
  const fileName = guessFileName(response);
  const isHtml =
    !isBinary && (ct.includes('html') || /^\s*</.test(response.body));
  const passed = testRun?.results.filter((r) => r.passed).length ?? 0;
  const failed = (testRun?.results.length ?? 0) - passed;

  async function copyBody() {
    try {
      await navigator.clipboard.writeText(response!.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function saveFile() {
    downloadResponse(response!);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  const inTauri = isTauri();

  async function openFolder() {
    try {
      await openDownloadsFolder(inTauri);
    } catch {
      setFolderMsg('Không mở được thư mục');
      window.setTimeout(() => setFolderMsg(''), 2000);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="font-semibold mr-1">Response</h2>
        <span className={`text-white text-xs font-bold rounded px-2 py-1 ${statusColor(response.status)}`}>
          {response.status} {response.statusText}
        </span>
        <span className="text-xs bg-slate-800 rounded px-2 py-1">⏱ {response.timeMs} ms</span>
        <span className="text-xs bg-slate-800 rounded px-2 py-1">📦 {formatSize(response.sizeBytes)}</span>
        {testRun && testRun.results.length > 0 && (
          <span className={`text-xs font-bold rounded px-2 py-1 ${failed === 0 ? 'bg-emerald-600' : 'bg-red-600'}`}>
            Tests {passed}/{passed + failed}
          </span>
        )}
        <button
          onClick={saveFile}
          className="text-xs bg-emerald-700 hover:bg-emerald-600 rounded px-2.5 py-1 font-semibold"
          title={isBinary ? undefined : 'Lưu body ra file'}
        >
          {saved ? 'Đã lưu ✓' : '💾 Lưu file'}
        </button>
        {inTauri && (
          <button
            onClick={openFolder}
            className="text-xs bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1"
            title="Mở thư mục Downloads trong Explorer"
          >
            {folderMsg || '📂 Thư mục'}
          </button>
        )}
        {!isBinary && (
          <button
            onClick={copyBody}
            className="text-xs bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1"
          >
            {copied ? 'Đã copy ✓' : 'Copy body'}
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b border-slate-800 mb-2">
        {(
          (isBinary
            ? [
                ['file', `📁 File (${fileName})`],
                ['headers', `Headers (${headerEntries.length})`],
                ...(testRun ? [['tests', `Tests (${testRun.results.length})`] as [View, string]] : []),
              ]
            : [
                ['pretty', `Pretty${pretty.ok ? ' (JSON)' : ''}`],
                ['raw', 'Raw'],
                ['headers', `Headers (${headerEntries.length})`],
                ['preview', 'Preview'],
                ...(testRun ? [['tests', `Tests (${testRun.results.length})`] as [View, string]] : []),
              ]) as [View, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`px-3 py-1.5 text-sm rounded-t ${
              effectiveView === id ? 'bg-slate-800 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {effectiveView === 'file' && (
        <div className="bg-slate-950 border border-slate-700 rounded p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300 mb-3">
            <span>Loại: <b className="font-mono">{contentTypeOf(response.headers) || '(không rõ)'}</b></span>
            <span>Dung lượng: <b>{formatSize(response.sizeBytes)}</b></span>
            <span>Tên file: <b className="font-mono">{fileName}</b></span>
          </div>
          {ct.startsWith('image/') ? (
            <img src={dataUrl} alt={fileName} className="max-h-96 rounded border border-slate-700 bg-white" />
          ) : ct.startsWith('video/') ? (
            <video src={dataUrl} controls className="max-h-96 max-w-full rounded border border-slate-700" />
          ) : ct.startsWith('audio/') ? (
            <audio src={dataUrl} controls className="w-full" />
          ) : ct.includes('pdf') ? (
            <iframe title="pdf" src={dataUrl} className="w-full h-96 bg-white rounded border border-slate-700" />
          ) : (
            <p className="text-xs text-slate-500 mb-3">Loại file này không preview được — hãy tải về để mở.</p>
          )}
          <button
            onClick={saveFile}
            className="mt-3 text-sm bg-emerald-700 hover:bg-emerald-600 rounded px-4 py-1.5 font-semibold"
          >
            {saved ? 'Đã lưu ✓' : `💾 Tải về (${fileName})`}
          </button>
        </div>
      )}

      {effectiveView === 'pretty' && (
        pretty.ok ? (
          <pre
            className="bg-slate-950 border border-slate-700 rounded p-3 text-xs overflow-auto max-h-96 font-mono"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <div>
            <p className="text-xs text-slate-500 mb-1">Không phải JSON — hiển thị dạng text:</p>
            <pre className="bg-slate-950 border border-slate-700 rounded p-3 text-xs overflow-auto max-h-96 whitespace-pre-wrap font-mono">
              {response.body || '(body trống)'}
            </pre>
          </div>
        )
      )}

      {effectiveView === 'raw' && (
        <pre className="bg-slate-950 border border-slate-700 rounded p-3 text-xs overflow-auto max-h-96 whitespace-pre-wrap font-mono">
          {response.body || '(body trống)'}
        </pre>
      )}

      {effectiveView === 'headers' && (
        <div className="bg-slate-950 border border-slate-700 rounded overflow-hidden">
          {headerEntries.length === 0 && (
            <p className="p-3 text-xs text-slate-500">Không có header.</p>
          )}
          {headerEntries.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[200px_1fr] gap-2 px-3 py-1.5 text-xs border-b border-slate-800/60 last:border-0">
              <span className="font-mono text-sky-300 break-all">{k}</span>
              <span className="font-mono text-slate-200 break-all">{v}</span>
            </div>
          ))}
        </div>
      )}

      {effectiveView === 'preview' && (
        isHtml ? (
          <iframe
            title="preview"
            sandbox=""
            srcDoc={response.body}
            className="w-full h-96 bg-white rounded border border-slate-700"
          />
        ) : (
          <pre className="bg-slate-950 border border-slate-700 rounded p-3 text-xs overflow-auto max-h-96 whitespace-pre-wrap font-mono">
            {response.body || '(body trống)'}
          </pre>
        )
      )}

      {effectiveView === 'tests' && testRun && (
        <div className="flex flex-col gap-1.5">
          {testRun.error && (
            <p className="text-xs bg-red-950 border border-red-800 rounded px-3 py-2 font-mono">
              Script lỗi: {testRun.error}
            </p>
          )}
          {testRun.results.map((r, i) => (
            <div
              key={i}
              className={`rounded px-3 py-1.5 text-xs border ${
                r.passed ? 'bg-emerald-950/50 border-emerald-800' : 'bg-red-950/50 border-red-800'
              }`}
            >
              <span className={r.passed ? 'text-emerald-300' : 'text-red-300'}>
                {r.passed ? '✓ PASS' : '✕ FAIL'}
              </span>{' '}
              <span className="text-slate-200">{r.name}</span>
              {r.error && <span className="block font-mono text-red-300 mt-0.5">{r.error}</span>}
            </div>
          ))}
          {testRun.logs.length > 0 && (
            <pre className="bg-slate-950 border border-slate-700 rounded p-3 text-xs overflow-auto max-h-40 whitespace-pre-wrap font-mono text-slate-400">
              {testRun.logs.join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
