import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ExtractRule, Flow, FlowStep } from '../types/api';
import type { FlowImportData } from '../lib/flow';
import type { ScheduleStepSummary } from './schedule';
import { uid } from '../lib/variables';

export interface FlowRunRecord {
  id: string;
  /** 'flow': chạy tay tab Flow | 'collection': chạy tay tab Runner */
  kind: 'flow' | 'collection';
  /** flowId hoặc `${collectionId}:${folderId}` */
  refId: string;
  /** tên flow hoặc `Collection • Phạm vi` */
  refName: string;
  at: number;
  ok: number;
  total: number;
  timeMs: number;
  stopped?: boolean;
  steps: ScheduleStepSummary[];
}

interface FlowState {
  flows: Flow[];
  activeFlowId: string | null;
  addFlow: (name: string) => void;
  renameFlow: (id: string, name: string) => void;
  deleteFlow: (id: string) => void;
  setActiveFlow: (id: string | null) => void;
  addStep: (flowId: string, collectionId: string, requestId: string) => void;
  updateStep: (flowId: string, stepId: string, patch: Partial<Pick<FlowStep, 'collectionId' | 'requestId' | 'disabled'>>) => void;
  removeStep: (flowId: string, stepId: string) => void;
  moveStep: (flowId: string, stepId: string, dir: -1 | 1) => void;
  addRule: (flowId: string, stepId: string, rule: ExtractRule) => void;
  updateRule: (flowId: string, stepId: string, ruleId: string, patch: Partial<ExtractRule>) => void;
  removeRule: (flowId: string, stepId: string, ruleId: string) => void;
  /** Import flow từ JSON (sinh id mới toàn bộ để không đụng). collectionId tra từ requests. */
  importFlow: (data: FlowImportData, collectionOf: (requestId: string) => string | undefined) => void;
  /** Lịch sử chạy tay (giữ 20 lần/flow hoặc collection+phạm vi, body nằm ở IndexedDB) */
  runs: FlowRunRecord[];
  pushRun: (r: Omit<FlowRunRecord, 'id'>) => void;
  clearRuns: (kind: FlowRunRecord['kind'], refId: string) => void;
  /** Tín hiệu "chạy ngay flow này" (Sidebar chuột phải → nhảy sang tab Flow và chạy). Chỉ RAM, không persist. */
  runSignal: { flowId: string; n: number } | null;
  requestFlowRun: (id: string) => void;
  consumeRunSignal: () => void;
}

function patchFlow(flows: Flow[], flowId: string, fn: (f: Flow) => Flow): Flow[] {
  return flows.map((f) => (f.id === flowId ? fn(f) : f));
}

