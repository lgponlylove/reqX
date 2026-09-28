import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { uid } from '../lib/variables';

export interface ScheduleStepSummary {
  name: string;
  ok: boolean;
  status?: number;
  timeMs?: number;
  error?: string;
  /** Biến đã trích ở step này (giá trị cắt ngắn để khỏi phình localStorage) */
  extracted?: { name: string; value: string }[];
  contentType?: string;
  /** Key body trong IndexedDB (xem lại) — chỉ có khi body ≤ ~2MB */
  bodyKey?: string;
  /** 'too-large': body quá to nên không lưu */
  bodyOmitted?: string;
}

export interface ScheduleRun {
  at: number;
  ok: number;
  total: number;
  passTests: number;
  totalTests: number;
  timeMs: number;
  /** Chi tiết từng step/request (mới) */
  steps?: ScheduleStepSummary[];
  /** true nếu bị abort/dừng giữa chừng */
  stopped?: boolean;
  error?: string;
}

export interface Schedule {
  id: string;
  name: string;
  /** 'collection': chạy requests trong collection | 'flow': chạy flow */
  kind: 'collection' | 'flow';
  collectionId: string;
  /** 'all' | 'root' | folderId (chỉ dùng khi kind='collection') */
  folderId: string;
  /** flowId (chỉ dùng khi kind='flow') */
  flowId?: string;
  intervalMin: number;
  enabled: boolean;
  notify: boolean;
  nextRunAt: number;
  lastRun?: ScheduleRun;
  /** Lịch sử 20 lần gần nhất */
  runs: ScheduleRun[];
}

interface ScheduleState {
  schedules: Schedule[];
  addSchedule: (s: Omit<Schedule, 'id' | 'nextRunAt' | 'runs'>) => void;
  updateSchedule: (id: string, patch: Partial<Schedule>) => void;
  removeSchedule: (id: string) => void;
  recordRun: (id: string, run: ScheduleRun) => void;
  reschedule: (id: string, nextRunAt: number) => void;
}

const MAX_RUNS = 20;

export const useScheduleStore = create<ScheduleState>()(
  persist(
    (set) => ({
      schedules: [],
      addSchedule: (s) =>
        set((st) => ({
          schedules: [
            ...st.schedules,
            { ...s, id: uid('sch'), nextRunAt: Date.now() + s.intervalMin * 60000, runs: [] },
          ],
        })),
      updateSchedule: (id, patch) =>
        set((st) => ({
          schedules: st.schedules.map((s) => {
            if (s.id !== id) return s;
            const next = { ...s, ...patch };
            // Bật lại → tính giờ chạy kế tiếp từ bây giờ
            if (patch.enabled && !s.enabled) next.nextRunAt = Date.now() + next.intervalMin * 60000;
            return next;
          }),
        })),
      removeSchedule: (id) => set((st) => ({ schedules: st.schedules.filter((s) => s.id !== id) })),
      recordRun: (id, run) =>
        set((st) => ({
          schedules: st.schedules.map((s) =>
            s.id === id ? { ...s, lastRun: run, runs: [run, ...s.runs].slice(0, MAX_RUNS) } : s,
          ),
        })),
      reschedule: (id, nextRunAt) =>
        set((st) => ({
          schedules: st.schedules.map((s) => (s.id === id ? { ...s, nextRunAt } : s)),
        })),
    }),
    { name: 'postman-clone-schedules-v1', version: 2,
      // Lịch cũ (v1) chưa có kind → mặc định collection
      migrate: (s) => {
        const raw = s as { schedules?: Schedule[] };
        return {
          schedules: (raw?.schedules ?? []).map((x) => ({ ...x, kind: (x.kind ?? 'collection') as Schedule['kind'] })),
        };
      } },
  ),
);
