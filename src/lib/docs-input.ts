import { useAppStore } from '../stores/app';
import { useFlowStore } from '../stores/flow';
import { useTestCaseStore } from '../stores/testcases';
import { useLanguageStore } from '../stores/language';
import type { DocsFlow, DocsSample, DocsTestRun } from './api-docs';

/**
 * Những gì bộ sinh tài liệu cần nhưng `api-docs.ts` không được tự lấy
 * (lib phải thuần, chạy được trong test Node). Component gọi helper này rồi
 * đưa kết quả vào `renderCollectionDocs` / `renderSingleRequestDocs`.
 */
export interface DocsExtras {
  lang: 'vi' | 'en';
  samples: DocsSample[];
  flows: DocsFlow[];
  testRun?: DocsTestRun;
}

export function collectDocsExtras(): DocsExtras {
  const history = useAppStore.getState().history;
  const flows = useFlowStore.getState().flows;
  const { base, cases, results } = useTestCaseStore.getState();

  // Lịch sử đã được che secret ngay lúc lưu nên bản mẫu mang ra file cũng an toàn.
  const samples: DocsSample[] = history
    .filter((h) => h.response && h.response.bodyKind !== 'binary' && h.response.body.trim() !== '')
    .map((h) => ({
      requestId: h.request.id,
      method: h.request.method,
      url: h.request.url,
      status: h.response!.status,
      body: h.response!.body,
      timeMs: h.createdAt,
    }));

  const testRun: DocsTestRun | undefined = base && cases.length > 0 ? { requestId: base.id, cases, results } : undefined;

  return {
    lang: useLanguageStore.getState().lang,
    samples,
    flows: flows.map((f) => ({
      name: f.name,
      steps: f.steps.map((s) => ({ requestId: s.requestId, extract: s.extract.map((e) => ({ name: e.name })) })),
    })),
    testRun,
  };
}
