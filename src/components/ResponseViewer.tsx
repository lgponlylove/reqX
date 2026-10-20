import { useMemo, useState } from 'react';
import { useAppStore } from '../stores/app';
import { useRequestStore } from '../stores/request';
import { contentTypeOf, downloadResponse, guessFileName, openDownloadsFolder, responseDataUrl, saveExportBesideApp } from '../lib/response-file';
import { isTauri } from '../lib/http-client';
import { bugFileName, buildBugReport } from '../lib/bug-report';
import { looksSecret } from '../lib/secrets';
import type { ApiRequest } from '../types/api';
import { generateJsonSchema } from '../lib/json-schema';
import ExpandOverlay from './ExpandOverlay';
import AiTestModal from './AiTestModal';
import SseStreamViewer from './SseStreamViewer';
import ResponseVisualizer from './ResponseVisualizer';
import { useTranslation } from '../stores/language';

type View = 'pretty' | 'visualizer' | 'sse' | 'schema' | 'raw' | 'headers' | 'preview' | 'tests' | 'file';

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'bg-emerald-600';
  if (status >= 300 && status < 400) return 'bg-sky-600';
  if (status >= 400 && status < 500) return 'bg-amber-600';
  if (status >= 500) return 'bg-red-600';
  return 'bg-slate-600';
}

