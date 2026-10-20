export interface DiffLine {
  type: 'same' | 'added' | 'removed';
  line: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export function tryFormatJson(str: string): string {
  try {
    const parsed = JSON.parse(str);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return str;
  }
}

/**
 * Thuật toán Longest Common Subsequence (LCS) tính toán diff dòng
 */
export function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const n = oldLines.length;
  const m = newLines.length;

  // Ma trận DP LCS
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (oldLines[i] === newLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack để tạo danh sách DiffLine
  let i = n;
  let j = m;
  const resultReversed: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      resultReversed.push({
        type: 'same',
        line: oldLines[i - 1],
        oldLineNum: i,
        newLineNum: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      resultReversed.push({
        type: 'added',
        line: newLines[j - 1],
        newLineNum: j,
      });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      resultReversed.push({
        type: 'removed',
        line: oldLines[i - 1],
        oldLineNum: i,
      });
      i--;
    }
  }

  return resultReversed.reverse();
}

export type JsonDiffType = 'added' | 'removed' | 'modified' | 'type_changed';

export interface JsonDiffEntry {
  path: string;
  type: JsonDiffType;
  oldValue?: unknown;
  newValue?: unknown;
  oldType?: string;
  newType?: string;
}

function getJsonValType(val: unknown): string {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

/**
 * So sánh cấu trúc sâu giữa 2 object/array JSON (deep structural diff)
 */
export function diffJson(
  oldVal: unknown,
  newVal: unknown,
  prefix = ''
): JsonDiffEntry[] {
  const entries: JsonDiffEntry[] = [];
  const oldType = getJsonValType(oldVal);
  const newType = getJsonValType(newVal);

  if (oldType !== newType) {
    entries.push({
      path: prefix || '(root)',
      type: 'type_changed',
      oldValue: oldVal,
      newValue: newVal,
      oldType,
      newType,
    });
    return entries;
  }

  // Cả hai cùng là object (không phải array, không phải null)
  if (oldType === 'object') {
    const oldObj = (oldVal || {}) as Record<string, unknown>;
    const newObj = (newVal || {}) as Record<string, unknown>;
    const allKeys = Array.from(new Set([...Object.keys(oldObj), ...Object.keys(newObj)]));

    for (const k of allKeys) {
      const p = prefix ? `${prefix}.${k}` : k;
      const hasOld = k in oldObj;
      const hasNew = k in newObj;

      if (!hasOld && hasNew) {
        entries.push({
          path: p,
          type: 'added',
          newValue: newObj[k],
          newType: getJsonValType(newObj[k]),
        });
      } else if (hasOld && !hasNew) {
        entries.push({
          path: p,
          type: 'removed',
          oldValue: oldObj[k],
          oldType: getJsonValType(oldObj[k]),
        });
      } else {
        entries.push(...diffJson(oldObj[k], newObj[k], p));
      }
    }
    return entries;
  }

  // Cả hai cùng là array
  if (oldType === 'array') {
    const oldArr = (oldVal || []) as unknown[];
    const newArr = (newVal || []) as unknown[];
    const maxLen = Math.max(oldArr.length, newArr.length);

    if (oldArr.length !== newArr.length) {
      entries.push({
        path: prefix ? `${prefix}.length` : 'length',
        type: 'modified',
        oldValue: oldArr.length,
        newValue: newArr.length,
      });
    }

    for (let i = 0; i < maxLen; i++) {
      const p = `${prefix || 'items'}[${i}]`;
      if (i >= oldArr.length) {
        entries.push({
          path: p,
          type: 'added',
          newValue: newArr[i],
          newType: getJsonValType(newArr[i]),
        });
      } else if (i >= newArr.length) {
        entries.push({
          path: p,
          type: 'removed',
          oldValue: oldArr[i],
          oldType: getJsonValType(oldArr[i]),
        });
      } else {
        entries.push(...diffJson(oldArr[i], newArr[i], p));
      }
    }
    return entries;
  }

  // Kiểu nguyên thủy (primitive: string, number, boolean, null)
  if (oldVal !== newVal) {
    entries.push({
      path: prefix || '(root)',
      type: 'modified',
      oldValue: oldVal,
      newValue: newVal,
      oldType,
      newType,
    });
  }

  return entries;
}
