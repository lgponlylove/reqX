import type { ApiRequest, ApiResponse } from '../types/api';
import { sendRequest } from './http-client';

export interface StressTestConfig {
  /** Số luồng chạy đồng thời (Virtual Users / Concurrency: 1 - 100) */
  concurrency: number;
  /** Tổng số request cần gửi (Total Requests) */
  totalRequests: number;
  /** Giới hạn thời gian tối đa chạy tính bằng giây (Timeout/Duration: mặc định 60s) */
  durationSeconds?: number;
  /** Delay giữa các request trong cùng 1 worker (ms) */
  delayMs?: number;
  /** Thêm độ trễ jitter ngẫu nhiên để mô phỏng tải thực tế (ms) */
  jitterMs?: number;
}

export interface StressRequestResult {
  id: number;
  status?: number;
  timeMs: number;
  ok: boolean;
  error?: string;
  sizeBytes?: number;
}

export interface StressTestReport {
  total: number;
  completed: number;
  success: number;
  failed: number;
  errorRate: number; // Tỷ lệ % lỗi (0 - 100)
  totalDurationMs: number;
  rps: number; // Requests per second
  avgTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  statusCodes: Record<number, number>;
  errors: Record<string, number>;
}

/**
 * Tính toán các chỉ số phân vị (P50, P90, P95, P99) và KPI hiệu năng
 */
export function calculateStressReport(
  results: StressRequestResult[],
  durationMs: number
): StressTestReport {
  const completed = results.length;
  if (completed === 0) {
    return {
      total: 0,
      completed: 0,
      success: 0,
      failed: 0,
      errorRate: 0,
      totalDurationMs: Math.max(1, durationMs),
      rps: 0,
      avgTimeMs: 0,
      minTimeMs: 0,
      maxTimeMs: 0,
      p50Ms: 0,
      p90Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      statusCodes: {},
      errors: {},
    };
  }

  const success = results.filter((r) => r.ok).length;
  const failed = completed - success;
  const errorRate = Math.round((failed / completed) * 1000) / 10;
  const validTimes = results.map((r) => r.timeMs).sort((a, b) => a - b);
  const sumTime = validTimes.reduce((a, b) => a + b, 0);
  const avgTimeMs = Math.round(sumTime / completed);
  const minTimeMs = validTimes[0] ?? 0;
  const maxTimeMs = validTimes[validTimes.length - 1] ?? 0;

  const pPercentile = (pct: number) => {
    if (validTimes.length === 0) return 0;
    const idx = Math.min(validTimes.length - 1, Math.floor((pct / 100) * validTimes.length));
    return validTimes[idx] ?? 0;
  };

  const statusCodes: Record<number, number> = {};
  const errors: Record<string, number> = {};

  for (const r of results) {
    if (r.status != null) {
      statusCodes[r.status] = (statusCodes[r.status] || 0) + 1;
    }
    if (r.error) {
      const errKey = r.error.slice(0, 100);
      errors[errKey] = (errors[errKey] || 0) + 1;
    }
  }

  const safeDurationMs = Math.max(1, durationMs);
  const rps = Math.round((completed / (safeDurationMs / 1000)) * 10) / 10;

  return {
    total: completed,
    completed,
    success,
    failed,
    errorRate,
    totalDurationMs: safeDurationMs,
    rps,
    avgTimeMs,
    minTimeMs,
    maxTimeMs,
    p50Ms: pPercentile(50),
    p90Ms: pPercentile(90),
    p95Ms: pPercentile(95),
    p99Ms: pPercentile(99),
    statusCodes,
    errors,
  };
}

/**
 * Runner chạy tải và đua lệnh song song (Concurrent Stress Engine)
 */
export async function runStressTest(
  request: ApiRequest,
  config: StressTestConfig,
  context: {
    envVars?: Record<string, string>;
    globals?: Record<string, string>;
    signal?: AbortSignal;
    onProgress?: (progress: { completed: number; total: number; currentRps: number }) => void;
  }
): Promise<{ results: StressRequestResult[]; report: StressTestReport }> {
  const { concurrency = 5, totalRequests = 20, durationSeconds = 60, delayMs = 0, jitterMs = 0 } = config;
  const results: StressRequestResult[] = [];
  const startTime = performance.now();
  const maxTimeMs = durationSeconds * 1000;
  let cursor = 0;

  async function worker() {
    while (cursor < totalRequests) {
      if (context.signal?.aborted) break;
      if (performance.now() - startTime >= maxTimeMs) break;

      const currentIdx = ++cursor;
      if (currentIdx > totalRequests) break;

      const t0 = performance.now();
      try {
        const res = await sendRequest(
          request,
          context.envVars ?? {},
          context.globals ?? {},
          { timeoutMs: 30000 },
          context.signal
        );
        const timeMs = Math.round(performance.now() - t0);
        const ok = res.status >= 200 && res.status < 400;

        results.push({
          id: currentIdx,
          status: res.status,
          timeMs,
          ok,
          sizeBytes: res.sizeBytes,
        });
      } catch (err) {
        const timeMs = Math.round(performance.now() - t0);
        results.push({
          id: currentIdx,
          timeMs,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (context.onProgress) {
        const elapsedS = Math.max(0.1, (performance.now() - startTime) / 1000);
        context.onProgress({
          completed: results.length,
          total: totalRequests,
          currentRps: Math.round((results.length / elapsedS) * 10) / 10,
        });
      }

      // Delay / Jitter nếu cấu hình
      if (delayMs > 0 || jitterMs > 0) {
        const wait = delayMs + (jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0);
        if (wait > 0) {
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, wait);
            context.signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
          });
        }
      }
    }
  }

  // Khởi động đồng thời `concurrency` workers
  const poolSize = Math.max(1, Math.min(concurrency, totalRequests));
  const workers = Array.from({ length: poolSize }, () => worker());
  await Promise.all(workers);

  const totalDurationMs = Math.round(performance.now() - startTime);
  const report = calculateStressReport(results, totalDurationMs);

  return { results, report };
}