export function formatSize(bytes: number): string {
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

export default function ResponseViewer({ onCollapse }: { onCollapse?: () => void }) {
  const { t: i18n } = useTranslation();
  const { response, sendError, sending, testRun, setResponse } = useAppStore();
  const [view, setView] = useState<View>('pretty');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [folderMsg, setFolderMsg] = useState('');
  const [schemaLocked, setSchemaLocked] = useState(false);
  const [copiedSchema, setCopiedSchema] = useState(false);
  // Response dài bị chặn ở max-h-96 → ô ⤢ mở toàn bộ nội dung trong popup
  const [expanded, setExpanded] = useState(false);
  const [showAiTestModal, setShowAiTestModal] = useState(false);
  /** Form "🐞 Báo lỗi": 2 ô tự giải thích + mong đợi, sinh file .md đính ticket. */
  const [bug, setBug] = useState<{ expected: string; note: string } | null>(null);
  const [bugCopied, setBugCopied] = useState(false);

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

  if (sending && !response) {
    return (
      <div className="border border-slate-700 rounded p-6 text-center text-slate-300">
        <span className="animate-pulse">{i18n.response.sendingState}</span>
      </div>
    );
  }

  if (!response) {
    if (sendError) {
      return (
        <div className="border border-rose-800 bg-rose-950/60 rounded-lg p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-rose-400 text-xs font-bold shrink-0">⚠ {i18n.response.errorTitle}</span>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(sendError);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard bị chặn — bỏ qua, người dùng vẫn bôi đen được */
                }
              }}
              className="text-[11px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              {copied ? '✓' : i18n.response.copyError}
            </button>
            {onCollapse && (
              <button
                onClick={onCollapse}
                title={i18n.response.collapsePanel}
                className="ml-auto text-xs text-slate-500 hover:text-slate-200"
              >
                ▾ {i18n.response.collapsePanel}
              </button>
            )}
          </div>
          <p className="mt-1.5 font-mono text-xs text-rose-300 whitespace-pre-wrap break-all">{sendError}</p>
          <p className="mt-2 text-[11px] text-slate-400">{i18n.response.errorHint}</p>
        </div>
      );
    }
    return (
      <div className="border border-dashed border-slate-700 rounded p-6 text-center text-slate-400">
        {i18n.response.noResponse}
        {onCollapse && (
          <div className="mt-2">
            <button
              onClick={onCollapse}
              title={i18n.response.collapsePanel}
              className="text-xs text-slate-500 hover:text-slate-200"
            >
              ▾ {i18n.response.collapsePanel}
            </button>
          </div>
        )}
      </div>
    );
  }

  const headerEntries = Object.entries(response.headers);
  const isBinary = response.bodyKind === 'binary';
  const isSse = Boolean(response.isStream || (response.sseEvents && response.sseEvents.length > 0));
  // Binary thì các tab text không có ý nghĩa → ép sang tab File; Nếu là SSE thì mặc định view sse
  const effectiveView: View =
    isBinary && (view === 'pretty' || view === 'visualizer' || view === 'raw' || view === 'preview' || view === 'sse')
      ? 'file'
      : (view === 'pretty' && isSse && !pretty.ok)
        ? 'sse'
        : view;
  const ct = contentTypeOf(response.headers).toLowerCase();
  const dataUrl = responseDataUrl(response);
  const fileName = guessFileName(response);
  const isHtml =
    !isBinary && (ct.includes('html') || /^\s*</.test(response.body));
  const passed = testRun?.results.filter((r) => r.passed).length ?? 0;
  const failed = (testRun?.results.length ?? 0) - passed;

  /**
   * Khung nội dung (pretty / visualizer / raw / preview / sse). `tall=true` là bản trong popup phóng to:
   * lấp đầy khung thay vì bị chặn `max-h-96` như ô nhỏ.
   */
  const bodyPane = (tall: boolean) => {
    const H = tall ? 'flex-1 min-h-0' : 'max-h-96';
    return (
      <>
        {effectiveView === 'sse' && (
          <SseStreamViewer response={response} tall={tall} />
        )}

        {effectiveView === 'visualizer' && (
          <ResponseVisualizer response={response} testRun={testRun} tall={tall} />
        )}

        {effectiveView === 'pretty' && (
          pretty.ok ? (
            <div className={`bg-slate-950 dark:bg-[#0b1219] border border-slate-750 dark:border-slate-800 rounded-lg overflow-hidden flex font-mono text-xs shadow-inner ${H}`}>
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
            <div className={tall ? 'flex-1 min-h-0 flex flex-col' : ''}>
              <p className="text-xs text-slate-500 mb-1">Không phải JSON — hiển thị dạng text:</p>
              <pre className={`bg-slate-950 dark:bg-[#0b1219] border border-slate-750 dark:border-slate-800 rounded p-3 text-xs overflow-auto whitespace-pre-wrap font-mono ${H}`}>
                {response.body || '(body trống)'}
              </pre>
            </div>
          )
        )}

        {effectiveView === 'raw' && (
          <pre className={`bg-slate-950 border border-slate-700 rounded p-3 text-xs overflow-auto whitespace-pre-wrap font-mono ${H}`}>
            {response.body || '(body trống)'}
          </pre>
        )}

        {effectiveView === 'preview' && (
          isHtml ? (
            <iframe
              title="preview"
              sandbox=""
              srcDoc={response.body}
              className={`w-full bg-white rounded border border-slate-700 ${tall ? 'flex-1 min-h-0' : 'h-96'}`}
            />
          ) : (
            <pre className={`bg-slate-950 border border-slate-700 rounded p-3 text-xs overflow-auto whitespace-pre-wrap font-mono ${H}`}>
              {response.body || '(body trống)'}
            </pre>
          )
        )}
      </>
    );
  };
  const isTextPane = !isBinary && (effectiveView === 'pretty' || effectiveView === 'visualizer' || effectiveView === 'raw' || effectiveView === 'preview');

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

  /**
   * Gom mọi giá trị nghi là secret đang có trong RAM (biến env/global + auth + header).
   * Regex theo tên không bọc hết được (token nhúng trong body, apikey tự đặt tên),
   * nên xóa theo CHÍNH giá trị — bằng chứng lỗi mang ra ngoài project.
   */
  function collectSecretValues(req: ApiRequest, envVars: Record<string, string>, globals: Record<string, string>, st: ReturnType<typeof useAppStore.getState>): string[] {
    const out: string[] = [];
    const env = st.environments.find((e) => e.id === st.activeEnvId);
    for (const [k, v] of Object.entries(envVars)) if (looksSecret(k, v)) out.push(v);
    for (const [k, v] of Object.entries(globals)) if (looksSecret(k, v)) out.push(v);
    for (const k of st.envSecrets[env?.id ?? ''] ?? []) {
      const v = env?.variables[k];
      if (v) out.push(v);
    }
    for (const k of st.globalSecrets ?? []) {
      const v = globals[k];
      if (v) out.push(v);
    }
    // auth: mọi chuỗi đủ dài bên trong (token/password/apiKey/clientSecret…)
    for (const v of Object.values(req.auth as unknown as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length >= 6) out.push(v);
      else if (v && typeof v === 'object') {
        for (const inner of Object.values(v as Record<string, unknown>)) {
          if (typeof inner === 'string' && inner.length >= 6) out.push(inner);
        }
      }
    }
    for (const h of req.headers) if (h.enabled && looksSecret(h.key, h.value)) out.push(h.value);
    return out;
  }

  function buildBugMarkdown(expected: string, note: string): string {
    const st = useAppStore.getState();
    const req = useRequestStore.getState().current;
    const env = st.environments.find((e) => e.id === st.activeEnvId);
    const envVars = env?.variables ?? {};
    return buildBugReport({
      req,
      res: response!,
      envName: env?.name,
      envVars,
      globalVars: st.globals,
      testRun,
      expected,
      note,
      secretValues: collectSecretValues(req, envVars, st.globals, st),
    });
  }

  /** saveExportBesideApp chỉ có trên bản desktop — web thì tải về thư mục Downloads. */
  async function saveBugReport(md: string) {
    const fname = bugFileName(useRequestStore.getState().current);
    const saved = await saveExportBesideApp(fname, md);
    if (saved) {
      alert(`Đã lưu bằng chứng lỗi:\n${saved.path}`);
      return;
    }
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);
    alert('Đã tải bằng chứng lỗi về thư mục Downloads.');
  }

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
      {/* Response Header with Metrics — MỘT dòng, dính đỉnh khi cuộn (pane cha là overflow-y-auto).
          mb đổi thành pb để phần nền dính header lấp kín, không hở 1 dải cho nội dung lọt qua. */}
      <div className="sticky top-0 z-20 flex flex-nowrap items-center gap-2 pb-2.5 border-b border-slate-800 bg-slate-900/95 dark:bg-[#0a121c]/95 backdrop-blur-md overflow-x-auto">
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 pb-0.5 border-b-2 border-emerald-400">
            <h2 className="font-bold text-xs text-white whitespace-nowrap">Response</h2>
          </div>

          {onCollapse && (
            <button
              onClick={onCollapse}
              title={i18n.response.collapsePanel}
              className="text-slate-500 hover:text-white transition-colors px-1 text-xs shrink-0"
            >
              ▾
            </button>
          )}

          {/* Sub-tabs */}
          <div className="flex items-center gap-0.5 ml-1 shrink-0">
            {(
              (isBinary
                ? [
                    ['file', `📁 File (${fileName})`],
                    ['headers', `Headers (${headerEntries.length})`],
                    ...(testRun ? [['tests', `Tests (${testRun.results.length})`] as [View, string]] : []),
                  ]
                : [
                    ...(isSse ? ([['sse', `📡 SSE Stream (${response.sseEvents?.length || 0})`]] as [View, string][]) : []),
                    ['pretty', `${i18n.response.pretty}${pretty.ok ? ' (JSON)' : ''}`],
                    ...(pretty.ok || testRun?.visualizerHtml ? [['visualizer', '📊 Visualize']] as [View, string][] : []),
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
                className={`px-1.5 py-0.5 text-xs rounded whitespace-nowrap transition-colors ${
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
        <div className="flex items-center gap-1.5 text-xs shrink-0 ml-auto pl-2">
          {response.isStream && !response.streamCompleted ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              LIVE STREAM
            </span>
          ) : isSse ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-800/80 whitespace-nowrap">
              SSE ({response.sseEvents?.length || 0})
            </span>
          ) : null}
          <span className="text-emerald-400 font-bold flex items-center gap-1 font-mono whitespace-nowrap">
            <span>⇄</span> {response.status} {response.statusText}
          </span>
          <span className="text-emerald-400 font-mono font-medium whitespace-nowrap">
            {response.timeMs} ms
          </span>
          <span className="text-emerald-400 font-mono font-medium whitespace-nowrap">
            {formatSize(response.sizeBytes)}
          </span>
          <button
            onClick={() => setResponse(null)}
            title={i18n.response.clear}
            className="text-slate-500 hover:text-rose-400 transition-colors p-0.5 text-xs shrink-0"
          >
            🗑
          </button>
          {!isBinary && (
            <button
              onClick={copyBody}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 whitespace-nowrap"
              title={i18n.common.copy}
            >
              {copied ? i18n.common.copied : `📋 ${i18n.common.copy}`}
            </button>
          )}
          {isTextPane && (
            <button
              onClick={() => setExpanded(true)}
              title={i18n.request.expandHint}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 whitespace-nowrap"
            >
              {i18n.request.expand}
            </button>
          )}
          <button
            onClick={saveFile}
            className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 whitespace-nowrap"
            title={isBinary ? undefined : i18n.response.saveFile}
          >
            {saved ? '✓' : `💾 ${i18n.response.saveFile}`}
          </button>
          {!isBinary && pretty.ok && generatedSchema && (
            <button
              onClick={lockSchema}
              className={`text-xs rounded px-1.5 py-0.5 font-semibold transition-all border whitespace-nowrap ${
                schemaLocked
                  ? 'bg-cyan-900 text-cyan-200 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.6)]'
                  : 'bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border-cyan-700/80 hover:border-cyan-400'
              }`}
              title={i18n.response.lockSchema}
            >
              {schemaLocked ? i18n.response.schemaLocked : `🧬 ${i18n.response.lockSchema}`}
            </button>
          )}
          {!isBinary && (
            <button
              type="button"
              onClick={() => setShowAiTestModal(true)}
              className="text-xs rounded px-2 py-0.5 font-semibold transition-all border whitespace-nowrap bg-fuchsia-950/80 hover:bg-fuchsia-900 text-fuchsia-300 border-fuchsia-700/80 hover:border-fuchsia-400 flex items-center gap-1 shadow-sm"
              title="Tự động sinh kịch bản kiểm thử assertions từ Response mẫu"
            >
              <span>✨</span>
              <span>AI Sinh Test</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setBug(bug ? null : { expected: '', note: '' })}
            className={`text-xs rounded px-2 py-0.5 font-semibold transition-all border whitespace-nowrap flex items-center gap-1 ${
              bug
                ? 'bg-rose-800 text-white border-rose-400'
                : 'bg-rose-950/80 hover:bg-rose-900 text-rose-300 border-rose-800/80 hover:border-rose-500'
            }`}
            title="Xuất bằng chứng lỗi 1 click: file .md dán thẳng vào ticket (token/cookie tự che)"
          >
            <span>🐞</span>
            <span>Báo lỗi</span>
          </button>
        </div>
      </div>

      {bug && response && (
        <div className="mb-2.5 rounded border border-rose-800/70 bg-rose-950/30 p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-rose-100">
              🐞 Bằng chứng lỗi — file .md đính vào ticket, khỏi chụp màn hình
            </span>
            <button
              onClick={() => setBug(null)}
              title="Đóng"
              className="text-slate-400 hover:text-white text-xs px-1"
            >
              ✕
            </button>
          </div>
          <label className="flex flex-col gap-1 text-[11px] text-slate-300">
            Điều mong đợi (Dev cần biết bạn kỳ vọng gì)
            <textarea
              value={bug.expected}
              onChange={(e) => setBug({ ...bug, expected: e.target.value })}
              rows={2}
              placeholder="VD: POST /login phải trả 200 kèm access_token — thực tế trả 500."
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100 resize-y min-h-14"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-300">
            Ghi nhận của người test (làm gì, thấy gì, mức độ)
            <textarea
              value={bug.note}
              onChange={(e) => setBug({ ...bug, note: e.target.value })}
              rows={2}
              placeholder="VD: chỉ xảy với env Staging, tái hiện 3/3 lần, block test đăng nhập."
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100 resize-y min-h-14"
            />
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => saveBugReport(buildBugMarkdown(bug.expected, bug.note))}
              className="text-xs bg-rose-700 hover:bg-rose-600 text-white rounded px-2.5 py-1 font-semibold whitespace-nowrap"
            >
              💾 Lưu file .md
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(buildBugMarkdown(bug.expected, bug.note));
                  setBugCopied(true);
                  window.setTimeout(() => setBugCopied(false), 1500);
                } catch {
                  setBugCopied(false);
                }
              }}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded px-2.5 py-1 whitespace-nowrap"
            >
              {bugCopied ? '✓ Đã chép' : '📋 Sao chép'}
            </button>
            <span className="text-[11px] text-rose-200/80">
              Token / cookie / password tự động che. Cần số liệu đầy đủ thì mở lại ReqX.
            </span>
          </div>
        </div>
      )}

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

      {bodyPane(false)}

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

      {expanded && (
        <ExpandOverlay title={i18n.response.expandTitle} onClose={() => setExpanded(false)}>
          {bodyPane(true)}
        </ExpandOverlay>
      )}

      {showAiTestModal && <AiTestModal onClose={() => setShowAiTestModal(false)} />}
    </div>
  );
}
