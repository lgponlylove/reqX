import JSZip from 'jszip';

export interface ParsedXlsx {
  sheets: string[];
  /** sheet name -> { rows, columns } */
  data: Record<string, { rows: Record<string, string>[]; columns: string[] }>;
  error?: string;
}

const MAX_ROWS = 5000;

/** Chuyển mã cột dạng 'A', 'B', ... 'Z', 'AA', 'AB' sang chỉ số 0, 1, 2... */
function colLettersToIndex(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

/** Tách tọa độ ô Excel ví dụ 'B2' -> { col: 1, row: 2 } */
function parseCellRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  return {
    col: colLettersToIndex(m[1]),
    row: parseInt(m[2], 10),
  };
}

/**
 * Trình bóc tách XML mini hoạt động đa nền tảng (Node.js/Vitest, Web browser, Tauri)
 * mà không cần phụ thuộc vào biến toàn cục DOMParser của browser.
 */
function extractXmlTags(xml: string, tagName: string): { content: string; attrs: Record<string, string> }[] {
  const results: { content: string; attrs: Record<string, string> }[] = [];
  // Regex bắt <tagName attr="val"...>content</tagName> hoặc tự đóng <tagName .../>
  const tagRegex = new RegExp(`<${tagName}\\b([^>]*)(?:>([\\s\\S]*?)<\\/${tagName}>|\\/>)`, 'gi');
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(xml)) !== null) {
    const rawAttrs = match[1] || '';
    const content = match[2] || '';
    const attrs: Record<string, string> = {};

    const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2] ?? attrMatch[3] ?? '';
    }

    results.push({ content, attrs });
  }

  return results;
}

/**
 * Đọc file .xlsx thuần túy bằng JSZip + XML parser nhẹ (zero dependency nặng nề, chạy mượt trên Node.js, Web & Tauri).
 */
