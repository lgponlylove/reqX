import type { MockRule, MockLogItem, ApiResponse } from '../types/api';
import { uid } from './variables';

export function matchPath(pattern: string, actualPath: string): boolean {
  const normPat = pattern.trim().toLowerCase();
  const normPath = actualPath.trim().toLowerCase();

  if (normPat === '*' || normPat === '/*') return true;
  if (normPat === normPath) return true;

  // Wildcard match ví dụ: /api/users/* hoặc /api/*
  if (normPat.endsWith('*')) {
    const prefix = normPat.slice(0, -1);
    return normPath.startsWith(prefix);
  }

  // Path params match ví dụ: /api/users/:id
  if (normPat.includes(':')) {
    const patParts = normPat.split('/').filter(Boolean);
    const actParts = normPath.split('/').filter(Boolean);
    if (patParts.length !== actParts.length) return false;
    for (let i = 0; i < patParts.length; i++) {
      if (patParts[i].startsWith(':')) continue;
      if (patParts[i] !== actParts[i]) return false;
    }
    return true;
  }

  return false;
}

export function findMatchingRule(
  rules: MockRule[],
  method: string,
  urlStr: string
): MockRule | undefined {
  let pathname = urlStr;
  try {
    const u = new URL(urlStr, 'http://localhost');
    pathname = u.pathname;
  } catch {
    // fallback
  }

  const upperMethod = method.toUpperCase();
  return rules.find((r) => {
    if (!r.enabled) return false;
    if (r.method !== 'ALL' && r.method !== upperMethod) return false;
    return matchPath(r.path, pathname);
  });
}

export function executeMockResponse(
  rule: MockRule,
  method: string,
  urlStr: string,
  reqHeaders: Record<string, string>,
  reqBody: string
): { response: ApiResponse; logItem: MockLogItem } {
  const headers: Record<string, string> = {
    'x-powered-by': 'ReqX Mock Server',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': '*',
    'access-control-allow-headers': '*',
  };

  if (rule.responseBodyType === 'json') {
    headers['content-type'] = 'application/json; charset=utf-8';
  } else if (rule.responseBodyType === 'xml') {
    headers['content-type'] = 'application/xml; charset=utf-8';
  } else {
    headers['content-type'] = 'text/plain; charset=utf-8';
  }

  for (const h of rule.headers || []) {
    if (h.enabled && h.key.trim()) {
      headers[h.key.trim().toLowerCase()] = h.value;
    }
  }

  const body = rule.responseBody || '';
  const response: ApiResponse = {
    status: rule.statusCode || 200,
    statusText: getStatusText(rule.statusCode || 200),
    timeMs: rule.delayMs || 10,
    sizeBytes: new Blob([body]).size,
    headers,
    body,
    bodyKind: 'text',
  };

  const logItem: MockLogItem = {
    id: uid('mlog'),
    timestamp: Date.now(),
    method: method.toUpperCase(),
    url: urlStr,
    headers: reqHeaders,
    body: reqBody,
    matchedRuleId: rule.id,
    statusCode: response.status,
    responseBody: body,
    timeMs: response.timeMs,
  };

  return { response, logItem };
}

function getStatusText(code: number): string {
  const map: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  return map[code] || 'Mock Response';
}
