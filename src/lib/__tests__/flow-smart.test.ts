import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateCondition, runFlow } from '../flow';
import type { Flow, ApiRequest, StepCondition } from '../../types/api';
import * as runnerModule from '../runner';

vi.mock('../runner', async () => {
  const actual = await vi.importActual<typeof runnerModule>('../runner');
  return {
    ...actual,
    runOneRequest: vi.fn(),
  };
});

describe('Smart Flow - evaluateCondition', () => {
  const vars: Record<string, string> = {
    env: 'production',
    count: '42',
    token: 'jwt-abc-123',
    emptyVar: '',
  };

  it('evaluates equality == and inequality !=', () => {
    const condEq: StepCondition = {
      enabled: true,
      varName: 'env',
      operator: '==',
      value: 'production',
      onFalse: 'skip',
    };
    expect(evaluateCondition(condEq, vars)).toBe(true);

    const condEqFalse: StepCondition = {
      ...condEq,
      value: 'staging',
    };
    expect(evaluateCondition(condEqFalse, vars)).toBe(false);

    const condNeq: StepCondition = {
      ...condEq,
      operator: '!=',
      value: 'staging',
    };
    expect(evaluateCondition(condNeq, vars)).toBe(true);
  });

  it('evaluates contains', () => {
    const cond: StepCondition = {
      enabled: true,
      varName: 'token',
      operator: 'contains',
      value: 'abc',
      onFalse: 'skip',
    };
    expect(evaluateCondition(cond, vars)).toBe(true);

    expect(evaluateCondition({ ...cond, value: 'xyz' }, vars)).toBe(false);
  });

  it('evaluates numeric comparisons > and <', () => {
    const condGt: StepCondition = {
      enabled: true,
      varName: 'count',
      operator: '>',
      value: '10',
      onFalse: 'skip',
    };
    expect(evaluateCondition(condGt, vars)).toBe(true);

    const condLt: StepCondition = {
      enabled: true,
      varName: 'count',
      operator: '<',
      value: '10',
      onFalse: 'skip',
    };
    expect(evaluateCondition(condLt, vars)).toBe(false);
  });

  it('evaluates exists and empty', () => {
    expect(evaluateCondition({
      enabled: true,
      varName: 'token',
      operator: 'exists',
      value: '',
      onFalse: 'skip',
    }, vars)).toBe(true);

    expect(evaluateCondition({
      enabled: true,
      varName: 'nonExistent',
      operator: 'exists',
      value: '',
      onFalse: 'skip',
    }, vars)).toBe(false);

    expect(evaluateCondition({
      enabled: true,
      varName: 'emptyVar',
      operator: 'empty',
      value: '',
      onFalse: 'skip',
    }, vars)).toBe(true);

    expect(evaluateCondition({
      enabled: true,
      varName: 'token',
      operator: 'empty',
      value: '',
      onFalse: 'skip',
    }, vars)).toBe(false);
  });

  it('returns true when condition is disabled', () => {
    expect(evaluateCondition({
      enabled: false,
      varName: 'env',
      operator: '==',
      value: 'dev',
      onFalse: 'skip',
    }, vars)).toBe(true);
  });
});