export async function parseXlsxBuffer(buffer: ArrayBuffer | Uint8Array): Promise<ParsedXlsx> {
  try {
    const zip = await JSZip.loadAsync(buffer);

    // 1. Đọc sharedStrings.xml (nơi Excel lưu text để tối ưu dung lượng)
    const sharedStrings: string[] = [];
    const sstFile = zip.file('xl/sharedStrings.xml');
    if (sstFile) {
      const sstXml = await sstFile.async('text');
      const siTags = extractXmlTags(sstXml, 'si');
      for (const si of siTags) {
        // si có thể chứa <t> đơn hoặc nhiều <r><t>...</t></r>
        const tTags = extractXmlTags(si.content, 't');
        let textVal = '';
        for (const t of tTags) {
          textVal += t.content;
        }
        sharedStrings.push(textVal);
      }
    }

    // 2. Đọc workbook.xml để lấy danh sách tên Sheet
    const wbFile = zip.file('xl/workbook.xml');
    const sheetMap: { id: string; name: string; rId: string }[] = [];
    if (wbFile) {
      const wbXml = await wbFile.async('text');
      const sheetTags = extractXmlTags(wbXml, 'sheet');
      for (let i = 0; i < sheetTags.length; i++) {
        const s = sheetTags[i].attrs;
        const name = s['name'] || `Sheet${i + 1}`;
        const sheetId = s['sheetId'] || String(i + 1);
        const rId = s['r:id'] || s['id'] || '';
        sheetMap.push({ id: sheetId, name, rId });
      }
    }

    // 3. Đọc relationships xl/_rels/workbook.xml.rels để ánh xạ rId -> file xml sheet
    const relsFile = zip.file('xl/_rels/workbook.xml.rels');
    const rIdToTarget: Record<string, string> = {};
    if (relsFile) {
      const relsXml = await relsFile.async('text');
      const relTags = extractXmlTags(relsXml, 'Relationship');
      for (const r of relTags) {
        const id = r.attrs['Id'];
        const target = r.attrs['Target'];
        if (id && target) rIdToTarget[id] = target.replace(/^\/?/, 'xl/');
      }
    }

    if (sheetMap.length === 0) {
      // Fallback nếu không parse được sheetMap: tìm file xl/worksheets/sheet*.xml
      const files = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(f));
      files.forEach((f, idx) => {
        sheetMap.push({ id: String(idx + 1), name: `Sheet${idx + 1}`, rId: f });
      });
    }

    const sheets: string[] = [];
    const data: Record<string, { rows: Record<string, string>[]; columns: string[] }> = {};

    for (const s of sheetMap) {
      let targetPath = rIdToTarget[s.rId] || s.rId;
      if (!targetPath.startsWith('xl/')) targetPath = 'xl/' + targetPath;
      let sheetFile = zip.file(targetPath);
      if (!sheetFile) {
        sheetFile = zip.file(`xl/worksheets/sheet${s.id}.xml`) || zip.file(`xl/worksheets/sheet1.xml`);
      }
      if (!sheetFile) continue;

      sheets.push(s.name);
      const sheetXml = await sheetFile.async('text');
      const rowTags = extractXmlTags(sheetXml, 'row');

      // Ma trận dòng/cột tạm thời
      const matrix: string[][] = [];
      for (let rIdx = 0; rIdx < rowTags.length; rIdx++) {
        const rowTag = rowTags[rIdx];
        const rowNum = parseInt(rowTag.attrs['r'] || String(rIdx + 1), 10);
        const cellTags = extractXmlTags(rowTag.content, 'c');
        const rowData: string[] = [];

        for (let cIdx = 0; cIdx < cellTags.length; cIdx++) {
          const c = cellTags[cIdx];
          const cellRef = c.attrs['r'];
          const type = c.attrs['t']; // 's' = shared string, 'inlineStr'

          let val = '';
          if (type === 's') {
            const vTags = extractXmlTags(c.content, 'v');
            if (vTags.length > 0) {
              const sstIdx = parseInt(vTags[0].content || '0', 10);
              val = sharedStrings[sstIdx] ?? '';
            }
          } else if (type === 'inlineStr' || (!type && c.content.includes('<is>'))) {
            const isTags = extractXmlTags(c.content, 'is');
            if (isTags.length > 0) {
              const tTags = extractXmlTags(isTags[0].content, 't');
              val = tTags.map((t) => t.content).join('');
            }
          } else {
            const vTags = extractXmlTags(c.content, 'v');
            if (vTags.length > 0) {
              val = vTags[0].content || '';
            } else {
              const tTags = extractXmlTags(c.content, 't');
              if (tTags.length > 0) {
                val = tTags.map((t) => t.content).join('');
              }
            }
          }

          if (cellRef) {
            const parsed = parseCellRef(cellRef);
            if (parsed) {
              while (rowData.length < parsed.col) rowData.push('');
              rowData[parsed.col] = val.trim();
              continue;
            }
          }
          rowData.push(val.trim());
        }

        while (matrix.length < rowNum - 1) matrix.push([]);
        matrix[rowNum - 1] = rowData;
      }

      // Lọc các dòng rỗng hoàn toàn ở đầu
      const cleanRows = matrix.filter((row) => row && row.some((cell) => cell !== ''));
      if (cleanRows.length < 2) {
        data[s.name] = { rows: [], columns: [] };
        continue;
      }

      // Dòng 1 là Tiêu đề cột
      const columns = cleanRows[0].map((c, i) => c.trim() || `col_${i + 1}`);
      const rows: Record<string, string>[] = [];

      for (let i = 1; i < cleanRows.length && rows.length < MAX_ROWS; i++) {
        const cells = cleanRows[i];
        const row: Record<string, string> = {};
        columns.forEach((colName, cIdx) => {
          row[colName] = cells[cIdx] ?? '';
        });
        rows.push(row);
      }

      data[s.name] = { rows, columns };
    }

    if (sheets.length === 0) {
      return { sheets: [], data: {}, error: 'Không tìm thấy Sheet hợp lệ trong file Excel!' };
    }

    return { sheets, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sheets: [], data: {}, error: `Lỗi đọc file Excel (.xlsx): ${msg}` };
  }
}
