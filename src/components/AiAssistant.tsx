import { useEffect, useRef, useState } from 'react';
import { useAppStore, type AiChatMsg } from '../stores/app';
import { useFlowStore } from '../stores/flow';
import { useRequestStore } from '../stores/request';
import { generateContent, isQuotaError, sanitizeContents, GEMINI_DEFAULT_MODEL, type GeminiContent, type GeminiFunctionDecl } from '../lib/ai/gemini';
import { AI_PROVIDERS, providerDef, buildBaseURL, orderChain, entryTier, entryRpm, TierBucket, adaptiveInit, adaptOnSuccess, adaptOnRateLimit, type AdaptiveState, type AiChainEntry, type AiRateLimit, type AiUsage } from '../lib/ai/ai-providers';
import { openaiChat, fetchProviderModels } from '../lib/ai/openai-chat';
import { runOneRequest, runRequestList, collectRequests, type RunnerHooks } from '../lib/runner';
import { runFlow } from '../lib/flow';
import { confirmUntrustedScripts } from '../lib/scripts';
import { importAnyJson, summarizeImport } from '../lib/import-any';
import { getBody, saveBodies, pruneBodies } from '../lib/bodyStore';
import { summarize } from '../lib/scheduleEngine';
import { recordManualFlowRun } from '../lib/flow-runs';
import { uid } from '../lib/variables';
import type { ApiRequest, HttpMethod } from '../types/api';

const SYSTEM = `Bạn là trợ lý trong app ReqX (test API kiểu Postman). Trả lời NGẮN GỌN bằng Tiếng Việt.
Bạn có tools để xem và điều khiển app. Quy tắc:
- Khi người dùng nhắc tên (collection/request/flow/env) mà mơ hồ → gọi tool list tương ứng trước, rồi hỏi lại nếu vẫn không khớp.
- Được phép gửi request / chạy flow / đổi biến NGAY, không cần xin phép thêm (app đã hỏi riêng khi gặp script lạ).
- Tóm tắt kết quả gọn: status, thời gian, tests pass/fail, biến trích được. Không dán cả body dài.
- Không bịa tên — chỉ dùng tên/id do tool trả về.
- Muốn nhập collection/flow: nhờ người dùng dán nguyên văn JSON vào chat, rồi gọi import_json (không tự bịa JSON).
- Muốn TẠO flow mới từ request có sẵn: gọi list_requests lấy tên đúng trước, rồi gọi create_flow (extract dạng "tenBien=duongDan"). Xong thì tóm tắt các bước + hỏi có chạy thử không.
- Muốn CHẠY collection: gọi run_collection (kết quả tự lưu lịch sử tab Runner). Tóm tắt gọn từng request, không dán body dài.
- Muốn đọc body response của step: gọi get_step_body (có phân trang offset/limit, đừng đoán nội dung body).`;

const TOOLS: GeminiFunctionDecl[] = [
  { name: 'list_collections', description: 'Liệt kê collections (id, tên, số request).', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'list_requests', description: 'Liệt kê request trong 1 collection.', parameters: { type: 'OBJECT', properties: { collection_ref: { type: 'STRING', description: 'id hoặc tên collection' } }, required: ['collection_ref'] } },
  { name: 'get_request', description: 'Xem chi tiết 1 request (method, url, headers, body rút gọn).', parameters: { type: 'OBJECT', properties: { request_ref: { type: 'STRING', description: 'id hoặc tên request' } }, required: ['request_ref'] } },
  { name: 'open_request', description: 'Mở request lên Builder để người dùng xem/sửa.', parameters: { type: 'OBJECT', properties: { request_ref: { type: 'STRING', description: 'id hoặc tên request' } }, required: ['request_ref'] } },
  { name: 'send_request', description: 'Gửi 1 request (chạy pre-request → gửi → tests) và trả kết quả.', parameters: { type: 'OBJECT', properties: { request_ref: { type: 'STRING', description: 'id hoặc tên request' } }, required: ['request_ref'] } },
  { name: 'list_flows', description: 'Liệt kê flows (id, tên, số step).', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'run_flow', description: 'Chạy 1 flow (nối nhiều request), kết quả tự lưu vào lịch sử chạy của flow. Muốn đọc body response từng step thì gọi tiếp get_step_body.', parameters: { type: 'OBJECT', properties: { flow_ref: { type: 'STRING', description: 'id hoặc tên flow' } }, required: ['flow_ref'] } },
  { name: 'get_step_body', description: 'Đọc response body của 1 step trong lần chạy flow gần nhất (kể cả lần chạy từ tab Flow). Body dài thì đọc từng đoạn bằng offset/limit.', parameters: { type: 'OBJECT', properties: { flow_ref: { type: 'STRING', description: 'id hoặc tên flow' }, step: { type: 'STRING', description: 'số thứ tự step (0, 1, 2...) hoặc tên step' }, offset: { type: 'NUMBER', description: 'vị trí bắt đầu (mặc định 0)' }, limit: { type: 'NUMBER', description: 'số ký tự tối đa (mặc định 4000, tối đa 20000)' } }, required: ['flow_ref', 'step'] } },
  { name: 'list_envs', description: 'Liệt kê environments (id, tên, env nào đang active, biến thường — không lộ secret).', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'set_active_env', description: 'Đổi environment đang dùng.', parameters: { type: 'OBJECT', properties: { env_ref: { type: 'STRING', description: 'id hoặc tên env' } }, required: ['env_ref'] } },
  { name: 'set_variable', description: 'Gán biến (env = env đang active, global = dùng chung).', parameters: { type: 'OBJECT', properties: { scope: { type: 'STRING', enum: ['env', 'global'] }, key: { type: 'STRING' }, value: { type: 'STRING' } }, required: ['scope', 'key', 'value'] } },
  { name: 'create_request', description: 'Tạo request mới trong collection.', parameters: { type: 'OBJECT', properties: { collection_ref: { type: 'STRING', description: 'id/tên collection (trống = đầu tiên)' }, name: { type: 'STRING' }, method: { type: 'STRING', description: 'GET POST PUT PATCH DELETE HEAD OPTIONS' }, url: { type: 'STRING' }, body: { type: 'STRING', description: 'body raw (nếu có)' } }, required: ['name', 'method', 'url'] } },
  { name: 'import_json', description: 'Nhập collection/flow từ JSON do người dùng dán vào chat (Postman v2.1, flow ReqX, file gộp, backup).', parameters: { type: 'OBJECT', properties: { content: { type: 'STRING', description: 'Nguyên văn JSON cần nhập (dưới ~200KB)' } }, required: ['content'] } },
  { name: 'create_flow', description: 'Tạo flow mới từ các request có sẵn (nối nhiều bước, trích biến bước trước cho bước sau). Mỗi step: request_ref (id/tên request) + extract (mảng "tenBien=duongDan", VD "token=access_token"). Luôn gọi list_requests trước để lấy tên request đúng, không bịa request.', parameters: { type: 'OBJECT', properties: { name: { type: 'STRING', description: 'Tên flow' }, steps: { type: 'STRING', description: 'JSON mảng step: [{"request":"tên/id request","extract":["token=access_token"]}]' } }, required: ['name', 'steps'] } },
  { name: 'run_collection', description: 'Chạy Runner cho 1 collection/folder (tuần tự từng request kèm pre-request + tests). Collection dài quá 20 request thì chỉ chạy 20 cái đầu. Kết quả tự lưu vào lịch sử chạy của collection.', parameters: { type: 'OBJECT', properties: { collection_ref: { type: 'STRING', description: 'id hoặc tên collection' }, folder_ref: { type: 'STRING', description: 'id/tên folder, hoặc "root", trống = tất cả' } }, required: ['collection_ref'] } },
];

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function matchByRef<T>(list: T[], ref: string, get: (t: T) => { id: string; name: string }): T | null {
  const t = ref.trim().toLowerCase();
  return list.find((x) => get(x).id === ref) ?? list.find((x) => get(x).name.toLowerCase().includes(t)) ?? null;
}

