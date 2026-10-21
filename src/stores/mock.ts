import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MockRule, MockLogItem, KeyValue } from '../types/api';
import { uid } from '../lib/variables';

interface MockStore {
  isRunning: boolean;
  port: number;
  rules: MockRule[];
  logs: MockLogItem[];
  selectedRuleId: string | null;

  startServer: () => void;
  stopServer: () => void;
  setPort: (port: number) => void;
  setSelectedRuleId: (id: string | null) => void;

  addRule: (partial?: Partial<MockRule>) => string;
  updateRule: (id: string, patch: Partial<MockRule>) => void;
  deleteRule: (id: string) => void;
  toggleRule: (id: string) => void;
  addLog: (log: MockLogItem) => void;
  clearLogs: () => void;
  createRuleFromRequest: (req: { name: string; method: string; url: string; body?: string }) => string;
}

const DEFAULT_RULE: Omit<MockRule, 'id'> = {
  name: 'Get Users List',
  enabled: true,
  method: 'GET',
  path: '/api/users',
  statusCode: 200,
  delayMs: 20,
  headers: [{ id: uid('kv'), key: 'Content-Type', value: 'application/json', enabled: true }],
  responseBody: JSON.stringify(
    [
      { id: 1, name: 'Alice', email: 'alice@example.com', role: 'admin' },
      { id: 2, name: 'Bob', email: 'bob@example.com', role: 'user' },
      { id: 3, name: 'Charlie', email: 'charlie@example.com', role: 'user' },
    ],
    null,
    2
  ),
  responseBodyType: 'json',
};

export const useMockStore = create<MockStore>()(
  persist(
    (set, get) => ({
      isRunning: false,
      port: 3001,
      rules: [
        {
          ...DEFAULT_RULE,
          id: 'rule-demo-1',
        },
        {
          id: 'rule-demo-2',
          name: 'Create User',
          enabled: true,
          method: 'POST',
          path: '/api/users',
          statusCode: 201,
          delayMs: 50,
          headers: [{ id: uid('kv'), key: 'Content-Type', value: 'application/json', enabled: true }],
          responseBody: JSON.stringify({ message: 'User created successfully', id: 4, success: true }, null, 2),
          responseBodyType: 'json',
        },
        {
          id: 'rule-demo-3',
          name: 'Not Found Handler',
          enabled: true,
          method: 'ALL',
          path: '/api/*',
          statusCode: 404,
          delayMs: 10,
          headers: [{ id: uid('kv'), key: 'Content-Type', value: 'application/json', enabled: true }],
          responseBody: JSON.stringify({ error: 'Endpoint not found on ReqX Mock Server', code: 404 }, null, 2),
          responseBodyType: 'json',
        },
      ],
      logs: [],
      selectedRuleId: 'rule-demo-1',

      startServer: () => set({ isRunning: true }),
      stopServer: () => set({ isRunning: false }),
      setPort: (port) => set({ port: Math.max(1024, Math.min(65535, port)) }),
      setSelectedRuleId: (id) => set({ selectedRuleId: id }),

      addRule: (partial) => {
        const id = uid('mrule');
        const newRule: MockRule = {
          id,
          name: partial?.name || 'New Mock Endpoint',
          enabled: partial?.enabled ?? true,
          method: (partial?.method as any) || 'GET',
          path: partial?.path || '/api/example',
          statusCode: partial?.statusCode || 200,
          delayMs: partial?.delayMs || 0,
          headers: partial?.headers || [
            { id: uid('kv'), key: 'Content-Type', value: 'application/json', enabled: true },
          ],
          responseBody: partial?.responseBody || '{\n  "message": "Hello from mock server!"\n}',
          responseBodyType: partial?.responseBodyType || 'json',
        };
        set((s) => ({
          rules: [newRule, ...s.rules],
          selectedRuleId: id,
        }));
        return id;
      },

      updateRule: (id, patch) => {
        set((s) => ({
          rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        }));
      },

      deleteRule: (id) => {
        set((s) => {
          const rules = s.rules.filter((r) => r.id !== id);
          return {
            rules,
            selectedRuleId: s.selectedRuleId === id ? (rules[0]?.id || null) : s.selectedRuleId,
          };
        });
      },

      toggleRule: (id) => {
        set((s) => ({
          rules: s.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
        }));
      },

      addLog: (log) => {
        set((s) => ({
          logs: [log, ...s.logs].slice(0, 100),
        }));
      },

      clearLogs: () => set({ logs: [] }),

      createRuleFromRequest: (req) => {
        let pathname = '/api';
        try {
          const u = new URL(req.url, 'http://localhost');
          pathname = u.pathname;
        } catch {
          if (req.url.startsWith('/')) pathname = req.url;
        }

        const id = uid('mrule');
        const rule: MockRule = {
          id,
          name: `Mock - ${req.name || pathname}`,
          enabled: true,
          method: (req.method as any) || 'GET',
          path: pathname,
          statusCode: 200,
          delayMs: 30,
          headers: [{ id: uid('kv'), key: 'Content-Type', value: 'application/json', enabled: true }],
          responseBody: req.body && req.body.trim().startsWith('{')
            ? req.body
            : JSON.stringify({ message: `Mocked response for ${req.name}`, success: true }, null, 2),
          responseBodyType: 'json',
        };

        set((s) => ({
          rules: [rule, ...s.rules],
          selectedRuleId: id,
        }));
        return id;
      },
    }),
    {
      name: 'reqx-mock-store-v1',
      partialize: (s) => ({
        port: s.port,
        rules: s.rules,
        selectedRuleId: s.selectedRuleId,
      }),
    }
  )
);
