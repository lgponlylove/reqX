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

  it('parses POST curl without body and reproduces all headers in toCurl', () => {
    const rawCurl = `curl -X POST 'https://sso.shome.vn/cobra-permit-access-control-service/api/permit/service/load/menu' \\
  -H 'Authorization: Bearer e5eeacdc-c088-4052-8095-510f29e1ab14' \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json'`;

    const { request: req } = parseCurl(rawCurl);
    expect(req.method).toBe('POST');
    expect(req.bodyType).toBe('none');
    expect(req.headers).toHaveLength(3);
    expect(req.headers[0].key).toBe('Authorization');
    expect(req.headers[1].key).toBe('Content-Type');
    expect(req.headers[2].key).toBe('Accept');

    const generated = toCurl(req, {});
    expect(generated).toContain("Authorization: Bearer e5eeacdc-c088-4052-8095-510f29e1ab14");
    expect(generated).toContain("Content-Type: application/json");
    expect(generated).toContain("Accept: application/json");
    expect(generated).not.toContain("--form");
  });

  it('generates correct Content-Type for raw subtypes (xml, text)', () => {
    const xmlReq: ApiRequest = {
      id: 'r_xml',
      name: 'XML Test',
      method: 'POST',
      url: 'https://api.example.com/soap',
      params: [],
      headers: [],
      bodyType: 'raw',
      rawType: 'xml',
      body: '<soap><body>test</body></soap>',
      auth: { type: 'none' },
      collectionId: '',
      updatedAt: 1,
    };
    const xmlCurl = toCurl(xmlReq, {});
    expect(xmlCurl).toContain("Content-Type: application/xml");
    expect(xmlCurl).toContain("--data-raw '<soap><body>test</body></soap>'");

    const textReq: ApiRequest = {
      id: 'r_text',
      name: 'Text Test',
      method: 'POST',
      url: 'https://api.example.com/plain',
      params: [],
      headers: [],
      bodyType: 'raw',
      rawType: 'text',
      body: 'Hello Plain Text',
      auth: { type: 'none' },
      collectionId: '',
      updatedAt: 1,
    };
    const textCurl = toCurl(textReq, {});
    expect(textCurl).toContain("Content-Type: text/plain");
    expect(textCurl).toContain("--data-raw 'Hello Plain Text'");
  });
});