function aiHooks(): RunnerHooks {
  return {
    getVars: () => {
      const s = useAppStore.getState();
      return {
        envVars: { ...(s.environments.find((e) => e.id === s.activeEnvId)?.variables ?? {}) },
        globals: { ...s.globals },
      };
    },
    setEnv: (k, v) => {
      const s = useAppStore.getState();
      if (s.activeEnvId) s.setEnvVar(s.activeEnvId, k, v);
    },
    setGlobal: (k, v) => useAppStore.getState().setGlobal(k, v),
  };
}

export default function AiAssistant({ onGoBuilder }: { onGoBuilder: () => void }) {
  const { aiChain, setAiChain, bumpAiRr, aiStrategy, setAiStrategy, aiStats, recordAiUsage, clearAiStats, aiChat, pushAiChat, aiContents, setAiContents, clearAiChat } = useAppStore();
  // Khung chain xếp gọn được — có provider dùng được thì mặc định gọn để chat chiếm hết chỗ
  const [showKeys, setShowKeys] = useState(() => orderChain(useAppStore.getState().aiChain, 0, useAppStore.getState().aiStrategy).length === 0);
  // Seed 1 lần từ key Gemini cũ (aiKey/aiKeyBackup) sang chain mới để không mất cấu hình
  useEffect(() => {
    const s = useAppStore.getState();
    if (s.aiChain.length === 0 && (s.aiKey || s.aiKeyBackup)) {
      const mk = (key: string): AiChainEntry | null =>
        key.trim() ? { id: uid('aich'), providerId: 'gemini', model: s.aiModel || GEMINI_DEFAULT_MODEL, key: key.trim(), enabled: true } : null;
      s.setAiChain([mk(s.aiKey), mk(s.aiKeyBackup)].filter((e): e is AiChainEntry => !!e));
    }
  }, []);
  const updEntry = (id: string, patch: Partial<AiChainEntry>) =>
    setAiChain(aiChain.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const moveEntry = (id: string, dir: -1 | 1) => {
    const i = aiChain.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= aiChain.length) return;
    const n = [...aiChain];
    [n[i], n[j]] = [n[j], n[i]];
    setAiChain(n);
  };
  const delEntry = (id: string) => setAiChain(aiChain.filter((e) => e.id !== id));
  const addEntry = () => {
    const d = AI_PROVIDERS[0];
    setAiChain([...aiChain, { id: uid('aich'), providerId: d.id, model: d.defaultModel, key: '', enabled: true }]);
  };
  const enabledList = aiChain.filter((e) => e.enabled);
  /** entryId -> danh sách model lấy từ API của key đó (để chọn trong ô Model) */
  const [fetched, setFetched] = useState<Record<string, string[]>>({});
  const [loadingModels, setLoadingModels] = useState<string | null>(null);
  /** entryId đang ở chế độ tự gõ model (thay vì chọn từ danh sách) */
  const [customModel, setCustomModel] = useState<string | null>(null);
  const loadModels = async (e: AiChainEntry) => {
    const def = providerDef(e.providerId) ?? AI_PROVIDERS[0];
    setLoadingModels(e.id);
    try {
      const list = await fetchProviderModels(def, e.key, e.accountId);
      setFetched((f) => ({ ...f, [e.id]: list }));
      push({ role: 'tool', text: `🔧 ${def.name}: lấy được ${list.length} model — bấm vào ô Model để chọn.` });
    } catch (err) {
      push({ role: 'tool', text: `❌ ${def.name}: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}` });
    } finally {
      setLoadingModels(null);
    }
  };
  // Lịch sử chat nằm ở store (persist) — đổi tab hay tắt app mở lại vẫn còn, chat tiếp được.
  const msgs = aiChat;
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const contentsRef = useRef<GeminiContent[]>(sanitizeContents(aiContents));
  /** Bucket đếm RPM + trạng thái học trần (AIMD) + breaker khóa tạm — giữ suốt session */
  const bucketsRef = useRef<Record<string, { b: TierBucket; rpm: number }>>({});
  const breakersRef = useRef<Record<string, number>>({});
  const adaptiveRef = useRef<Record<string, AdaptiveState>>({});
  const boxRef = useRef<HTMLDivElement | null>(null);

  const scrollDown = () => requestAnimationFrame(() => boxRef.current?.scrollTo({ top: 1e9 }));
  const push = (m: AiChatMsg) => {
    pushAiChat(m);
    scrollDown();
  };
  // Mở tab là nhảy xuống tin mới nhất (đọc tiếp mạch cũ)
  useEffect(() => { scrollDown(); }, []);

  const str = (v: unknown, fb = '') => (typeof v === 'string' && v ? v : fb);

  /** Thực thi tool do Gemini gọi. Luôn trả object (ok + dữ liệu hoặc error). */
  const execTool = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const app = useAppStore.getState();
    switch (name) {
      case 'list_collections':
        return {
          ok: true,
          collections: app.collections.map((c) => ({
            id: c.id,
            name: c.name,
            requests: c.rootRequestIds.length + c.folders.reduce((a, f) => a + f.requestIds.length, 0),
          })),
        };
      case 'list_requests': {
        const col = matchByRef(app.collections, str(args.collection_ref), (c) => c);
        if (!col) return { ok: false, error: 'Không tìm thấy collection.' };
        const ids = [...col.rootRequestIds, ...col.folders.flatMap((f) => f.requestIds)];
        return {
          ok: true,
          collection: col.name,
          requests: ids.map((id) => app.requests[id]).filter(Boolean).map((r) => ({ id: r.id, name: r.name, method: r.method, url: r.url })),
        };
      }
      case 'get_request': {
        const req = matchByRef(Object.values(app.requests), str(args.request_ref), (r) => r);
        if (!req) return { ok: false, error: 'Không tìm thấy request.' };
        return {
          ok: true,
          request: {
            id: req.id, name: req.name, method: req.method, url: req.url,
            headers: req.headers.filter((h) => h.enabled).map((h) => `${h.key}: ${h.value}`),
            bodyType: req.bodyType, bodyPreview: (req.body ?? '').slice(0, 1500),
            hasPreRequest: !!(req.preRequest ?? '').trim(), hasTests: !!(req.tests ?? '').trim(),
          },
        };
      }
      case 'open_request': {
        const req = matchByRef(Object.values(app.requests), str(args.request_ref), (r) => r);
        if (!req) return { ok: false, error: 'Không tìm thấy request.' };
        useRequestStore.getState().load(req);
        onGoBuilder();
        return { ok: true, opened: req.name };
      }
      case 'send_request': {
        const req = matchByRef(Object.values(app.requests), str(args.request_ref), (r) => r);
        if (!req) return { ok: false, error: 'Không tìm thấy request.' };
        if (!confirmUntrustedScripts([req], `AI gửi “${req.name}”`)) {
          return { ok: false, error: 'Người dùng từ chối chạy script chưa rõ nguồn gốc.' };
        }
        const r = await runOneRequest(req, aiHooks(), 30000);
        return {
          ok: r.ok, status: r.status, timeMs: r.timeMs,
          tests: `${r.testsPassed}/${r.testsTotal}`, error: r.error,
          bodyPreview: (r.response?.body ?? '').slice(0, 2000),
        };
      }
      case 'list_flows': {
        const { flows } = useFlowStore.getState();
        return { ok: true, flows: flows.map((f) => ({ id: f.id, name: f.name, steps: f.steps.length })) };
      }
      case 'run_flow': {
        const { flows } = useFlowStore.getState();
        const flow = matchByRef(flows, str(args.flow_ref), (f) => f);
        if (!flow) return { ok: false, error: 'Không tìm thấy flow.' };
        const stepReqs = flow.steps.flatMap((s) => {
          const r = app.requests[s.requestId];
          return r ? [r] : [];
        });
        if (!confirmUntrustedScripts(stepReqs, `AI chạy Flow “${flow.name}”`)) {
          return { ok: false, error: 'Người dùng từ chối chạy script chưa rõ nguồn gốc.' };
        }
        const hooks = aiHooks();
        const t0 = performance.now();
        const { results, flowVars } = await runFlow(flow, app.requests, { getVars: hooks.getVars, setGlobal: hooks.setGlobal }, {
          timeoutMs: 30000, delayMs: 0, stopOnError: false,
        });
        // Lưu lại như bấm chạy ở tab Flow (xem lại ở tab Flow → lịch sử chạy)
        await recordManualFlowRun(flow.id, flow.name, Date.now(), results, performance.now() - t0);
        return {
          ok: results.every((r) => r.ok),
          steps: results.map((r, i) => ({ i, name: r.name, ok: r.ok, status: r.status, timeMs: r.timeMs, error: r.error, extracted: r.extracted, bodyChars: r.body?.length ?? 0 })),
          flowVars,
          saved: 'Đã lưu vào lịch sử chạy của flow (tab Flow). Muốn đọc body step nào thì gọi get_step_body.',
        };
      }
      case 'get_step_body': {
        const { flows, runs } = useFlowStore.getState();
        const flow = matchByRef(flows, str(args.flow_ref), (f) => f);
        if (!flow) return { ok: false, error: 'Không tìm thấy flow.' };
        const run = runs.find((r) => r.kind === 'flow' && r.refId === flow.id);
        if (!run) return { ok: false, error: `Flow “${flow.name}” chưa có lần chạy nào được lưu.` };
        const stepRef = String(args.step ?? '').trim();
        let idx = /^\d+$/.test(stepRef) ? parseInt(stepRef, 10) : -1;
        if (idx < 0) {
          const t = stepRef.toLowerCase();
          idx = run.steps.findIndex((s) => s.name.toLowerCase().includes(t));
        }
        if (idx < 0 || idx >= run.steps.length) return { ok: false, error: `Không tìm thấy step “${stepRef}” (flow có ${run.steps.length} step: ${run.steps.map((s, i) => `${i}:${s.name}`).join(', ')}).` };
        const st = run.steps[idx];
        if (!st.bodyKey) return { ok: false, error: st.bodyOmitted === 'too-large' ? 'Body quá to (>2MB) nên không lưu — mở tab Flow xem trực tiếp.' : 'Step này không có body.' };
        const stored = await getBody(st.bodyKey);
        if (!stored) return { ok: false, error: 'Body đã bị dọn (chỉ giữ 20 lần chạy gần nhất) — chạy lại flow.' };
        if (stored.bodyKind === 'binary') return { ok: true, step: st.name, binary: true, contentType: stored.contentType, note: 'Body nhị phân (ảnh/file) — mở tab Flow để xem/tải.' };
        const total = stored.body.length;
        const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
        const limit = Math.min(20000, Math.max(1, Math.floor(Number(args.limit) || 4000)));
        const text = stored.body.slice(offset, offset + limit);
        return { ok: true, step: st.name, status: st.status, contentType: stored.contentType, totalChars: total, offset, text, truncated: offset + limit < total };
      }
      case 'list_envs': {
        const secrets = new Set(app.envSecrets[app.activeEnvId ?? ''] ?? []);
        const active = app.environments.find((e) => e.id === app.activeEnvId);
        return {
          ok: true,
          active: active?.name ?? null,
          envs: app.environments.map((e) => ({
            id: e.id, name: e.name,
            vars: Object.keys(e.variables).filter((k) => !(app.envSecrets[e.id] ?? []).includes(k)),
          })),
          globals: Object.keys(app.globals).filter((k) => !app.globalSecrets.includes(k)),
          note: `Biến secret của env active (${[...secrets].join(', ') || 'không có'}) bị ẩn.`,
        };
      }
      case 'set_active_env': {
        const env = matchByRef(app.environments, str(args.env_ref), (e) => e);
        if (!env) return { ok: false, error: 'Không tìm thấy env.' };
        app.setActiveEnv(env.id);
        return { ok: true, active: env.name };
      }
      case 'set_variable': {
        const key = str(args.key);
        const value = str(args.value);
        if (!key) return { ok: false, error: 'Thiếu key.' };
        if (args.scope === 'global') app.setGlobal(key, value);
        else {
          if (!app.activeEnvId) return { ok: false, error: 'Chưa có env active.' };
          app.setEnvVar(app.activeEnvId, key, value);
        }
        return { ok: true, scope: args.scope, key };
      }
      case 'create_request': {
        const m = str(args.method, 'GET').toUpperCase();
        const method: HttpMethod = (METHODS as string[]).includes(m) ? (m as HttpMethod) : 'GET';
        const cols = app.collections;
        const col = str(args.collection_ref) ? matchByRef(cols, str(args.collection_ref), (c) => c) : (cols[0] ?? null);
        if (!col) return { ok: false, error: 'Chưa có collection nào — tạo collection trước.' };
        const req: ApiRequest = {
          id: uid('req'), name: str(args.name, 'Request mới'), method,
          url: str(args.url), params: [], headers: [],
          bodyType: str(args.body) ? 'json' : 'none', body: str(args.body),
          auth: { type: 'none' }, preRequest: '', tests: '',
          collectionId: col.id, updatedAt: Date.now(),
        };
        const saved = app.saveRequest(req, col.id);
        if (!saved) return { ok: false, error: 'Không lưu được request.' };
        return { ok: true, id: saved.id, name: saved.name, collection: col.name };
      }
      case 'import_json': {
        const content = str(args.content);
        if (!content) return { ok: false, error: 'Thiếu JSON — nhờ người dùng dán JSON vào chat.' };
        if (content.length > 200000) return { ok: false, error: 'JSON quá lớn (>200KB) — nhờ người dùng nhập bằng nút Import file ở sidebar.' };
        let json: unknown;
        try {
          json = JSON.parse(content);
        } catch {
          return { ok: false, error: 'JSON sai cú pháp — nhờ người dùng kiểm tra lại.' };
        }
        const r = importAnyJson(json, 'chat');
        return { ok: r.errors.length === 0, summary: summarizeImport(r) };
      }
      case 'create_flow': {
        const name = str(args.name, 'Flow mới');
        let rawSteps: unknown;
        try {
          rawSteps = JSON.parse(str(args.steps, '[]'));
        } catch {
          return { ok: false, error: 'steps không phải JSON hợp lệ — phải là mảng [{"request":"tên/id","extract":["bien=duongDan"]}]' };
        }
        if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
          return { ok: false, error: 'steps trống — cần ít nhất 1 step. Gọi list_requests trước để lấy tên request đúng.' };
        }
        const allReqs = Object.values(app.requests);
        const steps: { requestId: string; extract: { name: string; from: 'body-json'; path: string }[] }[] = [];
        const missing: string[] = [];
        rawSteps.slice(0, 20).forEach((s: unknown) => {
          const o = (s ?? {}) as Record<string, unknown>;
          const req = matchByRef(allReqs, typeof o.request === 'string' ? o.request : '', (r) => r);
          if (!req) { missing.push(String(o.request ?? '?')); return; }
          const extract = Array.isArray(o.extract) ? o.extract : [];
          steps.push({
            requestId: req.id,
            extract: extract
              .map((e) => String(e ?? ''))
              .map((e) => {
                const i = e.indexOf('=');
                return i > 0
                  ? { name: e.slice(0, i).trim(), from: 'body-json' as const, path: e.slice(i + 1).trim() }
                  : { name: e.trim(), from: 'body-json' as const, path: e.trim() };
              })
              .filter((e) => e.name && e.path),
          });
        });
        if (steps.length === 0) return { ok: false, error: `Không khớp request nào (${missing.join(', ')}) — gọi list_requests để lấy tên đúng.` };
        useFlowStore.getState().importFlow(
          { name, steps },
          (rid) => app.requests[rid]?.collectionId,
        );
        const created = useFlowStore.getState().flows[useFlowStore.getState().flows.length - 1];
        return {
          ok: true, id: created.id, name: created.name,
          steps: steps.map((s) => ({
            request: app.requests[s.requestId]?.name ?? s.requestId,
            extract: s.extract.map((e) => `${e.name}=${e.path}`),
          })),
          skipped: missing,
          note: 'Đã tạo flow (mở tab Flow để xem). Muốn chạy thử thì gọi run_flow.',
        };
      }
      case 'run_collection': {
        const col = matchByRef(app.collections, str(args.collection_ref), (c) => c);
        if (!col) return { ok: false, error: 'Không tìm thấy collection.' };
        const fref = str(args.folder_ref).trim().toLowerCase();
        let folderId = 'all';
        if (fref === 'root') folderId = 'root';
        else if (fref) {
          const f = col.folders.find((x) => x.id === args.folder_ref || x.name.toLowerCase().includes(fref));
          if (!f) return { ok: false, error: `Không thấy folder “${args.folder_ref}” (có: ${col.folders.map((x) => x.name).join(', ') || 'không có folder'}).` };
          folderId = f.id;
        }
        const full = collectRequests(col, app.requests, folderId);
        if (full.length === 0) return { ok: false, error: 'Phạm vi này không có request nào.' };
        const capped = full.length > 20;
        const runList = full.slice(0, 20);
        if (!confirmUntrustedScripts(runList, `AI chạy Collection “${col.name}”`)) {
          return { ok: false, error: 'Người dùng từ chối chạy script chưa rõ nguồn gốc.' };
        }
        const hooks = aiHooks();
        const t0 = performance.now();
        const at = Date.now();
        const collected = await runRequestList(runList, hooks, {
          timeoutMs: 30000, delayMs: 0, stopOnError: false,
        });
        // Lưu lịch sử như bấm chạy ở tab Runner
        const refId = `${col.id}:${folderId}`;
        const { steps, bodies } = summarize(`manual-col:${refId}`, at, collected);
        await saveBodies(bodies);
        useFlowStore.getState().pushRun({
          kind: 'collection', refId,
          refName: `${col.name} • AI chạy`,
          at,
          ok: collected.filter((r) => r.ok).length,
          total: collected.length,
          timeMs: Math.round(performance.now() - t0),
          steps,
        });
        void pruneBodies(
          `manual-col:${refId}`,
          new Set(useFlowStore.getState().runs.filter((r) => r.kind === 'collection' && r.refId === refId).map((r) => r.at)),
        );
        return {
          ok: collected.every((r) => r.ok),
          ran: `${collected.length}/${full.length}${capped ? ' (collection dài, chỉ chạy 20 cái đầu)' : ''}`,
          items: collected.map((r) => ({ name: r.name, ok: r.ok, status: r.status, timeMs: r.timeMs, tests: `${r.testsPassed}/${r.testsTotal}`, error: r.error?.slice(0, 300) })),
          saved: 'Đã lưu vào lịch sử chạy của collection (tab Runner).',
        };
      }
      default:
        return { ok: false, error: `Không có tool ${name}.` };
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const live = useAppStore.getState();
    if (orderChain(live.aiChain, live.aiRrIndex, live.aiStrategy).length === 0) {
      setShowKeys(true);
      push({ role: 'model', text: '⚠ Chưa có provider nào dùng được — thêm key ở khung 🔑 (Gemini / Groq / Mistral / OpenRouter / Cloudflare) rồi chat.' });
      return;
    }
    setInput('');
    push({ role: 'user', text });
    contentsRef.current.push({ role: 'user', parts: [{ text }] });
    // Dọn history trước mỗi lượt gửi: vết cắt cap-30 có thể để lại cặp call/response gãy.
    contentsRef.current = sanitizeContents(contentsRef.current);
    setBusy(true);
    // Chain: xoay vòng + strategy + admission từng nấc + breaker từng nấc + failover
    const complained = new Set<string>();
    let waitedThisTurn = false; // chỉ đợi lùi 1 lần/lượt, và chỉ cho nấc paid
    /** Số lượt chừa lại khi gần chạm trần (khóa tạm trước khi dính 429 thật) */
    const HEADROOM = 2;
    const bucketFor = (entry: AiChainEntry, rpm: number) => {
      const b = bucketsRef.current[entry.id];
      if (!b || b.rpm !== rpm) bucketsRef.current[entry.id] = { b: new TierBucket(rpm), rpm };
      return bucketsRef.current[entry.id].b;
    };
    const callEntry = async (entry: AiChainEntry) => {
      const def = providerDef(entry.providerId);
      if (!def) throw new Error(`Provider lạ: ${entry.providerId}`);
      const model = entry.model.trim() || def.defaultModel;
      if (def.style === 'gemini') {
        const r = await generateContent(entry.key, model, SYSTEM, contentsRef.current, TOOLS);
        return { parts: r.parts, usage: r.usage, rateLimit: undefined as AiRateLimit | undefined, entry };
      }
      const base = buildBaseURL(def, entry.accountId);
      if (!base) throw new Error(`${def.name}: thiếu Account ID.`);
      const r = await openaiChat({
        baseURL: base, key: entry.key, model,
        system: SYSTEM, contents: contentsRef.current, tools: TOOLS,
        maxTokens: Math.min(4096, def.maxTokensCap ?? 4096),
        extraHeaders: def.id === 'openrouter' ? { 'HTTP-Referer': 'https://reqx.app', 'X-Title': 'ReqX' } : undefined,
      });
      return { parts: r.parts, usage: r.usage, rateLimit: r.rateLimit, entry };
    };
    const gen = async () => {
      const st = useAppStore.getState();
      const order = orderChain(st.aiChain, st.aiRrIndex, st.aiStrategy);
      let lastErr: unknown = new Error('Chain trống.');
      for (const entry of order) {
        const def = providerDef(entry.providerId);
        const tier = entryTier(entry, def);
        const badge = tier === 'paid' ? '💰' : '🆓';
        const label = `${badge} ${def?.name ?? entry.providerId} (${entry.model.trim() || (def?.defaultModel ?? '?')})`;
        // Breaker: nấc đang khóa tạm (vừa sập) thì bỏ qua hẳn
        const now = Date.now();
        const lockedUntil = breakersRef.current[entry.id] ?? 0;
        if (lockedUntil > now) {
          if (!complained.has(`lock:${entry.id}`)) {
            complained.add(`lock:${entry.id}`);
            push({ role: 'tool', text: `🔒 ${label} đang khóa tạm (~${Math.ceil((lockedUntil - now) / 1000)}s nữa) — nhảy xuống nấc tiếp.` });
          }
          continue;
        }
        // Admission từng nấc: trần = số đã học (AIMD), khởi đầu = trần cấu hình.
        // Gần chạm trần thì khóa tạm để lượt sau nhảy xuống nấc kế (né 429 trước khi dính).
        const configured = entryRpm(entry, def);
        const ad = adaptiveRef.current[entry.id] ?? (adaptiveRef.current[entry.id] = adaptiveInit(configured));
        const effectiveRpm = Math.min(ad.learned, configured);
        const bucket = bucketFor(entry, effectiveRpm);
        if (bucket.left(now) < Math.min(HEADROOM, effectiveRpm)) {
          if (!complained.has(`near:${entry.id}`)) {
            complained.add(`near:${entry.id}`);
            push({ role: 'tool', text: `🔒 ${label} gần chạm trần (~${effectiveRpm}/phút, đang tự học) — khóa tạm, nhảy xuống nấc tiếp.` });
          }
          continue;
        }
        bucket.take(now);
        try {
          const r = await callEntry(entry);
          delete breakersRef.current[entry.id]; // thành công → mở lại breaker
          // Học trần: header hãng cho số thật thì theo, không thì AIMD tăng dần
          const hl = r.rateLimit?.limit;
          adaptiveRef.current[entry.id] = hl && hl > 0 && hl <= configured
            ? { learned: hl }
            : adaptOnSuccess(ad, configured);
          if (r.rateLimit?.resetMs && r.rateLimit.resetMs > Date.now())
            breakersRef.current[entry.id] = r.rateLimit.resetMs; // hãng báo hết lượt tới giờ X
          st.recordAiUsage(entry.id, r.usage, true);
          return r.parts;
        } catch (e) {
          lastErr = e;
          st.recordAiUsage(entry.id, { prompt: 0, completion: 0 } as AiUsage, false);
          const msg = (e instanceof Error ? e.message : String(e)).slice(0, 160);
          // Sập quota/rate limit → AIMD giảm trần + khóa nấc này để các lượt sau khỏi nện vào
          if (isQuotaError(e)) {
            adaptiveRef.current[entry.id] = adaptOnRateLimit(ad, undefined);
            const m = msg.match(/retry[ -]?after[: ]?(\d+)/i)?.[1];
            const lockSec = Math.min(300, Math.max(60, parseInt(m ?? '60', 10) || 60));
            breakersRef.current[entry.id] = Date.now() + lockSec * 1000;
          }
          // Nấc paid 429 vì gọi dồn → đợi lùi rồi thử lại đúng nấc đó 1 lần; nấc free thì bỏ qua nhanh
          if (tier === 'paid' && !waitedThisTurn && /429|rate.?limit|too many requests/i.test(msg)) {
            waitedThisTurn = true;
            const sec = Math.min(30, Math.max(5, parseInt(msg.match(/retry[ -]?after[: ]?(\d+)/i)?.[1] ?? '10', 10) || 10));
            push({ role: 'tool', text: `⏳ ${label} giới hạn tốc độ — đợi ${sec}s thử lại 1 lần…` });
            await new Promise((r) => setTimeout(r, sec));
            try {
              const r2 = await callEntry(entry);
              st.recordAiUsage(entry.id, r2.usage, true);
              return r2.parts;
            } catch (e2) {
              lastErr = e2;
              st.recordAiUsage(entry.id, { prompt: 0, completion: 0 } as AiUsage, false);
            }
          }
          // Báo 1 lần/entry/lượt để vòng tool-loop (tối đa 6 vòng) không spam
          if (!complained.has(entry.id)) {
            complained.add(entry.id);
            const locked = isQuotaError(lastErr) ? ' (đã khóa tạm nấc này)' : '';
            push({ role: 'tool', text: `⚠ ${label} lỗi → thử tiếp${locked}: ${(lastErr instanceof Error ? lastErr.message : String(lastErr)).slice(0, 160)}` });
          }
        }
      }
      throw lastErr;
    };
    try {
      let reply = '';
      for (let i = 0; i < 6; i++) {
        const parts = await gen();
        const calls = parts.filter((p) => p.functionCall);
        reply += parts.map((p) => p.text ?? '').join('');
        if (calls.length === 0) {
          contentsRef.current.push({ role: 'model', parts });
          break;
        }
        contentsRef.current.push({ role: 'model', parts });
        const respParts = [];
        for (const c of calls) {
          const fn = c.functionCall!;
          let out: Record<string, unknown>;
          try {
            out = await execTool(fn.name, fn.args ?? {});
          } catch (e) {
            out = { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
          const brief = out.ok === false ? `❌ ${String(out.error ?? 'lỗi')}` : '✓ xong';
          push({ role: 'tool', text: `🔧 ${fn.name} → ${brief}` });
          respParts.push({ functionResponse: { name: fn.name, response: out } });
        }
        contentsRef.current.push({ role: 'user', parts: respParts });
      }
      push({ role: 'model', text: reply.trim() || '(AI chỉ gọi tool, không nhắn gì thêm.)' });
    } catch (e) {
      push({ role: 'model', text: `❌ ${e instanceof Error ? e.message : String(e)}` });
      // Mọi nấc trong chain đều đã thử và lỗi
      if (isQuotaError(e))
        push({ role: 'model', text: 'Mọi nấc trong chain đều lỗi quota/rate limit — chờ reset, thêm key/provider khác, hoặc bấm 🗑 Xóa chat thử lại.' });
    } finally {
      setBusy(false);
      bumpAiRr(); // xoay lượt tiếp theo sang nấc khác (chia tải đều)
      setAiContents(contentsRef.current);
      scrollDown();
    }
  };

  const suggestions = ['Có những collection nào?', 'Env đang dùng là gì?', 'Liệt kê flows'];

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      <div className="border border-slate-700 rounded">
        <button
          onClick={() => setShowKeys((v) => !v)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800/60 rounded"
        >
          <span>{showKeys ? '▾' : '▸'}</span>
          <span>🔑 AI chain ({enabledList.length} bật: {enabledList.filter((e) => entryTier(e, providerDef(e.providerId)) === 'paid').length}💰 + {enabledList.filter((e) => entryTier(e, providerDef(e.providerId)) !== 'paid').length}🆓)</span>
          {enabledList[0] && (
            <span className="text-xs text-slate-500 font-mono">
              {aiStrategy === 'stable' ? 'paid trước' : 'free trước'} · {providerDef(enabledList[0].providerId)?.name ?? ''} · {enabledList[0].model || '…'}
            </span>
          )}
        </button>
        {showKeys && (
          <div className="p-3 pt-1 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>Chiến lược:</span>
              <label className="flex items-center gap-1 cursor-pointer" title="Gọi free trước, tràn mới sang paid — rẻ nhất">
                <input type="radio" checked={aiStrategy === 'save-cost'} onChange={() => setAiStrategy('save-cost')} />
                Tiết kiệm (free → paid)
              </label>
              <label className="flex items-center gap-1 cursor-pointer" title="Gọi paid trước, free chỉ dự phòng — ổn định nhất">
                <input type="radio" checked={aiStrategy === 'stable'} onChange={() => setAiStrategy('stable')} />
                Ổn định (paid → free)
              </label>
            </div>
            {aiChain.map((e, i) => {
              const def = providerDef(e.providerId) ?? AI_PROVIDERS[0];
              const suggestions = [...new Set([...def.models, ...(fetched[e.id] ?? [])])];
              const tier = entryTier(e, def);
              const st = aiStats[e.id];
              const statTip = st ? `gọi ${st.calls} • lỗi ${st.fails} • tokens ${st.prompt + st.completion} (vào ${st.prompt}/ra ${st.completion})` : 'chưa gọi lần nào';
              return (
                <div key={e.id} className="flex flex-wrap items-end gap-2 border border-slate-800 rounded p-2" title={statTip}>
                  <label className="flex items-center gap-1 text-xs text-slate-400" title="Bật/tắt nấc này (tắt = bỏ qua khi xoay vòng)">
                    <input type="checkbox" checked={e.enabled} onChange={(ev) => updEntry(e.id, { enabled: ev.target.checked })} />
                    #{i + 1}
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400" title="Bậc dùng: free (trần thấp) hay paid (trần cao, tốn tiền)">
                    Bậc
                    <select
                      value={e.tier ?? ''}
                      onChange={(ev) => updEntry(e.id, { tier: (ev.target.value || undefined) as AiChainEntry['tier'] })}
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
                    >
                      <option value="">Theo hãng ({def.tier === 'paid' ? '💰' : '🆓'})</option>
                      <option value="free">🆓 Free</option>
                      <option value="paid">💰 Paid</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    Provider
                    <select
                      value={e.providerId}
                      onChange={(ev) => {
                        const nd = providerDef(ev.target.value) ?? AI_PROVIDERS[0];
                        updEntry(e.id, { providerId: nd.id, model: nd.defaultModel });
                      }}
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
                    >
                      {AI_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    Model{fetched[e.id] ? ` (${fetched[e.id].length})` : ''}
                    {customModel === e.id || (e.model.trim() !== '' && !suggestions.includes(e.model)) ? (
                      <span className="flex gap-1">
                        <input
                          value={e.model}
                          onChange={(ev) => updEntry(e.id, { model: ev.target.value })}
                          placeholder={def.defaultModel}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono w-44"
                        />
                        <button
                          onClick={() => { setCustomModel(null); if (!suggestions.includes(e.model)) updEntry(e.id, { model: def.defaultModel }); }}
                          title="Chọn từ danh sách"
                          className="bg-slate-800 hover:bg-slate-700 rounded px-2 py-1.5 text-sm"
                        >
                          ▼
                        </button>
                      </span>
                    ) : (
                      <select
                        value={e.model}
                        onChange={(ev) => {
                          if (ev.target.value === '__custom') setCustomModel(e.id);
                          else updEntry(e.id, { model: ev.target.value });
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono max-w-60"
                      >
                        {e.model === '' && <option value="">— chọn model —</option>}
                        {suggestions.map((m) => <option key={m} value={m}>{m}</option>)}
                        <option value="__custom">✎ Tự gõ model khác…</option>
                      </select>
                    )}
                  </label>
                  <button
                    onClick={() => void loadModels(e)}
                    disabled={loadingModels === e.id || !e.key.trim()}
                    title={e.key.trim() ? 'Lấy danh sách model của key này' : 'Dán key trước rồi mới lấy được danh sách'}
                    className="bg-slate-800 hover:bg-slate-700 rounded px-2 py-1.5 text-sm disabled:opacity-40"
                  >
                    {loadingModels === e.id ? '…' : '↻'}
                  </button>
                  <label className="flex flex-col gap-1 text-xs text-slate-400 flex-1 min-w-40">
                    {def.keyLabel}
                    <input
                      type="password"
                      value={e.key}
                      onChange={(ev) => updEntry(e.id, { key: ev.target.value })}
                      placeholder={def.keyPlaceholder}
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono"
                    />
                  </label>
                  {def.needsAccountId && (
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      {def.accountLabel ?? 'Account ID'}
                      <input
                        value={e.accountId ?? ''}
                        onChange={(ev) => updEntry(e.id, { accountId: ev.target.value })}
                        placeholder="Cloudflare Account ID"
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono w-44"
                      />
                    </label>
                  )}
                  <label className="flex flex-col gap-1 text-xs text-slate-400" title="Trần gọi/phút của nấc này. Để trống = tự học + mặc định bậc. Biết số trong console hãng thì nhập vào.">
                    RPM
                    <input
                      value={e.rpm ?? ''}
                      onChange={(ev) => {
                        const n = parseInt(ev.target.value, 10);
                        updEntry(e.id, { rpm: Number.isFinite(n) && n > 0 ? n : undefined });
                      }}
                      placeholder={String(entryRpm({ ...e, rpm: undefined }, def))}
                      inputMode="numeric"
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono w-20"
                    />
                  </label>
                  <div className="flex gap-1">
                    <button onClick={() => moveEntry(e.id, -1)} title="Lên trên" className="bg-slate-800 hover:bg-slate-700 rounded px-2 py-1.5 text-sm">↑</button>
                    <button onClick={() => moveEntry(e.id, 1)} title="Xuống dưới" className="bg-slate-800 hover:bg-slate-700 rounded px-2 py-1.5 text-sm">↓</button>
                    <button onClick={() => delEntry(e.id)} title="Xóa nấc này" className="bg-slate-800 hover:bg-red-800 rounded px-2 py-1.5 text-sm">✕</button>
                  </div>
                </div>
              );
            })}
            <div>
              <button onClick={addEntry} className="bg-slate-800 hover:bg-slate-700 rounded px-3 py-1.5 text-sm">
                + Thêm provider
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Mỗi nấc đếm RPM riêng và tự học trần thật (gọi OK tăng dần, 429 giảm nửa; hãng nào trả header
              rate-limit thì theo số thật). Gần chạm trần thì khóa tạm để lượt sau nhảy xuống nấc kế (báo 🔒).
              Ô RPM để trống = tự học; biết số trong console hãng thì nhập vào. Nấc nào sập quota thì khóa 60s.
              Nấc free lỗi bỏ qua nhanh, chỉ nấc paid 429 mới đợi lùi thử lại 1 lần.
              Chỉ nấc nào bật + có key + model mới được dùng. Key lưu trong máy này.
              AI được gửi/ chạy flow / đổi biến trong app — gặp script từ file import vẫn hỏi xác nhận như thường.
            </p>
            {Object.keys(aiStats).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span>
                  Đã dùng: {Object.values(aiStats).reduce((a, s) => a + s.prompt + s.completion, 0).toLocaleString('vi-VN')} tokens
                  (vào {Object.values(aiStats).reduce((a, s) => a + s.prompt, 0).toLocaleString('vi-VN')} / ra {Object.values(aiStats).reduce((a, s) => a + s.completion, 0).toLocaleString('vi-VN')},
                  lỗi {Object.values(aiStats).reduce((a, s) => a + s.fails, 0)})
                </span>
                <button onClick={clearAiStats} title="Xóa thống kê tokens" className="text-slate-500 hover:text-slate-300 underline">
                  reset
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div ref={boxRef} className="flex-1 min-h-0 overflow-auto border border-slate-800 rounded p-3 flex flex-col gap-2 bg-slate-950/50">
        {msgs.length === 0 && (
          <p className="text-slate-500 text-sm">
            Ra lệnh tiếng Việt, vd: “chạy flow SSO”, “gửi request lấy user rồi cho biết total”,
            “đổi sang env Staging”, “tạo request GET đơn hàng mới”.
          </p>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={`text-sm rounded px-2.5 py-1.5 whitespace-pre-wrap ${
              m.role === 'user' ? 'bg-slate-800 self-end max-w-[90%]'
              : m.role === 'tool' ? 'text-slate-400 text-xs font-mono'
              : 'bg-emerald-950/60 self-start max-w-[95%]'
            }`}
          >
            {m.text}
          </div>
        ))}
        {busy && <div className="text-xs text-slate-500">AI đang nghĩ…</div>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => setInput(s)}
            className="text-xs bg-slate-800 hover:bg-slate-700 rounded-full px-2.5 py-1 text-slate-300"
          >
            {s}
          </button>
        ))}
        <button onClick={() => { contentsRef.current = []; clearAiChat(); }} className="text-xs rounded-full px-2.5 py-1 text-slate-500 hover:text-slate-300">
          🗑 Xóa chat
        </button>
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Ra lệnh cho AI… (Enter để gửi)"
          className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:border-emerald-600"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          className="bg-emerald-700 hover:bg-emerald-600 rounded px-4 py-2 text-sm disabled:opacity-40"
        >
          Gửi
        </button>
      </div>
    </div>
  );
}
