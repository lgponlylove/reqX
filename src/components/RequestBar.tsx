import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRequestStore } from '../stores/request';
import { useAppStore } from '../stores/app';
import { sendRequest } from '../lib/http-client';
import { toCurl, toFetch, toPython } from '../lib/codegen';
import { runPreRequestChain, runTestsChain, type MutableRequest } from '../lib/scripts';
import { generateCases } from '../lib/test-cases';
import { docsFileName, renderSingleRequestDocs } from '../lib/api-docs';
import { renderDocsHtml } from '../lib/docs-html';
import { collectDocsExtras } from '../lib/docs-input';
import { saveDocExport } from '../lib/response-file';
import { useTestCaseStore } from '../stores/testcases';
import { scriptChainFor } from '../lib/script-chain';
import { uid } from '../lib/variables';
import { collectRequestVars } from '../lib/flow';
import VarHighlightInput from './VarHighlightInput';
import QuickAddVar from './QuickAddVar';
import { useTranslation } from '../stores/language';
import type { HttpMethod, ApiRequest } from '../types/api';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const TIMEOUT_KEY = 'postman-clone-timeout-s';

export default function RequestBar() {
  const { t: i18n } = useTranslation();
  const { current, set, dirty, markClean } = useRequestStore();
  const {
    environments, activeEnvId, globals, requests, collections, saveRequest, pushHistory,
    setResponse, setSendError, setTestRun, sending, setSending,
  } = useAppStore();
  const [savedFlash, setSavedFlash] = useState('');
  const [saveColId, setSaveColId] = useState('');
  const [error, setError] = useState('');
  const [timeoutS, setTimeoutS] = useState(() => Number(localStorage.getItem(TIMEOUT_KEY)) || 30);
  const [showCurl, setShowCurl] = useState(false);
  const [codeLang, setCodeLang] = useState<'curl' | 'fetch' | 'python'>('curl');
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  // Menu ▼ của nút Send — cùng idiom portal + fixed với LanguageSwitcher
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  const sendBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

  const showSendMenu = () => {
    const rect = sendBtnRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    setSendMenuOpen(true);
  };
  /** Chạy 1 mục trong menu rồi đóng — async thì vẫn đóng ngay để không chờ thao tác. */
  const fromMenu = (fn: () => void) => () => {
    setSendMenuOpen(false);
    fn();
  };

  const envVars = environments.find((e) => e.id === activeEnvId)?.variables ?? {};

  const curl = useMemo(() => toCurl(current, envVars, globals), [current, envVars, globals]);
  const code = useMemo(() => {
    if (codeLang === 'fetch') return toFetch(current, envVars, globals);
    if (codeLang === 'python') return toPython(current, envVars, globals);
    return curl;
  }, [codeLang, current, envVars, globals, curl]);

  const hasVar = (name: string) => name in envVars || name in globals;
  // Quét cả request chứ không chỉ URL: biến thiếu nằm ở header/body cũng làm gửi sai.
  const missingVars = useMemo(
    () => collectRequestVars(current).filter((v) => !hasVar(v)),
    [current, envVars, globals],
  );
  const [openVar, setOpenVar] = useState('');

  const flash = (msg: string) => {
    setSavedFlash(msg);
    window.setTimeout(() => setSavedFlash(''), 4000);
  };

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  /** Sinh bộ key test từ bản chụp request hiện tại (tab chưa lưu vẫn dùng được) rồi mở bảng duyệt. */
  function openKeyTest() {
    const snapshot: ApiRequest = JSON.parse(JSON.stringify(current));
    useTestCaseStore.getState().setCases(snapshot, generateCases(snapshot, 40));
  }

  /** Xuất tài liệu cho ĐÚNG request đang mở (md để commit, html để mở trình duyệt) — thư mục/collection ở menu chuột phải Sidebar. */
  async function exportDocs(format: 'md' | 'html') {
    const env = { name: environments.find((e) => e.id === activeEnvId)?.name, variables: envVars, globals };
    const extras = collectDocsExtras();
    const md = renderSingleRequestDocs(current, { env, ...extras });
    const html = format === 'html' ? renderDocsHtml(md, { lang: extras.lang }) : '';
    const fname = docsFileName(current.name || current.url || 'request', format);
    try {
      setSavedFlash(`📄 ${i18n.request.docsSaved}: ${await saveDocExport(fname, format === 'html' ? html : md, format)}`);
    } catch (e) {
      setError(i18n.request.docsFailed + ': ' + (e instanceof Error ? e.message : String(e)));
      return;
    }
    window.setTimeout(() => setSavedFlash(''), 4500);
  }

  function changeTimeout(v: number) {
    const clamped = Math.min(300, Math.max(5, Math.floor(v) || 30));
    setTimeoutS(clamped);
    localStorage.setItem(TIMEOUT_KEY, String(clamped));
  }

  /** Đóng menu Send khi Esc hoặc khi trang cuộn/dổi cỡ (vị trí menu tính 1 lần lúc mở). */
  useEffect(() => {
    if (!sendMenuOpen) return;
    const close = () => setSendMenuOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [sendMenuOpen]);

  async function createMockRule() {
    const { useMockStore } = await import('../stores/mock');
    useMockStore.getState().createRuleFromRequest(current);
    setSavedFlash(`Mock Rule created for ${current.name || current.url}!`);
    window.setTimeout(() => setSavedFlash(''), 2500);
  }

  function onCancel() {
    cancelledRef.current = true;
    abortRef.current?.abort();
  }

  /** Request mở từ collection thì còn gốc → ghi đè tại chỗ; tab mới thì tạo vào collection đã chọn. */
  const hasOrigin = !!current.id && !!requests[current.id];
  const originCol = hasOrigin
    ? collections.find((c) => c.id === requests[current.id].collectionId)?.name ?? null
    : null;
  function doSave() {
    const target = hasOrigin ? undefined : (saveColId || collections[0]?.id);
    if (!hasOrigin && !target) {
      setError('Chưa có collection nào để lưu — tạo collection trước (tab Collections).');
      return;
    }
    const saved = saveRequest(current, target);
    if (!saved) {
      setError('Không lưu được request.');
      return;
    }
    set({ id: saved.id, origin: undefined });
    markClean();
    setSavedFlash(hasOrigin ? `Đã lưu ✓ (ghi đè trong “${originCol ?? 'collection'}”)` : 'Đã lưu ✓ (request mới)');
    window.setTimeout(() => setSavedFlash(''), 2500);
  }
  const saveRef = useRef(doSave);
  saveRef.current = doSave;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function onSend() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    cancelledRef.current = false;
    setSending(true);
    setError('');
    setResponse(null);
    setTestRun(null);
    try {
      // 1. Pre-request script (được sửa biến + request trên bản copy để gửi)
      const st = useAppStore.getState();
      const mutable: MutableRequest = {
        url: current.url,
        headers: Object.fromEntries(
          current.headers.filter((h) => h.enabled && h.key.trim() !== '').map((h) => [h.key, h.value]),
        ),
        body: current.body,
      };
      const merged = (): Record<string, string> => {
        const s = useAppStore.getState();
        return {
          ...s.globals,
          ...(s.environments.find((e) => e.id === s.activeEnvId)?.variables ?? {}),
        };
      };
      const varCtx = () => {
        const s = useAppStore.getState();
        return {
          env: {
            get: (k: string) => s.environments.find((e) => e.id === s.activeEnvId)?.variables[k],
            set: (k: string, v: string) => {
              const id = useAppStore.getState().activeEnvId;
              if (id) useAppStore.getState().setEnvVar(id, k, v);
            },
          },
          globals: {
            get: (k: string) => s.globals[k],
            set: (k: string, v: string) => useAppStore.getState().setGlobal(k, v),
          },
          merged: merged(),
        };
      };
      const chain = scriptChainFor(st.collections, current);
      const pre = await runPreRequestChain(chain.pre, { ...varCtx(), request: mutable });
      if (pre.error) {
        setError(`Pre-request lỗi: ${pre.error}`);
        return;
      }
      // Ghép request đã bị script sửa vào bản copy để gửi
      const effective: ApiRequest = { ...current, url: mutable.url, body: mutable.body };
      {
        const seen = new Set<string>();
        const nextHeaders = current.headers.map((h) => {
          if (!h.enabled || h.key.trim() === '' || !(h.key in mutable.headers)) return h;
          seen.add(h.key);
          return { ...h, value: mutable.headers[h.key] };
        });
        for (const [k, v] of Object.entries(mutable.headers)) {
          if (!seen.has(k) && !nextHeaders.some((h) => h.key === k)) {
            nextHeaders.push({ id: uid('kv'), key: k, value: v, enabled: true });
          }
        }
        effective.headers = nextHeaders;
      }
      const fresh = useAppStore.getState();
      const freshEnv = fresh.environments.find((e) => e.id === fresh.activeEnvId)?.variables ?? {};
      const freshGlobals = fresh.globals;

      // 2. Gửi
      const res = await sendRequest(effective, freshEnv, freshGlobals, timeoutS * 1000, ctrl.signal);
      setResponse(res);

      // 3. Tests script (request → folder → collection)
      if (chain.tests.length > 0) {
        const outcome = await runTestsChain(chain.tests, res, varCtx());
        setTestRun(outcome);
      }

      pushHistory({
        id: uid('his'),
        request: { ...effective },
        responseStatus: res.status,
        timeMs: res.timeMs,
        createdAt: Date.now(),
        response: res,
      });
    } catch (e) {
      // Lỗi gửi/timeout → đẩy xuống bảng Response (thẻ đỏ) thay vì dải chữ dưới thanh URL
      if (e instanceof DOMException && e.name === 'AbortError') {
        setSendError(cancelledRef.current ? 'Đã hủy request.' : `Timeout sau ${timeoutS}s (hoặc đã hủy).`);
      } else {
        setSendError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Modern Cyber URL Bar Group */}
      <div className="flex items-center gap-2 bg-slate-950 dark:bg-[#0c141e] border border-slate-750 dark:border-slate-800 hover:border-slate-700 focus-within:border-emerald-500/50 p-1 rounded-lg shadow-inner transition-all">
        <div className="relative">
          <select
            className="bg-emerald-500/15 dark:bg-[#122e2c] border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 font-mono font-bold text-[11px] rounded-md px-2.5 py-1.5 outline-none appearance-none pr-5 cursor-pointer transition-colors"
            value={current.method}
            onChange={(e) => set({ method: e.target.value as HttpMethod })}
          >
            {METHODS.map((m) => (
              <option key={m} value={m} className="bg-slate-900 text-slate-100 font-bold">{m}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] text-emerald-400">▼</span>
        </div>

        <div className="flex-1 min-w-0">
          <VarHighlightInput
            value={current.url}
            onChange={(v) => set({ url: v })}
            placeholder={i18n.request.urlPlaceholder}
            hasVar={hasVar}
          />
        </div>

        {sending ? (
          <button
            onClick={onCancel}
            className="bg-rose-600 hover:bg-rose-500 text-white rounded-md px-4 py-1.5 font-bold text-xs shadow-md shadow-rose-900/40 flex items-center gap-1.5 transition-all shrink-0"
          >
            <span>⏹</span> {i18n.common.cancel}
          </button>
        ) : (
          <div className="flex items-stretch shrink-0 rounded-md overflow-hidden shadow-[0_0_15px_rgba(52,211,153,0.45)]">
            <button
              onClick={onSend}
              className="bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs px-4 py-1.5 transition-all active:scale-95"
            >
              {i18n.request.send}
            </button>
            <button
              ref={sendBtnRef}
              type="button"
              onClick={() => (sendMenuOpen ? setSendMenuOpen(false) : showSendMenu())}
              title={i18n.request.sendMenuTitle}
              aria-haspopup="menu"
              aria-expanded={sendMenuOpen}
              className="bg-emerald-400 hover:bg-emerald-300 text-slate-950 text-[10px] px-1.5 border-l border-emerald-600/40 transition-all"
            >
              ▼
            </button>
          </div>
        )}
      </div>

      {/* Menu ▼ — trước đây Key test / Mock / Timeout là 3 nút rời + divider chiếm ~230px
          trên hàng URL; gom vào đây để ô URL dài ra và hàng đỡ rối. */}
      {sendMenuOpen &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[9998]" onClick={() => setSendMenuOpen(false)} />
            <div
              style={{ top: menuPos.top, right: menuPos.right }}
              role="menu"
              className="fixed z-[9999] w-60 bg-slate-900 dark:bg-[#0c1622] border border-teal-500/40 rounded-xl p-1 shadow-[0_4px_25px_rgba(0,0,0,0.85)] backdrop-blur-xl text-xs"
            >
              <button
                role="menuitem"
                onClick={fromMenu(openKeyTest)}
                title={i18n.request.keyTestTitle}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 flex items-center gap-2 text-violet-300"
              >
                <span>🧪</span> {i18n.request.keyTest}
              </button>
              <button
                role="menuitem"
                onClick={fromMenu(() => void createMockRule())}
                title={i18n.request.mockTitle}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 flex items-center gap-2 text-purple-300"
              >
                <span>🎭</span> {i18n.request.mockFromRequest}
              </button>
              <button
                role="menuitem"
                onClick={fromMenu(() => void exportDocs('md'))}
                title={i18n.request.docsApiTitle}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 flex items-center gap-2 text-sky-300"
              >
                <span>📄</span> {i18n.request.docsApi}
              </button>
              <button
                role="menuitem"
                onClick={fromMenu(() => void exportDocs('html'))}
                title={i18n.request.docsHtmlTitle}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 flex items-center gap-2 text-cyan-300"
              >
                <span>🌐</span> {i18n.request.docsHtml}
              </button>
              <div className="my-1 border-t border-slate-800" />
              <label
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-800/60 text-slate-300"
                title={i18n.request.timeoutTitle}
              >
                <span>⏱ {i18n.request.timeoutLabel}</span>
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={timeoutS}
                    onChange={(e) => changeTimeout(Number(e.target.value))}
                    className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-center font-mono"
                  />
                  s
                </span>
              </label>
            </div>
          </>,
          document.body,
        )}
      <div className="flex items-center gap-2">
        <input
          className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs w-52 shrink-0"
          placeholder={i18n.request.namePlaceholder}
          value={current.name}
          onChange={(e) => set({ name: e.target.value })}
          title={i18n.request.namePlaceholder}
        />
        <input
          className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs flex-1 min-w-0"
          placeholder={i18n.request.descPlaceholder}
          value={current.description || ''}
          onChange={(e) => set({ description: e.target.value })}
          title={i18n.request.descPlaceholder}
        />
        {!hasOrigin && collections.length > 0 && (
          <select
            value={saveColId || collections[0].id}
            onChange={(e) => setSaveColId(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs max-w-36 shrink-0"
          >
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <button
          onClick={doSave}
          disabled={sending}
          className="bg-sky-700 hover:bg-sky-600 rounded px-3 py-1 text-xs font-semibold disabled:opacity-40 shrink-0"
        >
          💾 {i18n.request.saveButton}{dirty ? ' ●' : ''}
        </button>
        {/* Nút "Xem code" (+ 3 nhãn ngôn ngữ khi đang mở) nằm cuối hàng tên/mô tả.
            Dải "Môi trường + mẹo {{baseUrl}}" đã dời xuống cuối bảng Params (RequestTabs) —
            hàng này chỉ còn ô tên, ô mô tả, 💾 và Xem code. */}
        <button
          onClick={() => setShowCurl((v) => !v)}
          className="text-[11px] bg-slate-800 hover:bg-slate-700 rounded px-2 py-1 font-mono shrink-0"
        >
          {showCurl ? i18n.request.hideCode : i18n.request.showCode}
        </button>
        {showCurl &&
          (Object.entries({ curl: 'cURL', fetch: 'fetch', python: 'Python' }) as ['curl' | 'fetch' | 'python', string][]).map(
            ([id, label]) => (
              <button
                key={id}
                onClick={() => setCodeLang(id)}
                className={`text-[11px] rounded px-2 py-1 font-mono shrink-0 ${
                  codeLang === id ? 'bg-sky-700 font-semibold' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
              >
                {label}
              </button>
            ),
          )}
      </div>
      {savedFlash && <p className="text-emerald-400 text-xs">{savedFlash}</p>}
      {error && <p className="text-red-400 text-xs">Error: {error}</p>}
      {missingVars.length > 0 && (
        <div className="text-xs space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-red-400">
            <span>{i18n.request.missingVarsLabel}</span>
            {missingVars.map((v) => (
              <span key={v} className="flex items-center gap-1 bg-red-950 rounded px-1">
                <code className="font-mono">{`{{${v}}}`}</code>
                <button
                  onClick={() => setOpenVar(openVar === v ? '' : v)}
                  title={i18n.request.varAddHereTitle}
                  className={`text-[11px] rounded px-1 ${
                    openVar === v
                      ? 'bg-emerald-700 text-white'
                      : 'text-emerald-300 hover:bg-emerald-900/60'
                  }`}
                >
                  {i18n.request.varAddHere}
                </button>
              </span>
            ))}
          </div>
          {openVar && missingVars.includes(openVar) && (
            <QuickAddVar
              name={openVar}
              onCancel={() => setOpenVar('')}
              onDone={(msg) => {
                setOpenVar('');
                flash(msg);
              }}
            />
          )}
        </div>
      )}
      {showCurl && (
        <div className="relative">
          <pre className="bg-slate-950 border border-slate-700 rounded p-3 pr-20 text-xs overflow-auto max-h-48 whitespace-pre-wrap font-mono">
            {code}
          </pre>
          <button
            onClick={copyCurl}
            className="absolute top-2 right-2 text-xs bg-slate-700 hover:bg-slate-600 rounded px-2.5 py-1"
          >
            {copied ? 'Đã copy ✓' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  );
}
