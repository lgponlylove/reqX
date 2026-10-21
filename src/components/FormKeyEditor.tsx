import { useState, useMemo, useRef } from 'react';
import { uid } from '../lib/variables';
import VarHighlightInput from './VarHighlightInput';
import { useAppStore } from '../stores/app';

export interface FormItem {
  id: string;
  key: string;
  value: string;
  type: 'text' | 'file';
  enabled: boolean;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  isFormData?: boolean;
}

/** Chuyển text thô nhiều dòng thành mảng FormItem */
function parseLinesToItems(raw: string, isFormData: boolean): FormItem[] {
  const lines = raw.split('\n');
  const items: FormItem[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const enabled = !trimmed.startsWith('#');
    const clean = enabled ? trimmed : trimmed.slice(1).trim();
    if (!clean.includes('=')) {
      items.push({
        id: uid('fitem'),
        key: clean,
        value: '',
        type: 'text',
        enabled,
      });
      continue;
    }

    const eq = clean.indexOf('=');
    const key = clean.slice(0, eq).trim();
    let val = clean.slice(eq + 1).trim();
    let type: 'text' | 'file' = 'text';

    if (isFormData && val.startsWith('@')) {
      type = 'file';
      val = val.slice(1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
    }

    items.push({
      id: uid('fitem'),
      key,
      value: val,
      type,
      enabled,
    });
  }

  return items;
}

/** Chuyển mảng FormItem thành text thô */
function serializeItemsToText(items: FormItem[], isFormData: boolean): string {
  return items
    .filter((item) => item.key.trim() !== '' || item.value.trim() !== '')
    .map((item) => {
      const prefix = item.enabled ? '' : '#';
      if (isFormData && item.type === 'file') {
        const path = item.value.trim();
        return `${prefix}${item.key}=@"${path}"`;
      }
      return `${prefix}${item.key}=${item.value}`;
    })
    .join('\n');
}

export default function FormKeyEditor({ value, onChange, isFormData = false }: Props) {
  const [bulkMode, setBulkMode] = useState(false);
  const { environments, activeEnvId, globals, envSecrets, globalSecrets } = useAppStore();
  const activeEnv = environments.find((e) => e.id === activeEnvId);
  const activeSec = new Set(activeEnv ? envSecrets[activeEnv.id] ?? [] : []);
  const gSec = new Set(globalSecrets ?? []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeFileItemRef = useRef<string | null>(null);

  const items = useMemo(() => parseLinesToItems(value, isFormData), [value, isFormData]);

  function hasVar(name: string) {
    if (!name) return false;
    if (activeEnv && (activeEnv.variables[name] !== undefined || activeSec.has(name))) return true;
    if (globals[name] !== undefined || gSec.has(name)) return true;
    if (environments.some((e) => name in e.variables || (envSecrets[e.id] ?? []).includes(name))) return true;
    return false;
  }

  function updateItem(id: string, patch: Partial<FormItem>) {
    const next = items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    onChange(serializeItemsToText(next, isFormData));
  }

  function removeItem(id: string) {
    const next = items.filter((it) => it.id !== id);
    onChange(serializeItemsToText(next, isFormData));
  }

  function addItem() {
    const next = [
      ...items,
      {
        id: uid('fitem'),
        key: '',
        value: '',
        type: 'text' as const,
        enabled: true,
      },
    ];
    onChange(serializeItemsToText(next, isFormData));
  }

  function pickFile(id: string) {
    activeFileItemRef.current = id;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const id = activeFileItemRef.current;
    if (!file || !id) return;
    // Trong Webview Tauri hoặc Browser: file.name hoặc (file as any).path
    const path = (file as unknown as { path?: string }).path || file.name;
    updateItem(id, { value: path, type: 'file' });
    activeFileItemRef.current = null;
  }

  if (bulkMode) {
    return (
      <div className="flex flex-col gap-1.5 flex-1 min-h-0">
        <div className="flex items-center justify-between gap-2 text-xs text-slate-400 shrink-0">
          <span>
            Chế độ <b>Bulk Edit</b> (mỗi dòng một cặp <code className="text-emerald-400">key=value</code>
            {isFormData ? <span> hoặc <code className="text-emerald-400">files=@"D:/path/file.png"</code></span> : ''}):
          </span>
          <button
            type="button"
            onClick={() => setBulkMode(false)}
            className="px-2.5 py-1 rounded text-xs bg-slate-800 text-sky-300 hover:bg-slate-700 font-medium"
          >
            📊 Chuyển sang bảng Key - Value
          </button>
        </div>
        <textarea
          spellCheck={false}
          className="bg-slate-900 border border-slate-700 rounded p-2.5 font-mono text-sm min-h-36 flex-1 resize-none outline-none focus:border-emerald-500"
          rows={7}
          placeholder={isFormData ? 'files=@"D:/test/image.png"\nname=example' : 'name=example&id=123'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 flex-1 min-h-0">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelected}
      />

      <div className="flex items-center justify-between text-xs text-slate-400 px-1 shrink-0">
        <span className="font-semibold text-slate-300">
          {isFormData ? 'Multipart Form Data (key - value & file upload)' : 'x-www-form-urlencoded (key - value)'}
        </span>
        <button
          type="button"
          onClick={() => setBulkMode(true)}
          className="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
        >
          📝 Bulk Edit (nhập nhanh nhiều dòng)
        </button>
      </div>

      <div className="border border-slate-800 rounded-lg overflow-hidden flex flex-col flex-1 min-h-0 bg-slate-950/40">
        <div className="flex items-center bg-slate-900/80 px-2 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-slate-800 shrink-0">
          <div className="w-7 text-center">✓</div>
          <div className="w-[30%] min-w-[120px] max-w-[260px] px-2">Key</div>
          {isFormData && <div className="w-16 px-1 text-center">Type</div>}
          <div className="flex-1 px-2">Value</div>
          <div className="w-8 text-center">✕</div>
        </div>

        <div className="flex-1 overflow-auto divide-y divide-slate-800/50">
          {items.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500">
              Chưa có trường nào. Bấm <b>➕ Thêm dòng mới</b> ở bên dưới để thêm trường dữ liệu.
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className={`flex items-center px-2 py-1 hover:bg-slate-900/50 transition-colors ${
                  !item.enabled ? 'opacity-50' : ''
                }`}
              >
                <div className="w-7 flex justify-center">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(e) => updateItem(item.id, { enabled: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-0 cursor-pointer"
                  />
                </div>

                <div className="w-[30%] min-w-[120px] max-w-[260px] px-1">
                  <VarHighlightInput
                    value={item.key}
                    onChange={(k) => updateItem(item.id, { key: k })}
                    placeholder="Key"
                    hasVar={hasVar}
                  />
                </div>

                {isFormData && (
                  <div className="w-16 px-1 flex justify-center">
                    <select
                      value={item.type}
                      onChange={(e) => updateItem(item.id, { type: e.target.value as 'text' | 'file' })}
                      className="bg-slate-800 text-[11px] font-mono text-emerald-300 rounded px-1.5 py-1 border border-slate-700 outline-none cursor-pointer"
                    >
                      <option value="text">Text</option>
                      <option value="file">File</option>
                    </select>
                  </div>
                )}

                <div className="flex-1 px-1 flex items-center gap-1.5 min-w-0">
                  {isFormData && item.type === 'file' ? (
                    <div className="flex items-center gap-2 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs">
                      <span className="text-slate-400 font-mono shrink-0">📎</span>
                      <input
                        type="text"
                        value={item.value}
                        onChange={(e) => updateItem(item.id, { value: e.target.value })}
                        placeholder="Chọn file hoặc dán đường dẫn (vd: D:/photos/avatar.png)"
                        className="bg-transparent text-xs font-mono text-emerald-300 flex-1 outline-none min-w-0"
                      />
                      <button
                        type="button"
                        onClick={() => pickFile(item.id)}
                        className="px-2 py-0.5 rounded text-[11px] bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold shrink-0 transition-colors"
                      >
                        📁 Duyệt file
                      </button>
                    </div>
                  ) : (
                    <VarHighlightInput
                      value={item.value}
                      onChange={(v) => updateItem(item.id, { value: v })}
                      placeholder="Value"
                      hasVar={hasVar}
                    />
                  )}
                </div>

                <div className="w-8 flex justify-center">
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="text-slate-500 hover:text-red-400 text-xs p-1"
                    title="Xóa dòng"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-1.5 bg-slate-900/40 border-t border-slate-800 shrink-0 flex items-center justify-between">
          <button
            type="button"
            onClick={addItem}
            className="px-2.5 py-1 rounded text-xs bg-slate-800 hover:bg-slate-700 text-emerald-400 font-semibold flex items-center gap-1"
          >
            <span>➕</span> Thêm dòng mới
          </button>
          <span className="text-[11px] text-slate-500 pr-2">
            Hỗ trợ biến môi trường <code className="text-slate-400">{'{{variable}}'}</code> ở cả Key và Value
          </span>
        </div>
      </div>
    </div>
  );
}
