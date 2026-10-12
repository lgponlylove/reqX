import { describe, it, expect } from 'vitest';
import { importPostmanCollection } from '../postman-io';

describe('importPostmanCollection fixes', () => {
  it('parses collection-level apikey auth', () => {
    const json = {
      info: { name: 'Test Auth' },
      auth: {
        type: 'apikey',
        apikey: [
          { key: 'key', value: 'my-secret-key' },
          { key: 'name', value: 'X-API-Key' },
          { key: 'in', value: 'header' },
        ],
      },
      item: [
        {
          name: 'Test Request',
          request: { method: 'GET', url: 'https://api.example.com/test' },
        },
      ],
    };
    const result = importPostmanCollection(json);
    expect(result.collection.name).toBe('Test Auth');
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].auth.type).toBe('apikey');
    if (result.requests[0].auth.type === 'apikey') {
      expect(result.requests[0].auth.apiKey).toBe('my-secret-key');
      expect(result.requests[0].auth.apiKeyName).toBe('X-API-Key');
      expect(result.requests[0].auth.apiKeyIn).toBe('header');
    }
  });

  it('request-level auth overrides collection-level', () => {
    const json = {
      info: { name: 'Override Test' },
      auth: { type: 'bearer', bearer: [{ key: 'token', value: 'col-token' }] },
      item: [
        {
          name: 'Request with own auth',
          request: {
            method: 'GET',
            url: 'https://api.example.com',
            auth: { type: 'basic', basic: [{ key: 'username', value: 'user' }, { key: 'password', value: 'pass' }] },
          },
        },
      ],
    };
    const result = importPostmanCollection(json);
    expect(result.requests[0].auth.type).toBe('basic');
    if (result.requests[0].auth.type === 'basic') {
      expect(result.requests[0].auth.username).toBe('user');
      expect(result.requests[0].auth.password).toBe('pass');
    }
  });

  it('handles nested folders recursively', () => {
    const json = {
      info: { name: 'Nested' },
      item: [
        {
          name: 'Folder Level 1',
          item: [
            { name: 'Req in L1', request: { method: 'GET', url: 'https://a.com' } },
            {
              name: 'Folder Level 2',
              item: [
                { name: 'Req in L2', request: { method: 'POST', url: 'https://b.com' } },
              ],
            },
          ],
        },
      ],
    };
    const result = importPostmanCollection(json);
    expect(result.requests).toHaveLength(2);
    expect(result.collection.folders.length).toBeGreaterThan(0);
  });

  it('parses form-data body mode', () => {
    const json = {
      info: { name: 'FormData' },
      item: [
        {
          name: 'Upload',
          request: {
            method: 'POST',
            url: 'https://upload.com',
            body: {
              mode: 'formdata',
              formdata: [
                { key: 'file', value: '/path/to/file.png' },
                { key: 'description', value: 'Test upload' },
              ],
            },
          },
        },
      ],
    };
    const result = importPostmanCollection(json);
    expect(result.requests[0].bodyType).toBe('form-data');
    expect(result.requests[0].body).toContain('file=/path/to/file.png');
  });

  it('respects disabled headers', () => {
    const json = {
      info: { name: 'Disabled Header' },
      item: [
        {
          name: 'Test',
          request: {
            method: 'GET',
            url: 'https://test.com',
            header: [
              { key: 'Content-Type', value: 'application/json' },
              { key: 'X-Disabled', value: 'should-be-off', disabled: true },
            ],
          },
        },
      ],
    };
    const result = importPostmanCollection(json);
    expect(result.requests[0].headers).toHaveLength(2);
    expect(result.requests[0].headers[0].enabled).toBe(true);
    expect(result.requests[0].headers[1].enabled).toBe(false);
  });
});
