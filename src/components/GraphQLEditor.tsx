import { useState } from 'react';
import { prettifyGraphQL } from '../lib/graphql-utils';
import { formatJsonBody, JsonHint } from './RequestTabs';

interface Props {
  query: string;
  variables: string;
  onChange: (query: string, variables: string) => void;
}

export default function GraphQLEditor({ query, variables, onChange }: Props) {
  const [subTab, setSubTab] = useState<'query' | 'variables'>('query');
  const [fmtErr, setFmtErr] = useState('');

  function handlePrettifyQuery() {
    const prettified = prettifyGraphQL(query);
    onChange(prettified, variables);
    setFmtErr('');
  }

  function handleFormatVariables() {
    const res = formatJsonBody(variables, 'JSON Variables không hợp lệ');
    if (res.ok) {
      onChange(query, res.value);
      setFmtErr('');
    } else {
      setFmtErr(res.error);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-slate-950/30 border border-slate-800 rounded-lg overflow-hidden">
      {/* Thanh sub-tab: Query & GraphQL Variables */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('query')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
              subTab === 'query'
                ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            Query
          </button>
          <button
            type="button"
            onClick={() => setSubTab('variables')}
            className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              subTab === 'variables'
                ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <span>GraphQL Variables</span>
            {variables && variables.trim() && variables.trim() !== '{}' && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            )}
          </button>
        </div>

        {/* Nút hành động tương ứng từng tab */}
        <div className="flex items-center gap-2">
          {subTab === 'query' ? (
            <button
              type="button"
              onClick={handlePrettifyQuery}
              className="px-2.5 py-1 rounded text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-1 transition-colors"
              title="Căn chỉnh thụt đầu dòng cú pháp GraphQL"
            >
              <span>✨</span> Prettify
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFormatVariables}
              className="px-2.5 py-1 rounded text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-1 transition-colors"
              title="Định dạng thụt lề chuẩn JSON"
            >
              <span>{ }</span> Format JSON
            </button>
          )}
        </div>
      </div>

      {/* Editor Content */}
      <div className="flex flex-col flex-1 min-h-0 p-2.5">
        {subTab === 'query' ? (
          <div className="flex flex-col flex-1 min-h-0">
            <textarea
              spellCheck={false}
              value={query}
              onChange={(e) => onChange(e.target.value, variables)}
              placeholder={`query GetUser($id: ID!) {\n  user(id: $id) {\n    id\n    name\n    email\n  }\n}`}
              className="w-full flex-1 min-h-[160px] bg-slate-900 border border-slate-700/80 rounded p-3 font-mono text-xs text-slate-200 resize-none outline-none focus:border-emerald-500 leading-relaxed"
            />
            <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1.5 px-1">
              <span>Hỗ trợ truy vấn GraphQL (query, mutation, subscription) và biến template <code className="text-slate-400">{'{{variable}}'}</code></span>
              <span className="text-slate-500">Content-Type: application/json</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <textarea
              spellCheck={false}
              value={variables}
              onChange={(e) => onChange(query, e.target.value)}
              placeholder={`{\n  "id": "1",\n  "status": "active"\n}`}
              className="w-full flex-1 min-h-[160px] bg-slate-900 border border-slate-700/80 rounded p-3 font-mono text-xs text-emerald-300 resize-none outline-none focus:border-emerald-500 leading-relaxed"
            />
            {variables.trim() !== '' && (
              <div className="mt-1.5">
                <JsonHint body={variables} validMsg="Variables JSON hợp lệ" invalidMsg="Variables JSON không hợp lệ" />
              </div>
            )}
            {fmtErr && <p className="text-xs text-red-400 mt-1">{fmtErr}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
