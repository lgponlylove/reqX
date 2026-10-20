import { describe, expect, it } from 'vitest';
import { diagnoseError } from '../diagnostics';
import type { ApiRequest, ApiResponse } from '../../types/api';
import { DEFAULT_REQUEST } from '../../types/api';

describe('Error Diagnostics and Smart Focus Engine', () => {
  it('phát hiện lỗi 401 với Header Authorization và chỉ đúng tab headers + fieldKey', () => {
    const req: ApiRequest = {
      ...DEFAULT_REQUEST,
      id: 'r1',
      updatedAt: Date.now(),
      headers: [
        { id: '1', key: 'accept', value: 'application/json', enabled: true },
        { id: '2', key: 'Authorization', value: 'Bearer 123456', enabled: true },
      ],
    };
    const res: ApiResponse = {
      status: 401,
      statusText: 'Unauthorized',
      timeMs: 200,
      sizeBytes: 100,
      headers: {},
      body: JSON.stringify({ error: true, statusCode: 'invalid_token', errorReason: 'Token not found' }),
    };

    const diag = diagnoseError(req, res, null);
    expect(diag).not.toBeNull();
    expect(diag?.subTab).toBe('headers');
    expect(diag?.fieldKey).toBe('authorization');
    expect(diag?.reason).toContain('Authorization');
  });

  it('phát hiện lỗi 401 với Auth cấu hình ở tab Auth', () => {
    const req: ApiRequest = {
      ...DEFAULT_REQUEST,
      id: 'r2',
      updatedAt: Date.now(),
      auth: { type: 'bearer', token: 'expired-token' },
    };
    const res: ApiResponse = {
      status: 401,
      statusText: 'Unauthorized',
      timeMs: 150,
      sizeBytes: 50,
      headers: {},
      body: 'Unauthorized',
    };

    const diag = diagnoseError(req, res, null);
    expect(diag).not.toBeNull();
    expect(diag?.subTab).toBe('auth');
    expect(diag?.suggestion).toContain('Token');
  });

  it('phát hiện lỗi 415 Unsupported Media Type và điều hướng tới header Content-Type', () => {
    const req: ApiRequest = {
      ...DEFAULT_REQUEST,
      id: 'r3',
      updatedAt: Date.now(),
      method: 'POST',
      headers: [{ id: '1', key: 'Content-Type', value: 'text/plain', enabled: true }],
    };
    const res: ApiResponse = {
      status: 415,
      statusText: 'Unsupported Media Type',
      timeMs: 100,
      sizeBytes: 80,
      headers: {},
      body: 'Unsupported Media Type',
    };

    const diag = diagnoseError(req, res, null);
    expect(diag).not.toBeNull();
    expect(diag?.subTab).toBe('headers');
    expect(diag?.fieldKey).toBe('content-type');
  });

  it('phát hiện lỗi 400 và trích xuất đúng trường param bị lỗi', () => {
    const req: ApiRequest = {
      ...DEFAULT_REQUEST,
      id: 'r4',
      updatedAt: Date.now(),
      params: [{ id: '1', key: 'receiptactual', value: 'abc', enabled: true }],
    };
    const res: ApiResponse = {
      status: 400,
      statusText: 'Bad Request',
      timeMs: 100,
      sizeBytes: 120,
      headers: {},
      body: JSON.stringify({ message: 'receiptactual must be an integer' }),
    };

    const diag = diagnoseError(req, res, null);
    expect(diag).not.toBeNull();
    expect(diag?.subTab).toBe('params');
    expect(diag?.fieldKey).toBe('receiptactual');
  });

  it('trả về null khi response 200 OK', () => {
    const req: ApiRequest = {
      ...DEFAULT_REQUEST,
      id: 'r5',
      updatedAt: Date.now(),
    };
    const res: ApiResponse = {
      status: 200,
      statusText: 'OK',
      timeMs: 50,
      sizeBytes: 10,
      headers: {},
      body: '{"ok":true}',
    };

    expect(diagnoseError(req, res, null)).toBeNull();
  });
});
