import { create } from 'zustand';
import type { ApiRequest } from '../types/api';
import type { CaseRunResult, TestCase } from '../lib/test-cases';

/**
 * Bộ key test do AI sinh ra + kết quả chạy, chỉ giữ trong RAM của phiên làm việc
 * (không persist: dữ liệu test và response có thể chứa token).
 */
interface TestCaseState {
  open: boolean;
  /**
   * Bản chụp request tại lúc sinh bộ case — tab Builder chưa lưu vẫn chạy được,
   * và sửa request sau đó không làm lệch kết quả.
   */
  base: ApiRequest | null;
  cases: TestCase[];
  results: Record<string, CaseRunResult>;
  running: boolean;
  hide: () => void;
  setCases: (base: ApiRequest, cases: TestCase[]) => void;
  patchCase: (id: string, patch: Partial<TestCase>) => void;
  removeCase: (id: string) => void;
  addCase: () => void;
  setResult: (id: string, r: CaseRunResult | null) => void;
  clearResults: () => void;
  setRunning: (v: boolean) => void;
}

export const useTestCaseStore = create<TestCaseState>()((set) => ({
  open: false,
  base: null,
  cases: [],
  results: {},
  running: false,

  hide: () => set({ open: false }),

  setCases: (base, cases) => set({ base, cases, results: {}, open: true }),

  patchCase: (id, patch) =>
    set((s) => ({ cases: s.cases.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),

  removeCase: (id) =>
    set((s) => {
      const results = { ...s.results };
      delete results[id];
      return { cases: s.cases.filter((c) => c.id !== id), results };
    }),

  addCase: () =>
    set((s) => ({
      cases: [
        ...s.cases,
        {
          id: `tc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          name: `Case mới ${s.cases.length + 1}`,
          group: 'valid',
          data: {},
          expect: { status: '2xx' },
        },
      ],
    })),

  setResult: (id, r) =>
    set((s) => {
      const results = { ...s.results };
      if (r) results[id] = r;
      else delete results[id];
      return { results };
    }),

  clearResults: () => set({ results: {} }),
  setRunning: (v) => set({ running: v }),
}));
