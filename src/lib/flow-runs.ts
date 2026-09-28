import { useFlowStore } from '../stores/flow';
import { summarize } from './scheduleEngine';
import { saveBodies, pruneBodies } from './bodyStore';
import type { FlowStepResult } from './flow';

/**
 * Lưu kết quả 1 lần chạy flow tay (tab Flow, trợ lý AI...):
 * tóm tắt step vào store `runs` (giữ 20 lần/flow), body đầy đủ vào IndexedDB.
 * Xem lại ở tab Flow → lịch sử chạy.
 */
export async function recordManualFlowRun(
  flowId: string,
  flowName: string,
  at: number,
  results: FlowStepResult[],
  timeMs: number,
  stopped?: boolean,
): Promise<void> {
  const tag = `manual:${flowId}`;
  const { steps, bodies } = summarize(tag, at, results);
  await saveBodies(bodies);
  useFlowStore.getState().pushRun({
    kind: 'flow',
    refId: flowId,
    refName: flowName,
    at,
    ok: results.filter((r) => r.ok).length,
    total: results.length,
    timeMs: Math.round(timeMs),
    stopped: stopped || undefined,
    steps,
  });
  void pruneBodies(
    tag,
    new Set(useFlowStore.getState().runs.filter((r) => r.kind === 'flow' && r.refId === flowId).map((r) => r.at)),
  );
}
