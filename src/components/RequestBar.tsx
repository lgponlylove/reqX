import { useEffect, useMemo, useRef, useState } from 'react';
import { useRequestStore } from '../stores/request';
import { useAppStore } from '../stores/app';
import { sendRequest } from '../lib/http-client';
import { toCurl, toFetch, toPython } from '../lib/codegen';
import { runPreRequestChain, runTestsChain, type MutableRequest } from '../lib/scripts';
import { generateCases } from '../lib/test-cases';
import { useTestCaseStore } from '../stores/testcases';
import { scriptChainFor } from '../lib/script-chain';
import { uid, resolveVariables } from '../lib/variables';
import VarHighlightInput from './VarHighlightInput';
import { useTranslation } from '../stores/language';
import type { HttpMethod, ApiRequest } from '../types/api';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const TIMEOUT_KEY = 'postman-clone-timeout-s';

export default function RequestBar() {
  const { t: i18n } = useTranslation();
  const { current, set, dirty, markClean } = useRequestStore();
  const {
    environments, activeEnvId, globals, requests, collections, saveRequest, pushHistory,
    setResponse, setTestRun, sending, setSending,
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

  const envVars = environments.find((e) => e.id === activeEnvId)?.variables ?? {};

  const curl = useMemo(() => toCurl(current, envVars, globals), [current, envVars, globals]);
  const code = useMemo(() => {
    if (codeLang === 'fetch') return toFetch(current, envVars, globals);
    if (codeLang === 'python') return toPython(current, envVars, globals);
    return curl;
  }, [codeLang, current, envVars, globals, curl]);

  const hasVar = (name: string) => name in envVars || name in globals;
  const missingVars = useMemo(
    () => resolveVariables(current.url, envVars, globals).missing,
    [current.url, envVars, globals],
  );

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

  function changeTimeout(v: number) {
    const clamped = Math.min(300, Math.max(5, Math.floor(v) || 30));
    setTimeoutS(clamped);
    localStorage.setItem(TIMEOUT_KEY, String(clamped));
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
      if (e instanceof DOMException && e.name === 'AbortError') {
        setError(cancelledRef.current ? 'Đã hủy request.' : `Timeout sau ${timeoutS}s (hoặc đã hủy).`);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Modern Cyber URL Bar Group */}
      <div className="flex items-center gap-2 bg-slate-950 dark:bg-[#0c141e] border border-slate-750 dark:border-slate-800 hover:border-slate-700 focus-within:border-emerald-500/50 p-1.5 rounded-lg shadow-inner transition-all">
        <div className="relative">
          <select
            className="bg-emerald-500/15 dark:bg-[#122e2c] border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 font-mono font-bold text-xs rounded-md px-3 py-2 outline-none appearance-none pr-6 cursor-pointer transition-colors"
            value={current.method}
            onChange={(e) => set({ method: e.target.value as HttpMethod })}
          >
            {METHODS.map((m) => (
              <option key={m} value={m} className="bg-slate-900 text-slate-100 font-bold">{m}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-emerald-400">▼</span>
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
            className="bg-rose-600 hover:bg-rose-500 text-white rounded-md px-5 py-2 font-bold text-xs shadow-md shadow-rose-900/40 flex items-center gap-1.5 transition-all"
          >
            <span>⏹</span> {i18n.common.cancel}
          </button>
        ) : (
          <button
            onClick={onSend}
            className="bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs rounded-md px-5 py-2 shadow-[0_0_15px_rgba(52,211,153,0.45)] flex items-center gap-2 transition-all active:scale-95"
          >
            <span>{i18n.request.send}</span>
            <span className="text-[10px] opacity-75">▼</span>
          </button>
        )}

        <div className="h-4 w-[1px] bg-slate-800 mx-0.5" />

        <button
          onClick={openKeyTest}
          disabled={sending}
          className="bg-violet-950/60 hover:bg-violet-900/60 border border-violet-850/80 text-violet-300 disabled:opacity-40 rounded-lg px-2.5 py-2 font-bold text-xs flex items-center gap-1 transition-all"
          title={i18n.request.keyTestTitle}
        >
          <span>🧪</span>
          <span>{i18n.request.keyTest}</span>
        </button>

        <button
          type="button"
          onClick={async () => {
            const { useMockStore } = await import('../stores/mock');
            useMockStore.getState().createRuleFromRequest(current);
            setSavedFlash(`Mock Rule created for ${current.name || current.url}!`);
            window.setTimeout(() => setSavedFlash(''), 2500);
          }}
          disabled={sending}
          className="bg-slate-950/80 hover:bg-slate-850 border border-slate-800 text-purple-300 rounded-lg px-2.5 py-2 font-bold text-xs flex items-center gap-1 transition-all"
          title={i18n.request.mockTitle}
        >
          <span>🎭</span>
          <span>{i18n.request.mock}</span>
        </button>

        <label className="flex items-center gap-1 text-xs text-slate-400" title={i18n.request.timeoutTitle}>
          <input
            type="number"
            min={5}
            max={300}
            value={timeoutS}
            disabled={sending}
            onChange={(e) => changeTimeout(Number(e.target.value))}
            className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-2 text-center font-mono"
          />
          s
        </label>
      </div>
      <div className="flex gap-2">
        <input
          className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm w-1/3"
          placeholder={i18n.request.namePlaceholder}
          value={current.name}
          onChange={(e) => set({ name: e.target.value })}
          title={i18n.request.namePlaceholder}
        />
        <input
          className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm flex-1"
          placeholder={i18n.request.descPlaceholder}
          value={current.description || ''}
          onChange={(e) => set({ description: e.target.value })}
          title={i18n.request.descPlaceholder}
        />
        {!hasOrigin && collections.length > 0 && (
          <select
            value={saveColId || collections[0].id}
            onChange={(e) => setSaveColId(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm max-w-44"
          >
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <button
          onClick={doSave}
          disabled={sending}
          className="bg-sky-700 hover:bg-sky-600 rounded px-4 font-semibold disabled:opacity-40 shrink-0"
        >
          💾 {i18n.request.saveButton}{dirty ? ' ●' : ''}
        </button>
      </div>
      {savedFlash && <p className="text-emerald-400 text-sm">{savedFlash}</p>}
      {error && <p className="text-red-400 text-sm">Error: {error}</p>}
      {missingVars.length > 0 && (
        <p className="text-xs text-red-400">
          Missing variables: {missingVars.map((v) => <code key={v} className="font-mono bg-red-950 rounded px-1">{`{{${v}}}`}</code>)}{' '}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowCurl((v) => !v)}
          className="text-xs bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1 font-mono"
        >
          {showCurl ? i18n.request.hideCode : i18n.request.showCode}
        </button>
        {(Object.entries({ curl: 'cURL', fetch: 'fetch', python: 'Python' }) as ['curl' | 'fetch' | 'python', string][]).map(
          ([id, label]) =>
            showCurl && (
              <button
                key={id}
                onClick={() => setCodeLang(id)}
                className={`text-xs rounded px-2 py-1 font-mono ${
                  codeLang === id ? 'bg-sky-700 font-semibold' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
              >
                {label}
              </button>
            ),
        )}
        <p className="text-xs text-slate-400">
          Môi trường: <b>{environments.find((e) => e.id === activeEnvId)?.name ?? '—'}</b> •
          Mẹo: dùng <code className="text-emerald-300">{'{{baseUrl}}'}</code> trong URL.
        </p>
      </div>
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
