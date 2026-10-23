import { describe, it, expect } from 'vitest';
import { matchLocalDocsQuery } from '../local-docs-router';
import type { ApiRequest, Collection } from '../../../types/api';

describe('Local Docs Inspector Router', () => {
  const mockReq: ApiRequest = {
    id: 'req-login',
    name: 'Đăng nhập Auth',
    method: 'POST',
    url: 'https://api.example.com/v1/auth/login',
    headers: [{ id: 'h1', key: 'Content-Type', value: 'application/json', enabled: true }],
    params: [{ id: 'p1', key: 'redirect', value: 'dashboard', enabled: true }],
    bodyType: 'json',
    body: '{"username": "admin", "password": "123"}',
    auth: { type: 'none' },
    updatedAt: Date.now(),
    examples: [
      {
        id: 'exp-200',
        status: 200,
        statusText: 'OK',
        body: '{"token": "xyz123"}',
        savedAt: Date.now(),
      },
      {
        id: 'exp-400',
        status: 400,
        statusText: 'Bad Request',
        body: '{"error": "Wrong password"}',
        savedAt: Date.now(),
      },
    ],
  };

  const requests: Record<string, ApiRequest> = {
    [mockReq.id]: mockReq,
  };

  const collections: Collection[] = [
    {
      id: 'col-1',
      name: 'Authentication',
      folders: [],
      rootRequestIds: [mockReq.id],
    },
  ];

  it('matches body inspection query locally without calling LLM', () => {
    const res = matchLocalDocsQuery('Body của Đăng nhập Auth gồm những gì', requests, collections);
    expect(res.matched).toBe(true);
    expect(res.content).toContain('{"username": "admin", "password": "123"}');
    expect(res.requestId).toBe('req-login');
  });

  it('matches error responses inspection query locally', () => {
    const res = matchLocalDocsQuery('Mã lỗi của Đăng nhập Auth', requests, collections);
    expect(res.matched).toBe(true);
    expect(res.content).toContain('200 (OK)');
    expect(res.content).toContain('400 (Bad Request)');
    expect(res.content).toContain('Wrong password');
  });

  it('matches curl command request locally', () => {
    const res = matchLocalDocsQuery('Cho xin curl của Đăng nhập Auth', requests, collections);
    expect(res.matched).toBe(true);
    expect(res.content).toContain('curl');
    expect(res.content).toContain('https://api.example.com/v1/auth/login');
  });

  it('resolves pronouns using lastContextRequestId', () => {
    const res = matchLocalDocsQuery('Header của nó gồm gì', requests, collections, 'req-login');
    expect(res.matched).toBe(true);
    expect(res.content).toContain('Content-Type');
  });

  it('bypasses local router and falls back to LLM for coding/reasoning prompts', () => {
    const res1 = matchLocalDocsQuery('Viết script test status 200 cho Đăng nhập Auth', requests, collections);
    expect(res1.matched).toBe(false);

    const res2 = matchLocalDocsQuery('Tại sao Đăng nhập Auth bị lỗi', requests, collections);
    expect(res2.matched).toBe(false);

    const res3 = matchLocalDocsQuery('Tạo mock data cho Đăng nhập Auth', requests, collections);
    expect(res3.matched).toBe(false);
  });
});
