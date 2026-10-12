import { useAppStore } from '../stores/app';
import { useScheduleStore, type ScheduleRun, type ScheduleStepSummary } from '../stores/schedule';
import { useFlowStore } from '../stores/flow';
import { collectRequests, runRequestList, type RunItemResult } from './runner';
import { runFlow, type FlowStepResult } from './flow';
import { contentTypeOf } from './response-file';
import { saveBodies, pruneBodies, bodyKey as makeBodyKey, type StoredBody } from './bodyStore';

const TICK_MS = 15_000;
let timer: ReturnType<typeof setInterval> | null = null;
const running = new Set<string>();

function hooks() {
  return {
    getVars: () => {
      const s = useAppStore.getState();
      return {
        envVars: { ...(s.environments.find((e) => e.id === s.activeEnvId)?.variables ?? {}) },
        globals: { ...s.globals },
      };
    },
    setEnv: (k: string, v: string) => {
      const id = useAppStore.getState().activeEnvId;
      if (id) useAppStore.getState().setEnvVar(id, k, v);
    },
    setGlobal: (k: string, v: string) => useAppStore.getState().setGlobal(k, v),
  };
}

/** Chạy 1 lịch ngay (dùng cho tick + nút Chạy ngay). */
export async function runScheduleNow(id: string): Promise<void> {
  if (running.has(id)) return;
  const sch = useScheduleStore.getState().schedules.find((s) => s.id === id);
  if (!sch) return;
  running.add(id);
  try {
    if ((sch.kind ?? 'collection') === 'flow') {
      await runFlowSchedule(id, sch.flowId);
    } else {
      await runCollectionSchedule(id, sch.collectionId, sch.folderId);
    }
  } finally {
    running.delete(id);
  }
}

const shortVal = (v: string) => (v.length > 200 ? `${v.slice(0, 200)}…` : v);

/** Body quá to không lưu IndexedDB (tránh phình quota). */
const MAX_BODY_CHARS = 2_000_000;

export function summarize(
  scheduleId: string,
  at: number,
  results: (RunItemResult | FlowStepResult)[],
): { steps: ScheduleStepSummary[]; bodies: Omit<StoredBody, 'savedAt'>[] } {
  const steps: ScheduleStepSummary[] = [];
  const bodies: Omit<StoredBody, 'savedAt'>[] = [];
  results.forEach((r, i) => {
    const isFlow = 'extracted' in r;
    const body = isFlow ? r.body : r.response?.body;
    const bodyKind = (isFlow ? r.bodyKind : r.response?.bodyKind) ?? 'text';
    const ct = isFlow ? (r.contentType ?? '') : r.response ? contentTypeOf(r.response.headers) : '';
    let bodyKey: string | undefined;
    let bodyOmitted: string | undefined;
    if (body !== undefined) {
      if (body.length > MAX_BODY_CHARS) {
        bodyOmitted = 'too-large';
      } else {
        bodyKey = makeBodyKey(scheduleId, at, i);
        bodies.push({ key: bodyKey, body, bodyKind, contentType: ct });
      }
    }
    steps.push({
      name: r.name,
      ok: r.ok,
      status: r.status,
      timeMs: r.timeMs,
      error: r.error,
      extracted: isFlow && r.extracted.length > 0
        ? r.extracted.map((e) => ({ name: e.name, value: shortVal(e.value) }))
        : undefined,
      contentType: ct || undefined,
      bodyKey,
      bodyOmitted,
    });
  });
  return { steps, bodies };
}

function finish(id: string, intervalMin: number, run: ScheduleRun, notify: boolean, name: string) {
  const st = useScheduleStore.getState();
  st.recordRun(id, run);
  // Dọn body của các lần chạy đã rớt khỏi top-20
  void pruneBodies(id, new Set(
    (useScheduleStore.getState().schedules.find((s) => s.id === id)?.runs ?? []).map((r) => r.at),
  ));
  st.reschedule(id, Date.now() + intervalMin * 60000);
  if (notify && 'Notification' in window && Notification.permission === 'granted') {
    const fail = run.total - run.ok;
    new Notification(fail === 0 ? `✔ ${name}: OK ${run.ok}/${run.total}` : `✕ ${name}: lỗi ${fail}/${run.total}`, {
      body: `Tests ${run.passTests}/${run.totalTests} • ${run.timeMs}ms`,
    });
  }
}

