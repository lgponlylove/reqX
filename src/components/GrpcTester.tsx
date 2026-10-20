import { useMemo, useState } from 'react';
import { useAppStore } from '../stores/app';
import KeyValueEditor from './KeyValueEditor';
import { resolveVariables, uid } from '../lib/variables';
import {
  parseProto, encodeMessage, decodeMessage, frameGrpcWeb, sendGrpcWeb,
  PROTO_SAMPLE, type ParsedProto, type GrpcMethod,
} from '../lib/grpcweb';
import type { KeyValue } from '../types/api';

const LS_PROTO = 'postman-clone-grpc-proto';
const LS_URL = 'postman-clone-grpc-url';

const load = (k: string, fallback: string) => {
  try {
    return localStorage.getItem(k) ?? fallback;
  } catch {
    return fallback;
  }
};

/** Tester gRPC-Web (unary): dán .proto → chọn method → gửi JSON. Cần proxy/server gRPC-Web + CORS. */
export default function GrpcTester() {
  const { environments, activeEnvId, globals } = useAppStore();
  const [protoText, setProtoText] = useState(() => load(LS_PROTO, PROTO_SAMPLE));
  const [baseUrl, setBaseUrl] = useState(() => load(LS_URL, 'http://localhost:8080'));
  const [svcIdx, setSvcIdx] = useState(0);
  const [methodName, setMethodName] = useState('');
  const [meta, setMeta] = useState<KeyValue[]>([]);
  const [bodyJson, setBodyJson] = useState('{\n  "name": "world"\n}');
  const [protoMsg, setProtoMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ status: number; message: string; json?: unknown; timeMs: number } | null>(null);

  const envVars = environments.find((e) => e.id === activeEnvId)?.variables ?? {};

  const { parsed, parseError } = useMemo(() => {
    try {
      return { parsed: parseProto(protoText), parseError: '' };
    } catch (e) {
      return { parsed: null as ParsedProto | null, parseError: e instanceof Error ? e.message : String(e) };
    }
  }, [protoText]);

  const safeSvcIdx = Math.min(svcIdx, Math.max(0, (parsed?.services.length ?? 1) - 1));
  const service = parsed?.services[safeSvcIdx];
  const method: GrpcMethod | undefined =
    service?.methods.find((m) => m.name === methodName) ?? service?.methods[0];
  const streaming = method && (method.clientStreaming || method.serverStreaming);

  const saveProto = (v: string) => {
    setProtoText(v);
    try {
      localStorage.setItem(LS_PROTO, v);
    } catch { /* ignore */ }
  };

  const importFile = (f: File | undefined) => {
    if (!f) return;
    setProtoMsg(`Đang đọc ${f.name}…`);
    const reader = new FileReader();
    reader.onload = () => {
      saveProto(String(reader.result ?? ''));
      setProtoMsg(`Đã nạp ${f.name}.`);
    };
    reader.onerror = () => setProtoMsg(`Đọc file lỗi: ${reader.error?.message ?? '?'}`);
    reader.readAsText(f);
  };

  const importUrl = async (u: string) => {
    const url = u.trim();
    if (!url) return;
    setProtoMsg(`Đang tải ${url}…`);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      saveProto(await res.text());
      setProtoMsg('Đã tải proto từ URL.');
    } catch (e) {
      setProtoMsg(`Tải lỗi (server .proto cần mở CORS): ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const send = async () => {
    if (!parsed || !method || sending) return;
    setError('');
    setResult(null);
    let obj: unknown;
    try {
      const resolved = resolveVariables(bodyJson, envVars, globals).resolved;
      obj = JSON.parse(resolved);
    } catch (e) {
      setError(`Body JSON lỗi: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setSending(true);
    const t0 = performance.now();
    try {
      const bytes = encodeMessage(parsed.root, method.inputType, obj);
      const base = resolveVariables(baseUrl, envVars, globals).resolved.replace(/\/+$/, '');
      const headers: Record<string, string> = {};
      for (const kv of meta) {
        if (kv.enabled && kv.key.trim() !== '') {
          headers[kv.key] = resolveVariables(kv.value, envVars, globals).resolved;
        }
      }
      const out = await sendGrpcWeb(`${base}/${method.path}`, frameGrpcWeb(bytes), headers, 30000);
      const json = out.data ? decodeMessage(parsed.root, method.outputType, out.data) : undefined;
      setResult({ status: out.grpcStatus, message: out.grpcMessage, json, timeMs: Math.round(performance.now() - t0) });
      if (out.grpcStatus !== 0) setError(`gRPC status ${out.grpcStatus}: ${out.grpcMessage || 'lỗi không rõ'}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-slate-500">
        Gọi <b>unary gRPC-Web</b> trực tiếp từ browser (không cần codegen). Streaming chưa hỗ trợ ở bản web —
        cần Envoy / grpcwebproxy (hoặc server bật gRPC-Web) + CORS mở cho origin này.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-2 flex-wrap">
            File .proto
            <button
              onClick={() => saveProto(PROTO_SAMPLE)}
              className="text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-0.5"
            >
              Ví dụ mẫu
            </button>
            <label className="text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-0.5 cursor-pointer">
              📁 Từ file…
              <input
                type="file"
                accept=".proto,.txt"
                className="hidden"
                onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }}
              />
            </label>
          </span>
          <span className="flex gap-1.5">
            <input
              id="grpc-proto-url"
              placeholder="https://…/service.proto (cần CORS)"
              spellCheck={false}
              className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono text-xs outline-none focus:border-emerald-600"
              onKeyDown={(e) => {
                if (e.key === 'Enter') importUrl((e.target as HTMLInputElement).value);
              }}
            />
            <button
              onClick={() => importUrl((document.getElementById('grpc-proto-url') as HTMLInputElement)?.value ?? '')}
              className="text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1"
            >
              Tải URL
            </button>
          </span>
          {protoMsg && <span className="text-xs text-sky-300">{protoMsg}</span>}
          <textarea
            rows={14}
            spellCheck={false}
            value={protoText}
            onChange={(e) => saveProto(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded p-2.5 font-mono text-xs outline-none focus:border-emerald-600"
          />
          {parseError
            ? <span className="text-red-400 text-xs font-mono">Parse lỗi: {parseError}</span>
            : <span className="text-emerald-400 text-xs">{parsed?.services.length ?? 0} service(s) OK</span>}
        </label>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Service
              <select
                value={safeSvcIdx}
                onChange={(e) => { setSvcIdx(Number(e.target.value)); setMethodName(''); }}
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5"
              >
                {parsed?.services.map((s, i) => (
                  <option key={s.fullName} value={i}>{s.fullName}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Method
              <select
                value={method?.name ?? ''}
                onChange={(e) => setMethodName(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5"
              >
                {service?.methods.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}{m.clientStreaming || m.serverStreaming ? ' (streaming ✕)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {streaming && (
            <p className="text-xs text-amber-300">Method streaming chưa gọi được ở bản web (cần HTTP/2 trailers).</p>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Base URL proxy gRPC-Web (hỗ trợ {'{{biến}}'})
            <input
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                try { localStorage.setItem(LS_URL, e.target.value); } catch { /* ignore */ }
              }}
              spellCheck={false}
              placeholder="http://localhost:8080"
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-sm"
            />
          </label>
          <p className="text-xs font-mono text-slate-400 break-all">
            → {baseUrl.replace(/\/+$/, '')}/{method?.path ?? '…'}
          </p>
          <div className="text-sm">
            <p className="mb-1 text-slate-400">Metadata (headers gRPC)</p>
            <KeyValueEditor
              items={meta}
              onChange={setMeta}
              keyPlaceholder="authorization"
              valuePlaceholder="Bearer {{token}}"
            />
            <button
              onClick={() => setMeta((prev) => [...prev, { id: uid('kv'), key: '', value: '', enabled: true }])}
              className="mt-1 text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1"
            >
              + Thêm metadata
            </button>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Request body (JSON theo {method?.inputType ?? '…'})
            <textarea
              rows={7}
              spellCheck={false}
              value={bodyJson}
              onChange={(e) => setBodyJson(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded p-2.5 font-mono text-xs outline-none focus:border-emerald-600"
            />
          </label>
          <button
            onClick={send}
            disabled={sending || !method || !!streaming || !!parseError}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded px-4 py-2 font-semibold self-start"
          >
            {sending ? 'Đang gửi…' : 'Gửi gRPC'}
          </button>
          {error && <p className="text-red-400 text-sm font-mono break-all">{error}</p>}
          {result && (
            <div className="bg-slate-950 border border-slate-800 rounded p-3 text-sm">
              <p>
                gRPC status:{' '}
                <b className={result.status === 0 ? 'text-emerald-400' : 'text-red-400'}>{result.status}</b>
                {result.message && <span className="text-slate-400"> ({result.message})</span>}
                <span className="text-slate-500"> • {result.timeMs}ms</span>
              </p>
              <pre className="mt-2 font-mono text-xs whitespace-pre-wrap break-all text-slate-200">
                {result.json !== undefined ? JSON.stringify(result.json, null, 2) : '(không có body)'}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
