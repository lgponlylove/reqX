import type { Assertion, AssertionKind, AssertionOp } from '../types/api';
import { uid } from './variables';

/**
 * Bảng "Điều kiện kiểm thử" cho người không viết code: mỗi dòng là một so sánh
 * đơn giản, ReqX sinh ra đoạn `pm.test` tương ứng và nối vào chuỗi script Tests
 * (script-chain.ts) nên Builder / Runner / Flow / CLI đều chạy mà không cần sửa từng nơi.
 *
 * Sinh code bằng cách nối chuỗi + JSON.stringify, KHÔNG eval / new Function:
 * giá trị user gõ chỉ đi vào làm đối số, không bao giờ thành câu lệnh.
 */

const HELPER = `const __ax = (() => {
  const show = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v));
  const typeName = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
  const path = (obj, p) => {
    let cur = obj;
    const segs = String(p).split('.').filter((s) => s !== '');
    for (const seg of segs) {
      if (cur == null) return { found: false, value: undefined };
      if (Array.isArray(cur)) {
        const i = Number(seg);
        if (!Number.isInteger(i) || i < 0 || i >= cur.length) return { found: false, value: undefined };
        cur = cur[i];
      } else if (typeof cur === 'object') {
        if (!(seg in cur)) return { found: false, value: undefined };
        cur = cur[seg];
      } else return { found: false, value: undefined };
    }
    return { found: true, value: cur };
  };
  const header = (name) => {
    const hs = (pm.response && pm.response.headers) || {};
    if (typeof hs.get === 'function') return hs.get(name);
    const want = String(name).toLowerCase();
    for (const k of Object.keys(hs)) if (k.toLowerCase() === want) return hs[k];
    return undefined;
  };
  const read = (kind, target) => {
    if (kind === 'status') return { found: true, value: pm.response.status, what: 'status code' };
    if (kind === 'responseTime') return { found: true, value: pm.response.time, what: 'thời gian phản hồi (ms)' };
    if (kind === 'header') return { found: header(target) !== undefined, value: header(target), what: 'header "' + target + '"' };
    if (kind === 'jsonField') {
      let parsed;
      try { parsed = pm.response.json(); } catch (e) { throw new Error('Response không phải JSON hợp lệ: ' + e.message); }
      const r = path(parsed, target);
      return { found: r.found, value: r.value, what: 'JSON "' + target + '"' };
    }
    return { found: true, value: pm.response.text(), what: 'nội dung trả về' };
  };
  const check = (kind, target, op, expected) => {
    const r = read(kind, target);
    const got = show(r.value);
    if (op === 'exists') {
      if (!r.found || r.value == null) throw new Error('Thiếu ' + r.what + ' trong response');
      return;
    }
    if (op === 'notExists') {
      if (r.found && r.value != null) throw new Error(r.what + ' không được phép tồn tại trong response');
      return;
    }
    if (!r.found) throw new Error('Không lấy được ' + r.what);
    if (op === 'equal') {
      if (got !== expected) throw new Error(r.what + ' = ' + got + ', mong đợi ' + expected);
      return;
    }
    if (op === 'notEqual') {
      if (got === expected) throw new Error(r.what + ' không được bằng ' + expected);
      return;
    }
    if (op === 'contains') {
      if (Array.isArray(r.value)) {
        if (!r.value.some((x) => show(x) === expected)) throw new Error(r.what + ' không có phần tử ' + expected);
      } else if (String(got).indexOf(expected) < 0) {
        throw new Error(r.what + ' là ' + got + ', không chứa ' + expected);
      }
      return;
    }
    if (op === 'notContains') {
      if (Array.isArray(r.value)) {
        if (r.value.some((x) => show(x) === expected)) throw new Error(r.what + ' vẫn chứa phần tử ' + expected);
      } else if (String(got).indexOf(expected) >= 0) {
        throw new Error(r.what + ' vẫn chứa ' + expected);
      }
      return;
    }
    if (op === 'type') {
      const t = typeName(r.value);
      if (t !== expected) throw new Error(r.what + ' là kiểu ' + t + ', không phải ' + expected);
      return;
    }
    if (op === 'in') {
      const list = String(expected).split(',').map((s) => s.trim());
      if (list.indexOf(got) < 0) throw new Error(r.what + ' là ' + got + ', không thuộc [' + list.join(', ') + ']');
      return;
    }
    if (op === 'lt' || op === 'gt') {
      const n = Number(r.value);
      const e = Number(expected);
      if (!Number.isFinite(n)) throw new Error(r.what + ' không phải số (đang là ' + got + ')');
      if (op === 'lt' ? n >= e : n <= e) throw new Error(r.what + ' = ' + got + ', không ' + (op === 'lt' ? 'nhỏ hơn' : 'lớn hơn') + ' ' + expected);
      return;
    }
    if (got !== expected) throw new Error(r.what + ' = ' + got + ', mong đợi ' + expected);
  };
  return { check };
})();`;

