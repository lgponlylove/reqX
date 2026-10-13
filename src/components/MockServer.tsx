import { useState } from 'react';
import { useMockStore } from '../stores/mock';
import { useTranslation } from '../stores/language';
import type { MockRule, HttpMethod } from '../types/api';
import KeyValueEditor from './KeyValueEditor';

const METHODS: (HttpMethod | 'ALL')[] = ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const METHOD_COLOR: Record<string, string> = {
  ALL: 'text-purple-400 border-purple-500/30 bg-purple-500/10',
  GET: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  POST: 'text-sky-400 border-sky-500/30 bg-sky-500/10',
  PUT: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  PATCH: 'text-violet-400 border-violet-500/30 bg-violet-500/10',
  DELETE: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
};

export default function MockServer() {
  const {
    isRunning,
    port,
    rules,
    logs,
    selectedRuleId,
    startServer,
    stopServer,
    setPort,
    setSelectedRuleId,
    addRule,
    updateRule,
    deleteRule,
    toggleRule,
    clearLogs,
  } = useMockStore();

  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'rules' | 'logs'>('rules');
  const [filter, setFilter] = useState('');
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  const selectedRule = rules.find((r) => r.id === selectedRuleId) || rules[0];
  const selectedLog = logs.find((l) => l.id === selectedLogId) || logs[0];

  const filteredRules = rules.filter(
    (r) =>
      r.name.toLowerCase().includes(filter.toLowerCase()) ||
      r.path.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Banner Control Bar */}
      <div className="p-3 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎭</span>
            <div>
              <h2 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                {t.mock.title}
                {isRunning ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> {t.mock.running}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                    {t.mock.stopped}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                {t.mock.baseUrl} <code className="text-emerald-400 font-mono">http://localhost:{port}</code>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded border border-slate-800 text-xs">
            <span className="text-slate-400">{t.mock.port}</span>
            <input
              type="number"
              disabled={isRunning}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className="w-16 bg-transparent text-emerald-300 font-mono font-bold outline-none disabled:opacity-60"
            />
          </div>

          {isRunning ? (
            <button
              onClick={stopServer}
              className="px-3.5 py-1.5 rounded text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow flex items-center gap-1.5"
            >
              <span>⏹</span> {t.mock.stopServer}
            </button>
          ) : (
            <button
              onClick={startServer}
              className="px-3.5 py-1.5 rounded text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow flex items-center gap-1.5"
            >
              <span>▶</span> {t.mock.startServer}
            </button>
          )}

          <div className="h-4 w-[1px] bg-slate-800 mx-1" />

          <div className="flex rounded bg-slate-900 border border-slate-800 p-0.5 text-xs">
            <button
              onClick={() => setActiveTab('rules')}
              className={`px-3 py-1 rounded font-medium ${
                activeTab === 'rules' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.mock.rulesTab.replace('{count}', String(rules.length))}
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-3 py-1 rounded font-medium flex items-center gap-1 ${
                activeTab === 'logs' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.mock.logsTab.replace('{count}', String(logs.length))}
              {logs.length > 0 && <span className="w-2 h-2 rounded-full bg-emerald-400" />}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Body */}
      {activeTab === 'rules' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Rules List */}
          <div className="w-80 border-r border-slate-800 flex flex-col bg-slate-900/30">
            <div className="p-2 border-b border-slate-800 flex items-center gap-2">
              <input
                type="text"
                placeholder={t.mock.filterRules}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-emerald-600"
              />
              <button
                onClick={() => addRule()}
                className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-xs text-white font-bold shrink-0"
                title={t.mock.addRule}
              >
                {t.common.add}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-850">
              {filteredRules.map((r) => {
                const isSelected = selectedRule?.id === r.id;
                return (
                  <div
                    key={r.id}
                    onClick={() => setSelectedRuleId(r.id)}
                    className={`p-2.5 cursor-pointer text-xs flex flex-col gap-1 transition-colors ${
                      isSelected
                        ? 'bg-slate-800/90 border-l-2 border-emerald-500'
                        : 'hover:bg-slate-850/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-slate-200 truncate flex-1">{r.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRule(r.id);
                        }}
                        title={r.enabled ? 'Đang bật — bấm để tắt' : 'Đang tắt — bấm để bật'}
                        className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] ${
                          r.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        {r.enabled ? '✓' : '✕'}
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 font-mono">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                          METHOD_COLOR[r.method] || 'text-slate-400 border-slate-700'
                        }`}
                      >
                        {r.method}
                      </span>
                      <span className="text-slate-400 truncate flex-1">{r.path}</span>
                      <span
                        className={`text-[10px] font-bold ${
                          r.statusCode < 300
                            ? 'text-emerald-400'
                            : r.statusCode < 400
                            ? 'text-sky-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {r.statusCode}
                      </span>
                    </div>
                  </div>
                );
              })}

              {filteredRules.length === 0 && (
                <div className="p-6 text-center text-xs text-slate-500">{t.mock.noRules}</div>
              )}
            </div>
          </div>

          {/* Right Column: Rule Editor */}
          {selectedRule ? (
            <div className="flex-1 flex flex-col overflow-y-auto p-4 gap-4 bg-slate-950">
              <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={selectedRule.name}
                    onChange={(e) => updateRule(selectedRule.id, { name: e.target.value })}
                    className="font-bold text-base bg-transparent border-b border-transparent hover:border-slate-700 focus:border-emerald-600 outline-none text-slate-100 flex-1 px-1 py-0.5"
                    placeholder={t.mock.ruleName}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (confirm(t.mock.deleteRuleConfirm)) deleteRule(selectedRule.id);
                    }}
                    className="px-2.5 py-1 rounded text-xs bg-rose-950/40 text-rose-400 border border-rose-850 hover:bg-rose-900/60"
                  >
                    {t.mock.deleteThisRule}
                  </button>
                </div>
              </div>

              {/* Endpoint Match Settings */}
              <div className="grid grid-cols-4 gap-3 bg-slate-900/40 p-3 rounded-lg border border-slate-800 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">{t.request.method}:</label>
                  <select
                    value={selectedRule.method}
                    onChange={(e) => updateRule(selectedRule.id, { method: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 font-mono text-slate-200 outline-none focus:border-emerald-600"
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="text-slate-400 block mb-1">
                    {t.mock.path} <span className="text-slate-500">— /api/:id | /api/*</span>
                  </label>
                  <input
                    type="text"
                    value={selectedRule.path}
                    onChange={(e) => updateRule(selectedRule.id, { path: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-emerald-400 outline-none focus:border-emerald-600"
                    placeholder="/api/example"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">{t.mock.statusCode}:</label>
                  <input
                    type="number"
                    value={selectedRule.statusCode}
                    onChange={(e) => updateRule(selectedRule.id, { statusCode: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-amber-400 font-bold outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">{t.mock.delayMs}:</label>
                  <input
                    type="number"
                    value={selectedRule.delayMs || 0}
                    onChange={(e) => updateRule(selectedRule.id, { delayMs: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-slate-300 outline-none"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">{t.mock.bodyType}</label>
                  <select
                    value={selectedRule.responseBodyType}
                    onChange={(e) => updateRule(selectedRule.id, { responseBodyType: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-300 outline-none"
                  >
                    <option value="json">JSON</option>
                    <option value="text">Plain Text</option>
                    <option value="xml">XML / HTML</option>
                  </select>
                </div>

                <div className="col-span-2 flex items-end pb-1.5">
                  <span className="text-slate-400 text-[11px]">
                    {t.mock.directTestUrl}{' '}
                    <code className="text-sky-300">
                      http://localhost:{port}
                      {selectedRule.path.startsWith('/') ? selectedRule.path : '/' + selectedRule.path}
                    </code>
                  </span>
                </div>
              </div>

              {/* Custom Response Headers */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-1.5">{t.mock.customHeaders}</h4>
                <KeyValueEditor
                  items={selectedRule.headers || []}
                  onChange={(headers) => updateRule(selectedRule.id, { headers })}
                  keyPlaceholder="Header (e.g. X-Custom-Header)"
                  valuePlaceholder="Value"
                />
              </div>

              {/* Response Body Editor */}
              <div className="flex-1 flex flex-col min-h-[220px]">
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="text-xs font-semibold text-slate-300">{t.mock.responseBody}:</h4>
                  {selectedRule.responseBodyType === 'json' && (
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(selectedRule.responseBody);
                          updateRule(selectedRule.id, { responseBody: JSON.stringify(parsed, null, 2) });
                        } catch {
                          // ignore
                        }
                      }}
                      className="text-[11px] text-slate-400 hover:text-emerald-300 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded"
                    >
                      {t.mock.formatJson}
                    </button>
                  )}
                </div>
                <textarea
                  value={selectedRule.responseBody}
                  onChange={(e) => updateRule(selectedRule.id, { responseBody: e.target.value })}
                  rows={10}
                  spellCheck={false}
                  className="w-full flex-1 bg-slate-950 border border-slate-800 focus:border-emerald-600 rounded p-3 font-mono text-xs text-slate-200 outline-none resize-y min-h-[180px]"
                  placeholder='{\n  "status": "success",\n  "data": []\n}'
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              {t.mock.selectRuleHint}
            </div>
          )}
        </div>
      ) : (
        /* Logs Viewer Tab */
        <div className="flex-1 flex overflow-hidden">
          <div className="w-96 border-r border-slate-800 flex flex-col bg-slate-900/30">
            <div className="p-2 border-b border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400">{t.mock.recentCalls}</span>
              <button
                onClick={clearLogs}
                disabled={logs.length === 0}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
              >
                {t.mock.clearLogs}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-850">
              {logs.map((log) => {
                const isSelected = selectedLog?.id === log.id;
                const d = new Date(log.timestamp);
                const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d
                  .getMinutes()
                  .toString()
                  .padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
                return (
                  <div
                    key={log.id}
                    onClick={() => setSelectedLogId(log.id)}
                    className={`p-2.5 cursor-pointer text-xs flex flex-col gap-1 ${
                      isSelected ? 'bg-slate-800 border-l-2 border-emerald-500' : 'hover:bg-slate-850/50'
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="text-slate-500">{timeStr}</span>
                      <span className="text-slate-400 font-bold">{log.timeMs}ms</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-mono">
                      <span
                        className={`px-1 rounded text-[10px] font-bold border ${
                          METHOD_COLOR[log.method] || 'text-slate-400 border-slate-700'
                        }`}
                      >
                        {log.method}
                      </span>
                      <span className="text-slate-300 truncate flex-1">{log.url}</span>
                      <span
                        className={`text-[10px] font-bold ${
                          log.statusCode < 300 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {log.statusCode}
                      </span>
                    </div>
                  </div>
                );
              })}

              {logs.length === 0 && (
                <div className="p-8 text-center text-xs text-slate-500">
                  {t.mock.emptyLogs}
                </div>
              )}
            </div>
          </div>

          {/* Log Details */}
          {selectedLog ? (
            <div className="flex-1 flex flex-col p-4 overflow-y-auto gap-4 bg-slate-950 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div>
                  <h3 className="font-bold text-sm text-slate-200 font-mono">
                    {selectedLog.method} {selectedLog.url}
                  </h3>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    {t.mock.time} {new Date(selectedLog.timestamp).toLocaleString()} • {t.mock.returnedAfter} {selectedLog.timeMs}ms
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`text-base font-bold font-mono ${
                      selectedLog.statusCode < 300 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    HTTP {selectedLog.statusCode}
                  </span>
                </div>
              </div>

              {selectedLog.body && (
                <div>
                  <h4 className="font-semibold text-slate-400 mb-1">{t.mock.receivedRequestBody}</h4>
                  <pre className="p-2.5 rounded bg-slate-900 border border-slate-800 font-mono text-slate-300 overflow-x-auto max-h-40">
                    {selectedLog.body}
                  </pre>
                </div>
              )}

              <div className="flex-1 flex flex-col">
                <h4 className="font-semibold text-slate-400 mb-1">{t.mock.sentMockResponse}</h4>
                <pre className="flex-1 p-2.5 rounded bg-slate-900 border border-slate-800 font-mono text-emerald-300 overflow-x-auto min-h-[140px]">
                  {selectedLog.responseBody}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
              {t.mock.selectLogHint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