export const useFlowStore = create<FlowState>()(
  persist(
    (set) => ({
      flows: [],
      activeFlowId: null,
      addFlow: (name) =>
        set((s) => {
          const f: Flow = { id: uid('flow'), name: name.trim() || 'Flow mới', steps: [], createdAt: Date.now() };
          return { flows: [...s.flows, f], activeFlowId: f.id };
        }),
      renameFlow: (id, name) =>
        set((s) => ({ flows: patchFlow(s.flows, id, (f) => ({ ...f, name: name.trim() || f.name })) })),
      deleteFlow: (id) =>
        set((s) => ({
          flows: s.flows.filter((f) => f.id !== id),
          activeFlowId: s.activeFlowId === id ? (s.flows.find((f) => f.id !== id)?.id ?? null) : s.activeFlowId,
        })),
      setActiveFlow: (id) => set({ activeFlowId: id }),
      addStep: (flowId, collectionId, requestId) =>
        set((s) => ({
          flows: patchFlow(s.flows, flowId, (f) => ({
            ...f,
            steps: [...f.steps, { id: uid('step'), collectionId, requestId, extract: [] }],
          })),
        })),
      updateStep: (flowId, stepId, patch) =>
        set((s) => ({
          flows: patchFlow(s.flows, flowId, (f) => ({
            ...f,
            steps: f.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)),
          })),
        })),
      removeStep: (flowId, stepId) =>
        set((s) => ({
          flows: patchFlow(s.flows, flowId, (f) => ({ ...f, steps: f.steps.filter((st) => st.id !== stepId) })),
        })),
      moveStep: (flowId, stepId, dir) =>
        set((s) => ({
          flows: patchFlow(s.flows, flowId, (f) => {
            const i = f.steps.findIndex((st) => st.id === stepId);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= f.steps.length) return f;
            const steps = [...f.steps];
            [steps[i], steps[j]] = [steps[j], steps[i]];
            return { ...f, steps };
          }),
        })),
      addRule: (flowId, stepId, rule) =>
        set((s) => ({
          flows: patchFlow(s.flows, flowId, (f) => ({
            ...f,
            steps: f.steps.map((st) => (st.id === stepId ? { ...st, extract: [...st.extract, rule] } : st)),
          })),
        })),
      updateRule: (flowId, stepId, ruleId, patch) =>
        set((s) => ({
          flows: patchFlow(s.flows, flowId, (f) => ({
            ...f,
            steps: f.steps.map((st) =>
              st.id === stepId
                ? { ...st, extract: st.extract.map((r) => (r.id === ruleId ? { ...r, ...patch } : r)) }
                : st,
            ),
          })),
        })),
      removeRule: (flowId, stepId, ruleId) =>
        set((s) => ({
          flows: patchFlow(s.flows, flowId, (f) => ({
            ...f,
            steps: f.steps.map((st) =>
              st.id === stepId ? { ...st, extract: st.extract.filter((r) => r.id !== ruleId) } : st,
            ),
          })),
        })),
      importFlow: (data, collectionOf) =>
        set((s) => {
          const f: Flow = {
            id: uid('flow'),
            name: data.name,
            createdAt: Date.now(),
            steps: data.steps.map((st) => ({
              id: uid('step'),
              collectionId: collectionOf(st.requestId) ?? '',
              requestId: st.requestId,
              disabled: st.disabled ?? false,
              extract: st.extract.map((r) => ({ ...r, id: uid('rule') })),
            })),
          };
          return { flows: [...s.flows, f], activeFlowId: f.id };
        }),
      runs: [],
      pushRun: (r) =>
        set((s) => {
          const all = [{ ...r, id: uid('frun') }, ...s.runs];
          const counts: Record<string, number> = {};
          return {
            runs: all.filter((x) => {
              const k = `${x.kind}:${x.refId}`;
              counts[k] = (counts[k] ?? 0) + 1;
              return counts[k] <= 20;
            }),
          };
        }),
      clearRuns: (kind, refId) =>
        set((s) => ({ runs: s.runs.filter((r) => !(r.kind === kind && r.refId === refId)) })),
      runSignal: null,
      requestFlowRun: (id) => set({ activeFlowId: id, runSignal: { flowId: id, n: Date.now() } }),
      consumeRunSignal: () => set({ runSignal: null }),
    }),
    {
      name: 'postman-clone-flows-v1',
      version: 2,
      // runSignal chỉ dùng trong phiên làm việc, load lại trang thì bỏ
      partialize: (s): Pick<FlowState, 'flows' | 'activeFlowId' | 'runs'> => ({
        flows: s.flows,
        activeFlowId: s.activeFlowId,
        runs: s.runs,
      }),
      // v1: runs dùng flowId/flowName → chuyển sang kind/refId/refName
      migrate: (s) => {
        const raw = s as {
          flows?: Flow[];
          activeFlowId?: string | null;
          runs?: Array<Record<string, unknown>>;
        };
        return {
          flows: raw?.flows ?? [],
          activeFlowId: raw?.activeFlowId ?? null,
          runs: (raw?.runs ?? []).map((r) => ({
            id: String(r.id ?? uid('frun')),
            kind: 'flow' as const,
            refId: String(r.flowId ?? ''),
            refName: String(r.flowName ?? ''),
            at: Number(r.at ?? 0),
            ok: Number(r.ok ?? 0),
            total: Number(r.total ?? 0),
            timeMs: Number(r.timeMs ?? 0),
            stopped: (r.stopped ?? undefined) as boolean | undefined,
            steps: (r.steps ?? []) as ScheduleStepSummary[],
          })),
        };
      },
    },
  ),
);