/** Lịch chạy flow: biến trích được dùng nội bộ trong lần chạy, không ghi ra env thật. */
async function runFlowSchedule(id: string, flowId?: string): Promise<void> {
  const sch = useScheduleStore.getState().schedules.find((s) => s.id === id);
  if (!sch) return;
  const flow = useFlowStore.getState().flows.find((f) => f.id === flowId);
  if (!flow) {
    useScheduleStore.getState().recordRun(id, {
      at: Date.now(), ok: 0, total: 0, passTests: 0, totalTests: 0, timeMs: 0,
      error: 'Flow đã bị xóa.',
    });
    return;
  }
  const active = flow.steps.filter((s) => !s.disabled);
  if (active.length === 0) {
    useScheduleStore.getState().recordRun(id, {
      at: Date.now(), ok: 0, total: 0, passTests: 0, totalTests: 0, timeMs: 0,
      error: 'Flow không có step nào đang bật.',
    });
    return;
  }
  const ctrl = new AbortController();
  const t0 = performance.now();
  const { results } = await runFlow(flow, useAppStore.getState().requests, hooks(), {
    timeoutMs: 30_000,
    delayMs: 0,
    stopOnError: false,
    collections: useAppStore.getState().collections,
    signal: ctrl.signal,
  });
  const at = Date.now();
  const { steps, bodies } = summarize(id, at, results);
  await saveBodies(bodies);
  finish(id, sch.intervalMin, {
    at,
    ok: results.filter((r) => r.ok).length,
    total: results.length,
    passTests: results.reduce((a, r) => a + r.testsPassed, 0),
    totalTests: results.reduce((a, r) => a + r.testsTotal, 0),
    timeMs: Math.round(performance.now() - t0),
    steps,
    stopped: results.length < active.length || undefined,
  }, sch.notify, sch.name);
}

async function runCollectionSchedule(id: string, collectionId: string, folderId: string): Promise<void> {
  const sch = useScheduleStore.getState().schedules.find((s) => s.id === id);
  if (!sch) return;
  const col = useAppStore.getState().collections.find((c) => c.id === collectionId);
  if (!col) {
    useScheduleStore.getState().recordRun(id, {
      at: Date.now(), ok: 0, total: 0, passTests: 0, totalTests: 0, timeMs: 0,
      error: 'Collection đã bị xóa.',
    });
    return;
  }
  const list = collectRequests(col, useAppStore.getState().requests, folderId);
  const ctrl = new AbortController();
  const t0 = performance.now();
  const results = await runRequestList(list, hooks(), {
    timeoutMs: 30_000,
    delayMs: 0,
    stopOnError: false,
    collections: useAppStore.getState().collections,
    signal: ctrl.signal,
  });
  const at = Date.now();
  const { steps, bodies } = summarize(id, at, results);
  await saveBodies(bodies);
  finish(id, sch.intervalMin, {
    at,
    ok: results.filter((r) => r.ok).length,
    total: list.length,
    passTests: results.reduce((a, r) => a + r.testsPassed, 0),
    totalTests: results.reduce((a, r) => a + r.testsTotal, 0),
    timeMs: Math.round(performance.now() - t0),
    steps,
    stopped: results.length < list.length || undefined,
  }, sch.notify, sch.name);
}

function tick() {
  const now = Date.now();
  for (const s of useScheduleStore.getState().schedules) {
    if (s.enabled && s.nextRunAt <= now) void runScheduleNow(s.id);
  }
}

/** Khởi động engine (gọi 1 lần khi app mount). Chỉ chạy khi tab mở. */
export function startEngine() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  // Bắt kịp lịch đã tới hạn trong lúc tab đóng
  setTimeout(tick, 1000);
}

export function engineRunning(id: string) {
  return running.has(id);
}
