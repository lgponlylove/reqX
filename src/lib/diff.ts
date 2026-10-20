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
