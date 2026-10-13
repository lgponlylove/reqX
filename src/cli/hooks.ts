import type { RunnerHooks } from '../lib/runner';
import { looksSecret } from '../lib/secrets';

export interface VarSnapshot {
  envVars: Record<string, string>;
  globals: Record<string, string>;
}

export interface NodeRunnerHooks extends RunnerHooks {
  /** Giá trị hiện tại sau khi script ghi đè — dùng cho báo cáo cuối run. */
  snapshot: () => VarSnapshot;
  /** Nhật ký biến do script tạo ra (giá trị secret đã che). */
  writes: string[];
}

function redact(key: string, value: string): string {
  return looksSecret(key, value) ? '***' : value;
}

/**
 * RunnerHooks cho Node: hai bảng biến nằm trong RAM của process, đóng process là mất.
 * Không có đường ghi đĩa — biến bí mật từ CI env chỉ sống tới hết run.
 */
export function nodeHooks(initial: VarSnapshot): NodeRunnerHooks {
  const env = new Map(Object.entries(initial.envVars));
  const globals = new Map(Object.entries(initial.globals));
  const writes: string[] = [];
  const record = (kind: 'environment' | 'global', k: string, v: string) => {
    writes.push(`pm.${kind}.set("${k}", "${redact(k, v)}")`);
  };
  return {
    getVars: () => ({ envVars: Object.fromEntries(env), globals: Object.fromEntries(globals) }),
    setEnv: (k, v) => {
      env.set(k, v);
      record('environment', k, v);
    },
    setGlobal: (k, v) => {
      globals.set(k, v);
      record('global', k, v);
    },
    snapshot: () => ({ envVars: Object.fromEntries(env), globals: Object.fromEntries(globals) }),
    writes,
  };
}
