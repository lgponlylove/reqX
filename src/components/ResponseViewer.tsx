import { useMemo, useState } from 'react';
import { useAppStore } from '../stores/app';
import { useRequestStore } from '../stores/request';
import { contentTypeOf, downloadResponse, guessFileName, openDownloadsFolder, responseDataUrl } from '../lib/response-file';
import { isTauri } from '../lib/http-client';
import { generateJsonSchema } from '../lib/json-schema';
import { useTranslation } from '../stores/language';

type View = 'pretty' | 'schema' | 'raw' | 'headers' | 'preview' | 'tests' | 'file';

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
  const { t: i18n } = useTranslation();
  const { response, sending, testRun, setResponse } = useAppStore();
  const [view, setView] = useState<View>('pretty');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [folderMsg, setFolderMsg] = useState('');
  const [schemaLocked, setSchemaLocked] = useState(false);
  const [copiedSchema, setCopiedSchema] = useState(false);

  const pretty = useMemo(
    () => (response && response.bodyKind !== 'binary' ? tryPretty(response.body) : { ok: false, text: '' }),
    [response],
  );
  const highlighted = useMemo(
    () => (pretty.ok ? highlightJson(pretty.text) : ''),
    [pretty],
  );
  const lineCount = useMemo(() => (pretty.ok ? pretty.text.split('\n').length : 0), [pretty]);

  const generatedSchema = useMemo(() => {
    if (!pretty.ok || !response?.body) return null;
    try {
      const parsed = JSON.parse(response.body);
      return generateJsonSchema(parsed);
    } catch {
      return null;
    }
  }, [pretty.ok, response?.body]);

  const schemaPrettyText = useMemo(() => {
    return generatedSchema ? JSON.stringify(generatedSchema, null, 2) : '';
  }, [generatedSchema]);

  const schemaHighlighted = useMemo(() => {
    return schemaPrettyText ? highlightJson(schemaPrettyText) : '';
  }, [schemaPrettyText]);

  if (sending) {
    return (
      <div className="border border-slate-700 rounded p-6 text-center text-slate-300">
        <span className="animate-pulse">{i18n.response.sendingState}</span>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="border border-dashed border-slate-700 rounded p-6 text-center text-slate-400">
        {i18n.response.noResponse}
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

  async function copySchema() {
    if (!schemaPrettyText) return;
    try {
      await navigator.clipboard.writeText(schemaPrettyText);
      setCopiedSchema(true);
      window.setTimeout(() => setCopiedSchema(false), 1500);
    } catch {
      setCopiedSchema(false);
    }
  }

  function lockSchema() {
    if (!generatedSchema) return;
    const testSnippet = `\n// --- Tự động xác thực JSON Schema ---\npm.test("Validate JSON Schema", () => {\n  pm.response.to.have.jsonSchema(${schemaPrettyText});\n});\n`;
    const cur = useRequestStore.getState().current;
    const existing = (cur.tests ?? '').trim();
    const updated = existing ? `${existing}\n${testSnippet}` : testSnippet.trimStart();
    useRequestStore.getState().set({ tests: updated });
    setSchemaLocked(true);
    window.setTimeout(() => setSchemaLocked(false), 2500);
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
      {/* Response Header with Metrics (⇄ Status, Time, Size, Clear) */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2 pb-1.5 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 pb-0.5 border-b-2 border-emerald-400">
            <h2 className="font-bold text-xs text-white">Response</h2>
          </div>
          <span className="text-xs text-slate-500 font-medium">Viewer</span>

          {/* Sub-tabs */}
          <div className="flex items-center gap-1 ml-2">
            {(
              (isBinary
                ? [
                    ['file', `📁 File (${fileName})`],
                    ['headers', `Headers (${headerEntries.length})`],
                    ...(testRun ? [['tests', `Tests (${testRun.results.length})`] as [View, string]] : []),
                  ]
                : [
                    ['pretty', `${i18n.response.pretty}${pretty.ok ? ' (JSON)' : ''}`],
                    ...(pretty.ok ? [['schema', '🛡️ Schema']] as [View, string][] : []),
                    ['raw', i18n.response.raw],
                    ['headers', `${i18n.response.headersTab} (${headerEntries.length})`],
                    ['preview', i18n.response.preview],
                    ...(testRun ? [['tests', `Tests (${testRun.results.length})`] as [View, string]] : []),
                  ]) as [View, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  effectiveView === id
                    ? 'bg-slate-800 font-semibold text-emerald-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Right side metrics matching mockup */}
        <div className="flex items-center gap-3 text-xs">
          <span className="text-emerald-400 font-bold flex items-center gap-1 font-mono">
            <span>⇄</span> {response.status} {response.statusText}
          </span>
          <span className="text-emerald-400 font-mono font-medium">
            {response.timeMs} ms
          </span>
          <span className="text-emerald-400 font-mono font-medium">
            {formatSize(response.sizeBytes)}
          </span>
          <button
            onClick={() => setResponse(null)}
            title={i18n.response.clear}
            className="text-slate-500 hover:text-rose-400 transition-colors p-0.5 text-xs"
          >
            🗑
          </button>
          <button
            onClick={saveFile}
            className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded px-2 py-0.5"
            title={isBinary ? undefined : i18n.response.saveFile}
          >
            {saved ? '✓' : `💾 ${i18n.response.saveFile}`}
          </button>
          {!isBinary && pretty.ok && generatedSchema && (
            <button
              onClick={lockSchema}
              className={`text-xs rounded px-2 py-0.5 font-semibold transition-all border ${
                schemaLocked
                  ? 'bg-cyan-900 text-cyan-200 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.6)]'
                  : 'bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border-cyan-700/80 hover:border-cyan-400'
              }`}
              title={i18n.response.lockSchema}
            >
              {schemaLocked ? i18n.response.schemaLocked : `✨ ${i18n.response.lockSchema}`}
            </button>
          )}
        </div>
      </div>

      {effectiveView === 'schema' && generatedSchema && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between bg-slate-900/80 border border-slate-800 rounded px-3 py-2 text-xs">
            <span className="text-slate-300">
              🧬 <b className="text-cyan-400">JSON Schema (Draft-07)</b> {i18n.response.schemaAuto}
            </span>
            <div className="flex gap-2">
              <button
                onClick={copySchema}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded transition-colors"
              >
                {copiedSchema ? i18n.common.copied : `📋 ${i18n.response.copySchema}`}
              </button>
              <button
                onClick={lockSchema}
                className="bg-cyan-900 hover:bg-cyan-800 text-cyan-200 border border-cyan-600 px-2.5 py-1 rounded font-semibold transition-colors"
              >
                {schemaLocked ? i18n.response.schemaLocked : `🔒 ${i18n.response.lockSchema}`}
              </button>
            </div>
          </div>
          <pre
            className="bg-slate-950 border border-slate-700 rounded p-3 text-xs overflow-auto max-h-96 font-mono"
            dangerouslySetInnerHTML={{ __html: schemaHighlighted }}
          />
        </div>
      )}

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
          <div className="bg-slate-950 dark:bg-[#0b1219] border border-slate-750 dark:border-slate-800 rounded-lg overflow-hidden flex font-mono text-xs max-h-96 shadow-inner">
            <div className="bg-slate-900 dark:bg-[#080e14] py-3 px-3 text-right select-none text-slate-400 dark:text-slate-600 border-r border-slate-750 dark:border-slate-800/80 text-[11px] leading-relaxed">
              {Array.from({ length: lineCount }).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <pre
              className="flex-1 p-3 overflow-auto whitespace-pre leading-relaxed font-mono"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </div>
        ) : (
          <div>
            <p className="text-xs text-slate-500 mb-1">Không phải JSON — hiển thị dạng text:</p>
            <pre className="bg-slate-950 dark:bg-[#0b1219] border border-slate-750 dark:border-slate-800 rounded p-3 text-xs overflow-auto max-h-96 whitespace-pre-wrap font-mono">
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