const OP_LABEL: Record<AssertionOp, string> = {
  equal: 'bằng',
  notEqual: 'khác (≠)',
  in: 'thuộc danh sách',
  contains: 'chứa',
  notContains: 'không chứa',
  exists: 'tồn tại',
  notExists: 'không tồn tại',
  lt: 'nhỏ hơn (<)',
  gt: 'lớn hơn (>)',
  type: 'đúng kiểu dữ liệu',
};

/** Những op cho phép theo từng kind — UI dựng dropdown từ bảng này. */
const OPS_BY_KIND: Record<AssertionKind, AssertionOp[]> = {
  status: ['equal', 'notEqual', 'in', 'lt', 'gt'],
  responseTime: ['lt', 'gt', 'equal'],
  header: ['exists', 'notExists', 'equal', 'notEqual', 'contains', 'notContains', 'in'],
  jsonField: ['exists', 'notExists', 'equal', 'notEqual', 'contains', 'notContains', 'in', 'lt', 'gt', 'type'],
  bodyText: ['contains', 'notContains', 'exists'],
};

const KIND_LABEL: Record<AssertionKind, string> = {
  status: 'Mã trạng thái (HTTP status)',
  responseTime: 'Thời gian phản hồi (ms)',
  header: 'Header trả về',
  jsonField: 'Trường trong JSON (dot-path)',
  bodyText: 'Toàn bộ nội dung trả về',
};

export const ASSERTION_KINDS = (Object.keys(KIND_LABEL) as AssertionKind[]).map((id) => ({
  id,
  label: KIND_LABEL[id],
  ops: OPS_BY_KIND[id],
}));

export function opsFor(kind: AssertionKind): { id: AssertionOp; label: string }[] {
  return OPS_BY_KIND[kind].map((op) => ({ id: op, label: OP_LABEL[op] }));
}

/** Cần gõ thêm gì? (target / expected) — dùng để ẩn ô không liên quan. */
export function needs(kind: AssertionKind, op: AssertionOp): { target: boolean; expected: boolean } {
  const target = kind === 'header' || kind === 'jsonField';
  const expected = op !== 'exists' && op !== 'notExists';
  return { target, expected };
}

export function assertionLabel(a: Assertion): string {
  const where =
    a.kind === 'status' ? 'Status code'
    : a.kind === 'responseTime' ? 'Thời gian phản hồi (ms)'
    : a.kind === 'header' ? `Header "${a.target}"`
    : a.kind === 'jsonField' ? `JSON "${a.target}"`
    : 'Nội dung trả về';
  if (a.op === 'exists') return `${where} tồn tại`;
  if (a.op === 'notExists') return `${where} không được tồn tại`;
  if (a.op === 'lt') return `${where} < ${a.expected}`;
  if (a.op === 'gt') return `${where} > ${a.expected}`;
  if (a.op === 'notContains') return `${where} không chứa "${a.expected}"`;
  if (a.op === 'notEqual') return `${where} ≠ "${a.expected}"`;
  return `${where} ${OP_LABEL[a.op]} "${a.expected}"`;
}

/** Số dòng đang bật — hiện badge "N điều kiện" ở tab Tests. */
export function assertionCount(list?: Assertion[]): number {
  return (list ?? []).filter((a) => a.enabled).length;
}