describe('Smart Flow - Execution branching, retry and timeline', () => {
  const mockReq1: ApiRequest = {
    id: 'req-1',
    name: 'Step 1 - Login',
    method: 'POST',
    url: 'https://api.example.com/login',
    headers: [],
    params: [],
    bodyType: 'none',
    body: '',
    auth: { type: 'none' },
    collectionId: 'c1',
    updatedAt: Date.now(),
  };

  const mockReq2: ApiRequest = {
    id: 'req-2',
    name: 'Step 2 - Get Profile',
    method: 'GET',
    url: 'https://api.example.com/profile',
    headers: [],
    params: [],
    bodyType: 'none',
    body: '',
    auth: { type: 'none' },
    collectionId: 'c1',
    updatedAt: Date.now(),
  };

  const mockReq3: ApiRequest = {
    id: 'req-3',
    name: 'Step 3 - Final Step',
    method: 'GET',
    url: 'https://api.example.com/finish',
    headers: [],
    params: [],
    bodyType: 'none',
    body: '',
    auth: { type: 'none' },
    collectionId: 'c1',
    updatedAt: Date.now(),
  };

  const requests: Record<string, ApiRequest> = {
    'req-1': mockReq1,
    'req-2': mockReq2,
    'req-3': mockReq3,
  };

  const defaultOpts = {
    timeoutMs: 5000,
    delayMs: 0,
    stopOnError: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips step when condition evaluates to false with onFalse: skip', async () => {
    const flow: Flow = {
      id: 'f-branch',
      name: 'Flow Skip Test',
      createdAt: Date.now(),
      steps: [
        {
          id: 's-1',
          collectionId: 'c1',
          requestId: 'req-1',
          extract: [],
          condition: {
            enabled: true,
            varName: 'role',
            operator: '==',
            value: 'admin',
            onFalse: 'skip',
          },
        },
        {
          id: 's-2',
          collectionId: 'c1',
          requestId: 'req-2',
          extract: [],
        },
      ],
    };

    vi.mocked(runnerModule.runOneRequest).mockResolvedValue({
      requestId: 'req-2',
      name: 'Step 2 - Get Profile',
      method: 'GET',
      url: 'https://api.example.com/profile',
      ok: true,
      status: 200,
      timeMs: 15,
      testsPassed: 1,
      testsTotal: 1,
      logs: [],
      response: { status: 200, headers: {}, body: '{"user":"john"}' },
    });

    const baseHooks = {
      getVars: () => ({ envVars: { role: 'guest' }, globals: {} }),
      setGlobal: vi.fn(),
    };

    const res = await runFlow(flow, requests, baseHooks, defaultOpts);

    // Step 1 should be skipped because role != admin
    expect(res.results).toHaveLength(2);
    expect(res.results[0].skipped).toBe(true);
    expect(res.results[0].skipReason).toContain('role');
    // Step 2 should be executed normally
    expect(res.results[1].skipped).toBeFalsy();
    expect(res.results[1].ok).toBe(true);
    expect(runnerModule.runOneRequest).toHaveBeenCalledTimes(1);
  });

  it('jumps to target step when condition is false with onFalse: jump', async () => {
    const flow: Flow = {
      id: 'f-jump',
      name: 'Flow Jump Test',
      createdAt: Date.now(),
      steps: [
        {
          id: 's-1',
          collectionId: 'c1',
          requestId: 'req-1',
          extract: [],
          condition: {
            enabled: true,
            varName: 'hasSession',
            operator: '==',
            value: 'true',
            onFalse: 'jump',
            jumpStepId: 's-3',
          },
        },
        {
          id: 's-2',
          collectionId: 'c1',
          requestId: 'req-2',
          extract: [],
        },
        {
          id: 's-3',
          collectionId: 'c1',
          requestId: 'req-3',
          extract: [],
        },
      ],
    };

    vi.mocked(runnerModule.runOneRequest).mockResolvedValue({
      requestId: 'req-3',
      name: 'Step 3 - Final Step',
      method: 'GET',
      url: 'https://api.example.com/finish',
      ok: true,
      status: 200,
      timeMs: 10,
      testsPassed: 1,
      testsTotal: 1,
      logs: [],
      response: { status: 200, headers: {}, body: '{"ok":true}' },
    });

    const baseHooks = {
      getVars: () => ({ envVars: { hasSession: 'false' }, globals: {} }),
      setGlobal: vi.fn(),
    };

    const res = await runFlow(flow, requests, baseHooks, defaultOpts);

    // Step 1 jumps directly to Step 3, skipping Step 2 completely
    expect(res.results).toHaveLength(2);
    expect(res.results[0].stepId).toBe('s-1');
    expect(res.results[0].skipped).toBe(true);
    expect(res.results[1].stepId).toBe('s-3');
    expect(res.results[1].ok).toBe(true);
  });

  it('retries on failure according to retry config', async () => {
    const flow: Flow = {
      id: 'f-retry',
      name: 'Flow Retry Test',
      createdAt: Date.now(),
      steps: [
        {
          id: 's-1',
          collectionId: 'c1',
          requestId: 'req-1',
          extract: [],
          retry: {
            enabled: true,
            maxAttempts: 3,
            delayMs: 10,
          },
        },
      ],
    };

    let callCount = 0;
    vi.mocked(runnerModule.runOneRequest).mockImplementation(async () => {
      callCount++;
      if (callCount < 2) {
        return {
          requestId: 'req-1',
          name: 'Step 1 - Login',
          method: 'POST',
          url: 'https://api.example.com/login',
          ok: false,
          status: 503,
          error: 'Service Unavailable',
          timeMs: 20,
          testsPassed: 0,
          testsTotal: 1,
          logs: [],
        };
      }
      return {
        requestId: 'req-1',
        name: 'Step 1 - Login',
        method: 'POST',
        url: 'https://api.example.com/login',
        ok: true,
        status: 200,
        timeMs: 20,
        testsPassed: 1,
        testsTotal: 1,
        logs: [],
        response: { status: 200, headers: {}, body: '{"status":"ok"}' },
      };
    });

    const baseHooks = {
      getVars: () => ({ envVars: {}, globals: {} }),
      setGlobal: vi.fn(),
    };

    const res = await runFlow(flow, requests, baseHooks, defaultOpts);

    expect(callCount).toBe(2);
    expect(res.results[0].ok).toBe(true);
    expect(res.results[0].attempts).toBe(2);
    expect(res.results[0].retryHistory).toHaveLength(2);
    expect(res.results[0].retryHistory?.[0].attempt).toBe(1);
    expect(res.results[0].retryHistory?.[0].status).toBe(503);
    expect(res.results[0].retryHistory?.[1].attempt).toBe(2);
    expect(res.results[0].retryHistory?.[1].status).toBe(200);
  });

  it('records timeline offsets (startTimeMs, endTimeMs)', async () => {
    const flow: Flow = {
      id: 'f-timeline',
      name: 'Flow Timeline Test',
      createdAt: Date.now(),
      steps: [
        {
          id: 's-1',
          collectionId: 'c1',
          requestId: 'req-1',
          extract: [],
        },
        {
          id: 's-2',
          collectionId: 'c1',
          requestId: 'req-2',
          extract: [],
        },
      ],
    };

    vi.mocked(runnerModule.runOneRequest).mockResolvedValue({
      requestId: 'req-1',
      name: 'Step 1 - Login',
      method: 'POST',
      url: 'https://api.example.com/login',
      ok: true,
      status: 200,
      timeMs: 25,
      testsPassed: 1,
      testsTotal: 1,
      logs: [],
      response: { status: 200, headers: {}, body: '{"ok":true}' },
    });

    const baseHooks = {
      getVars: () => ({ envVars: {}, globals: {} }),
      setGlobal: vi.fn(),
    };

    const res = await runFlow(flow, requests, baseHooks, defaultOpts);

    expect(res.results).toHaveLength(2);
    for (const r of res.results) {
      expect(typeof r.startTimeMs).toBe('number');
      expect(typeof r.endTimeMs).toBe('number');
      expect(r.endTimeMs!).toBeGreaterThanOrEqual(r.startTimeMs!);
    }
  });

  it('supports post-step branching with onSuccessJump', async () => {
    const flow: Flow = {
      id: 'f-post-jump',
      name: 'Flow Post Jump Test',
      createdAt: Date.now(),
      steps: [
        {
          id: 's-1',
          collectionId: 'c1',
          requestId: 'req-1',
          extract: [],
          onSuccessJump: 's-3', // Jump straight to 3 if 1 succeeds
        },
        {
          id: 's-2',
          collectionId: 'c1',
          requestId: 'req-2',
          extract: [],
        },
        {
          id: 's-3',
          collectionId: 'c1',
          requestId: 'req-3',
          extract: [],
        },
      ],
    };

    vi.mocked(runnerModule.runOneRequest).mockResolvedValue({
      requestId: 'req-1',
      name: 'Step 1 - Login',
      method: 'POST',
      url: 'https://api.example.com/login',
      ok: true,
      status: 200,
      timeMs: 10,
      testsPassed: 1,
      testsTotal: 1,
      logs: [],
      response: { status: 200, headers: {}, body: '{"ok":true}' },
    });

    const baseHooks = {
      getVars: () => ({ envVars: {}, globals: {} }),
      setGlobal: vi.fn(),
    };

    const res = await runFlow(flow, requests, baseHooks, defaultOpts);

    expect(res.results).toHaveLength(2);
    expect(res.results[0].stepId).toBe('s-1');
    expect(res.results[1].stepId).toBe('s-3');
  });
});
