import { describe, it, expect, beforeEach } from 'vitest';
import { CookieJar } from '../cookie-jar';
import { applyExtendedAuth } from '../auth-protocols';
import { computeDiff, tryFormatJson } from '../diff';
import { matchOpenApiPath, validateResponseContract, extractEmbeddedSchema } from '../contract-test';
import type { ApiRequest } from '../../types/api';

describe('QC Urgent Features', () => {
  describe('1. Cookie Jar RFC 6265', () => {
    let jar: CookieJar;

    beforeEach(() => {
      jar = new CookieJar();
      jar.clear();
    });

    it('lưu cookie và tự động match domain/path', () => {
      jar.setCookie('https://api.example.com/v1/users', 'session=abc123xyz; Path=/v1; HttpOnly');
      const header = jar.getCookieHeader('https://api.example.com/v1/orders');
      expect(header).toBe('session=abc123xyz');

      // Khác domain không nhận cookie
      const otherHeader = jar.getCookieHeader('https://other.com/v1/orders');
      expect(otherHeader).toBe('');

      // Khác path ngoài /v1 không nhận cookie
      const rootHeader = jar.getCookieHeader('https://api.example.com/login');
      expect(rootHeader).toBe('');
    });

    it('xử lý max-age và expiration', () => {
      jar.setCookie('https://example.com', 'temp=val; Max-Age=0');
      const header = jar.getCookieHeader('https://example.com');
      expect(header).toBe('');
    });
  });

  describe('2. Extended Auth Protocols', () => {
    it('áp dụng OAuth2 với custom prefix và header', async () => {
      const headers: Record<string, string> = {};
      const url = new URL('https://api.example.com/data');
      await applyExtendedAuth(headers, url, 'GET', {
        type: 'oauth2',
        oauth2: {
          token: 'token_123',
          headerPrefix: 'Bearer',
          addTokenTo: 'header',
        },
      }, '', {}, {});

      expect(headers['Authorization']).toBe('Bearer token_123');
    });

    it('áp dụng OAuth2 vào query param', async () => {
      const headers: Record<string, string> = {};
      const url = new URL('https://api.example.com/data');
      await applyExtendedAuth(headers, url, 'GET', {
        type: 'oauth2',
        oauth2: {
          token: 'token_123',
          addTokenTo: 'query',
        },
      }, '', {}, {});

      expect(url.searchParams.get('access_token')).toBe('token_123');
    });

    it('áp dụng Digest Auth RFC 2617', async () => {
      const headers: Record<string, string> = {};
      const url = new URL('https://httpbin.org/digest-auth/auth/user/pass');
      await applyExtendedAuth(headers, url, 'GET', {
        type: 'digest',
        digest: {
          username: 'user',
          password: 'pass',
          realm: 'me@kennethreitz.com',
          nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
          qop: 'auth',
          algorithm: 'MD5',
        },
      }, '', {}, {});

      expect(headers['Authorization']).toContain('Digest username="user"');
      expect(headers['Authorization']).toContain('realm="me@kennethreitz.com"');
      expect(headers['Authorization']).toContain('response=');
    });

    it('áp dụng AWS SigV4 Auth', async () => {
      const headers: Record<string, string> = {};
      const url = new URL('https://s3.amazonaws.com/my-bucket/test.json');
      await applyExtendedAuth(headers, url, 'GET', {
        type: 'awsv4',
        awsv4: {
          accessKey: 'AKIAEXAMPLE',
          secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          region: 'us-east-1',
          service: 's3',
        },
      }, '', {}, {});

      expect(headers['Authorization']).toContain('AWS4-HMAC-SHA256');
      expect(headers['Authorization']).toContain('Credential=AKIAEXAMPLE');
      expect(headers['x-amz-date']).toBeDefined();
    });

    it('áp dụng NTLM Type-1 negotiate', async () => {
      const headers: Record<string, string> = {};
      const url = new URL('https://corp.local/api');
      await applyExtendedAuth(headers, url, 'GET', {
        type: 'ntlm',
        ntlm: {
          username: 'alice',
          domain: 'WORKGROUP',
        },
      }, '', {}, {});

      expect(headers['Authorization']).toContain('NTLM TlRMTVNTUAABAAA');
    });
  });

  describe('3. Response Diff Engine', () => {
    it('nhận diện sự khác biệt giữa hai văn bản', () => {
      const oldText = 'line1\nline2\nline3';
      const newText = 'line1\nline2_modified\nline3\nline4';
      const diff = computeDiff(oldText, newText);

      expect(diff.some((d) => d.type === 'removed' && d.line === 'line2')).toBe(true);
      expect(diff.some((d) => d.type === 'added' && d.line === 'line2_modified')).toBe(true);
      expect(diff.some((d) => d.type === 'added' && d.line === 'line4')).toBe(true);
    });

    it('format JSON đúng chuẩn để so sánh đẹp mắt', () => {
      const json = '{"b":2,"a":1}';
      const formatted = tryFormatJson(json);
      expect(formatted).toBe('{\n  "b": 2,\n  "a": 1\n}');
    });
  });

  describe('4. Contract Testing OpenAPI', () => {
    const mockSpec = {
      openapi: '3.0.0',
      paths: {
        '/users/{id}': {
          get: {
            summary: 'Get User By ID',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['id', 'email'],
                      properties: {
                        id: { type: 'integer' },
                        email: { type: 'string', format: 'email' },
                        name: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    it('khớp URL với OpenAPI path template', () => {
      const matched = matchOpenApiPath(mockSpec.paths, 'https://api.example.com/users/123');
      expect(matched).not.toBeNull();
      expect(matched?.pathPattern).toBe('/users/{id}');
    });

    it('xác thực response hợp lệ theo schema', () => {
      const validBody = JSON.stringify({ id: 123, email: 'test@example.com', name: 'John' });
      const result = validateResponseContract(mockSpec, 'GET', '/users/123', 200, validBody);
      expect(result.tested).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('phát hiện response vi phạm schema (thiếu required / sai type)', () => {
      const invalidBody = JSON.stringify({ id: 'abc', name: 'John' }); // thiếu email, id là string thay vì integer
      const result = validateResponseContract(mockSpec, 'GET', '/users/123', 200, invalidBody);
      expect(result.tested).toBe(true);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('trích xuất schema nhúng trong script của request', () => {
      const script = `pm.test("Status 200", () => {});\npm.response.to.have.jsonSchema({\n  "type": "array"\n});`;
      const schema = extractEmbeddedSchema(script);
      expect(schema).toEqual({ type: 'array' });
    });
  });
});
