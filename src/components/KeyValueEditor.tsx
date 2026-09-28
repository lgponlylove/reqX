import type { KeyValue } from '../types/api';
import { uid } from '../lib/variables';

interface Props {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export default function KeyValueEditor({
  items, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value (hỗ trợ {{var}})',
}: Props) {
  function update(id: string, patch: Partial<KeyValue>) {
    onChange(items.map((kv) => (kv.id === id ? { ...kv, ...patch } : kv)));
  }
  function remove(id: string) {
    onChange(items.filter((kv) => kv.id !== id));
  }
  function add() {
    onChange([...items, { id: uid('kv'), key: '', value: '', enabled: true }]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.length === 0 && (
        <p className="text-xs text-slate-500">Chưa có dòng nào. Nhấn “+ Thêm”.</p>
      )}
      {items.map((kv) => (
        <div key={kv.id} className="flex gap-1.5 items-center">
          <input
            type="checkbox"
            title="Bật/tắt dòng này"
            checked={kv.enabled}
            onChange={(e) => update(kv.id, { enabled: e.target.checked })}
            className="accent-emerald-500 w-4 h-4"
          />
          <input
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono"
            placeholder={keyPlaceholder}
            value={kv.key}
            onChange={(e) => update(kv.id, { key: e.target.value })}
          />
          <input
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono"
            placeholder={valuePlaceholder}
            value={kv.value}
            onChange={(e) => update(kv.id, { value: e.target.value })}
          />
          <button
            onClick={() => remove(kv.id)}
            title="Xóa dòng"
            className="text-slate-500 hover:text-red-400 px-1.5"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="self-start mt-1 bg-slate-800 hover:bg-slate-700 rounded px-3 py-1 text-xs"
      >
        + Thêm
      </button>
    </div>
  );
}
