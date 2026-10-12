import { describe, expect, it } from 'vitest';
import { parseCurl } from '../curl-import';
import { toCurl } from '../codegen';
import type { ApiRequest } from '../../types/api';

describe('curl-import & multipart form-data file attachment', () => {
  it('parses curl with --form file and extracts filepath cleanly', () => {
    const rawCurl = `curl --location 'http://localhost:8080/inbound-receipts/upload-img' \\
--header 'Content-Type: application/json' \\
--form 'files=@"/D:/test/27072026153722_test1.png"'`;

    const { request: req, warnings } = parseCurl(rawCurl);
    expect(req.url).toBe('http://localhost:8080/inbound-receipts/upload-img');
    expect(req.bodyType).toBe('form-data');
    expect(req.body).toBe('files=@/D:/test/27072026153722_test1.png');
    // Ensure warning about unsupported file upload is not emitted
    expect(warnings.some((w) => w.includes('Upload file'))).toBe(false);
  });

  it('generates curl with --form files=@"..."', () => {
    const req: ApiRequest = {
      id: 'r1',
      name: 'Upload Test',
      method: 'POST',
      url: 'http://localhost:8080/upload',
      params: [],
      headers: [],
      bodyType: 'form-data',
      body: 'files=@D:/test/sample.png\ntitle=Báo cáo',
      auth: { type: 'none' },
      collectionId: '',
      updatedAt: 1,
    };

    const curl = toCurl(req, {});
    expect(curl).toContain(`--form 'files=@D:/test/sample.png'`);
    expect(curl).toContain(`--form 'title=Báo cáo'`);
  });
});