/**
 * Biên dịch bảng điều kiện thành script pm.test. Trả về '' nếu không có dòng bật nào
 * (để không nhét script rỗng vào chuỗi kế thừa và không làm bẩn file Postman).
 */
export function compileAssertions(list?: Assertion[]): string {
  const active = (list ?? []).filter((a) => a.enabled);
  if (active.length === 0) return '';
  const lines = [
    '// ==== Điều kiện kiểm thử (bảng Assertions) — ReqX tự sinh, sửa trong bảng Tests/Assertions ====',
    HELPER,
    ...active.map((a) => {
      const name = JSON.stringify(assertionLabel(a));
      const args = [a.kind, a.target, a.op, a.expected].map((v) => JSON.stringify(String(v ?? ''))).join(', ');
      return `pm.test(${name}, () => { __ax.check(${args}); });`;
    }),
  ];
  return lines.join('\n');
}

/** Mẫu assertion nhanh (Quick Templates) cho QA */
export interface AssertionTemplate {
  label: string;
  desc: string;
  create: () => Assertion;
}

export function getQuickTemplates(): AssertionTemplate[] {
  return [
    {
      label: 'Status 200 OK',
      desc: 'Mã HTTP là 200',
      create: () => ({ id: uid('ax'), enabled: true, kind: 'status', target: '', op: 'equal', expected: '200' }),
    },
    {
      label: 'Status 2xx (Thành công)',
      desc: 'Mã HTTP 200, 201, 204',
      create: () => ({ id: uid('ax'), enabled: true, kind: 'status', target: '', op: 'in', expected: '200, 201, 204' }),
    },
    {
      label: 'Response Time < 500ms',
      desc: 'Phản hồi nhanh dưới 500ms',
      create: () => ({ id: uid('ax'), enabled: true, kind: 'responseTime', target: '', op: 'lt', expected: '500' }),
    },
    {
      label: 'Response Time < 2000ms',
      desc: 'Phản hồi dưới 2 giây',
      create: () => ({ id: uid('ax'), enabled: true, kind: 'responseTime', target: '', op: 'lt', expected: '2000' }),
    },
    {
      label: 'Content-Type JSON',
      desc: 'Header trả về là JSON',
      create: () => ({ id: uid('ax'), enabled: true, kind: 'header', target: 'Content-Type', op: 'contains', expected: 'application/json' }),
    },
    {
      label: 'JSON Field data.id',
      desc: 'Trường data.id tồn tại',
      create: () => ({ id: uid('ax'), enabled: true, kind: 'jsonField', target: 'data.id', op: 'exists', expected: '' }),
    },
    {
      label: 'Body chứa chuỗi',
      desc: 'Response body chứa từ khóa',
      create: () => ({ id: uid('ax'), enabled: true, kind: 'bodyText', target: '', op: 'contains', expected: 'success' }),
    },
  ];
}

/**
 * Tự động phân tích JSON Response để sinh danh sách các gợi ý JSON dot-paths (tối đa 30 paths)
 * Giúp QA chọn ngay trường cần assert mà không cần gõ tay.
 */
export function extractJsonPaths(obj: unknown, prefix = '', depth = 0): { path: string; value: string; type: string }[] {
  if (depth > 4 || obj === null || obj === undefined) return [];
  const results: { path: string; value: string; type: string }[] = [];

  if (Array.isArray(obj)) {
    const p = prefix ? `${prefix}.0` : '0';
    if (obj.length > 0) {
      results.push({ path: prefix ? `${prefix}.length` : 'length', value: String(obj.length), type: 'number' });
      results.push(...extractJsonPaths(obj[0], p, depth + 1));
    }
    return results.slice(0, 30);
  }

  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      const type = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
      const valStr = v !== null && typeof v === 'object' ? (Array.isArray(v) ? `[Array(${v.length})]` : '{Object}') : String(v);
      results.push({ path: p, value: valStr, type });

      if (v !== null && typeof v === 'object' && depth < 3) {
        results.push(...extractJsonPaths(v, p, depth + 1));
      }
    }
  }

  return results.slice(0, 30);
}
