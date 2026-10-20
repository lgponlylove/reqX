/** Nạp file data cho Runner (Postman: data file CSV/JSON). Mỗi dòng = 1 iteration. */

import { parseXlsxBuffer } from './xlsx-parser';

export interface ParsedDataFile {
  rows: Record<string, string>[];
  columns: string[];
  sheets?: string[];
  selectedSheet?: string;
  error?: string;
}

const MAX_ROWS = 5000;

/** Tách 1 dòng CSV (chịu dấu phẩy trong "..." và "" escapes). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(text: string): ParsedDataFile {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { rows: [], columns: [], error: 'File CSV trống!' };
  if (lines.length === 1) return { rows: [], columns: [], error: 'CSV cần ít nhất 2 dòng (tiêu đề + dữ liệu)!' };
  const columns = splitCsvLine(lines[0]);
  if (columns.some((c) => c === '')) return { rows: [], columns, error: 'Dòng tiêu đề CSV có cột trống!' };
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length && rows.length < MAX_ROWS; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    columns.forEach((c, j) => { row[c] = cells[j] ?? ''; });
    rows.push(row);
  }
  return { rows, columns };
}

const strVal = (v: unknown): string =>
  v == null ? '' : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);

function parseJson(text: string): ParsedDataFile {
  let arr: unknown;
  try {
    arr = JSON.parse(text);
  } catch {
    return { rows: [], columns: [], error: 'File JSON sai cú pháp!' };
  }
  if (!Array.isArray(arr)) {
    // 1 object đơn → bọc thành 1 dòng (tiện khi AI sinh data test)
    if (arr && typeof arr === 'object') arr = [arr];
    else return { rows: [], columns: [], error: 'JSON phải là mảng các object, VD: [{"monId":"12"}]' };
  }
  const list = arr as unknown[];
  if (list.length === 0) {
    return { rows: [], columns: [], error: 'JSON phải là mảng các object, VD: [{"monId":"12"}]' };
  }
  const bad = list.findIndex((x) => typeof x !== 'object' || x === null || Array.isArray(x));
  if (bad >= 0) return { rows: [], columns: [], error: `Phần tử #${bad + 1} không phải object!` };
  const rows = (list as Record<string, unknown>[]).slice(0, MAX_ROWS).map((o) => {
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) r[k] = strVal(v);
    return r;
  });
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  // Ô thiếu ở dòng nào thì bù '' (giống CSV)
  for (const r of rows) for (const c of columns) if (!(c in r)) r[c] = '';
  return { rows, columns };
}

/** Đoán định dạng theo đuôi file (.csv / .json / .xlsx). */
export function parseDataFile(text: string, filename: string): ParsedDataFile {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json')) return parseJson(text);
  if (lower.endsWith('.csv')) return parseCsv(text);
  if (lower.endsWith('.xlsx')) {
    return { rows: [], columns: [], error: 'Vui lòng sử dụng parseDataFileAsync cho file .xlsx!' };
  }
  return { rows: [], columns: [], error: 'Chỉ nhận file .csv, .json hoặc .xlsx!' };
}

/** Hỗ trợ parse async (đặc biệt cho file nhị phân Excel .xlsx) */
export async function parseDataFileAsync(
  data: string | ArrayBuffer,
  filename: string,
  sheetName?: string
): Promise<ParsedDataFile> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx')) {
    try {
      const buffer = typeof data === 'string'
        ? new TextEncoder().encode(data).buffer
        : data;
      const parsed = await parseXlsxBuffer(buffer);
      if (parsed.error) {
        return { rows: [], columns: [], error: parsed.error };
      }
      if (parsed.sheets.length === 0) {
        return { rows: [], columns: [], error: 'File Excel không có sheet nào!' };
      }
      const targetSheetName = sheetName && parsed.sheets.includes(sheetName)
        ? sheetName
        : parsed.sheets[0];
      const sheetData = parsed.data[targetSheetName] || { rows: [], columns: [] };

      return {
        rows: sheetData.rows.slice(0, MAX_ROWS),
        columns: sheetData.columns,
        sheets: parsed.sheets,
        selectedSheet: targetSheetName,
      };
    } catch (err) {
      return {
        rows: [],
        columns: [],
        error: `Không thể đọc file Excel: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
  return parseDataFile(text, filename);
}

/** Tóm tắt 1 dòng để hiện UI (tối đa 2 cột đầu). */
export function rowSummary(row: Record<string, string>, columns: string[]): string {
  const parts = columns.slice(0, 2).map((c) => `${c}=${row[c] ?? ''}`);
  if (columns.length > 2) parts.push(`+${columns.length - 2}`);
  return parts.join(' ');
}
