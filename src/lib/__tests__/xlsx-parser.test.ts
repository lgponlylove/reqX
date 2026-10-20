import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseXlsxBuffer } from '../xlsx-parser';

describe('parseXlsxBuffer', () => {
  it('đọc đúng sheet, sharedStrings và dữ liệu dòng/cột từ file .xlsx', async () => {
    const zip = new JSZip();

    // 1. sharedStrings.xml
    zip.file(
      'xl/sharedStrings.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
        <si><t>userId</t></si>
        <si><t>userName</t></si>
        <si><t>Alice Nguyen</t></si>
        <si><t>Bob Tran</t></si>
      </sst>`
    );

    // 2. workbook.xml
    zip.file(
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets>
          <sheet name="Users" sheetId="1" r:id="rId1"/>
        </sheets>
      </workbook>`
    );

    // 3. relationships
    zip.file(
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
      </Relationships>`
    );

    // 4. sheet1.xml (Row 1: Header userId, userName; Row 2: 101, Alice Nguyen; Row 3: 102, Bob Tran)
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1">
            <c r="A1" t="s"><v>0</v></c>
            <c r="B1" t="s"><v>1</v></c>
          </row>
          <row r="2">
            <c r="A2"><v>101</v></c>
            <c r="B2" t="s"><v>2</v></c>
          </row>
          <row r="3">
            <c r="A3"><v>102</v></c>
            <c r="B3" t="s"><v>3</v></c>
          </row>
        </sheetData>
      </worksheet>`
    );

    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const res = await parseXlsxBuffer(buffer);

    expect(res.error).toBeUndefined();
    expect(res.sheets).toEqual(['Users']);
    expect(res.data['Users'].columns).toEqual(['userId', 'userName']);
    expect(res.data['Users'].rows).toEqual([
      { userId: '101', userName: 'Alice Nguyen' },
      { userId: '102', userName: 'Bob Tran' },
    ]);
  });

  it('báo lỗi khi file zip rỗng hoặc hỏng', async () => {
    const corruptBuffer = new Uint8Array([0, 1, 2, 3]);
    const res = await parseXlsxBuffer(corruptBuffer);
    expect(res.error).toMatch(/Lỗi đọc file Excel/);
  });
});
