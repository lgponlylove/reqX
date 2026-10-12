import { describe, it, expect } from 'vitest';
import { matchPath, findMatchingRule, executeMockResponse } from '../mockServerEngine';
import type { MockRule } from '../../types/api';

describe('mockServerEngine', () => {
  it('matchPath: so khớp chính xác và wildcard', () => {
    expect(matchPath('/api/users', '/api/users')).toBe(true);
    expect(matchPath('/api/users', '/api/posts')).toBe(false);
    expect(matchPath('/api/*', '/api/users')).toBe(true);
    expect(matchPath('/api/*', '/api/users/123')).toBe(true);
    expect(matchPath('*', '/anything')).toBe(true);
  });

  it('matchPath: so khớp path params :id', () => {
    expect(matchPath('/api/users/:id', '/api/users/123')).toBe(true);
    expect(matchPath('/api/users/:id', '/api/users/abc')).toBe(true);
    expect(matchPath('/api/users/:id', '/api/users')).toBe(false);
  });

  it('findMatchingRule: tìm đúng rule theo method và path', () => {
    const rules: MockRule[] = [
      {
        id: 'r1',
        name: 'Get Users',
        enabled: true,
        method: 'GET',
        path: '/api/users',
        statusCode: 200,
        headers: [],
        responseBody: '[]',
        responseBodyType: 'json',
      },
      {
        id: 'r2',
        name: 'Create User',
        enabled: true,
        method: 'POST',
        path: '/api/users',
        statusCode: 201,
        headers: [],
        responseBody: '{"ok":true}',
        responseBodyType: 'json',
      },
    ];

    expect(findMatchingRule(rules, 'GET', 'http://localhost:3001/api/users')?.id).toBe('r1');
    expect(findMatchingRule(rules, 'POST', 'http://localhost:3001/api/users')?.id).toBe('r2');
    expect(findMatchingRule(rules, 'DELETE', 'http://localhost:3001/api/users')).toBeUndefined();
  });

  it('executeMockResponse: sinh response và logItem chuẩn xác', () => {
    const rule: MockRule = {
      id: 'r1',
      name: 'Test Rule',
      enabled: true,
      method: 'GET',
      path: '/test',
      statusCode: 200,
      delayMs: 15,
      headers: [{ id: 'h1', key: 'X-App', value: 'ReqX', enabled: true }],
      responseBody: '{"data":"mock"}',
      responseBodyType: 'json',
    };

    const { response, logItem } = executeMockResponse(rule, 'GET', 'http://localhost:3001/test', {}, '');
    expect(response.status).toBe(200);
    expect(response.headers['x-app']).toBe('ReqX');
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).toBe('{"data":"mock"}');
    expect(logItem.statusCode).toBe(200);
    expect(logItem.matchedRuleId).toBe('r1');
  });
});
