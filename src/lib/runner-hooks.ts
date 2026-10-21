import { useAppStore } from '../stores/app';
import type { RunnerHooks } from './runner';

/**
 * RunnerHooks đọc/ghi thẳng vào store (env đang active + globals) —
 * dùng chung cho trợ lý AI và bảng test case khi chạy ngoài tab Builder.
 */
export function storeHooks(): RunnerHooks {
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
