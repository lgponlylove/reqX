import type { KeyValue } from '../types/api';
import { uid } from '../lib/variables';
import VarHighlightInput from './VarHighlightInput';
import { useAppStore } from '../stores/app';
import { useTranslation } from '../stores/language';

interface Props {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export default function KeyValueEditor({
  items, onChange, keyPlaceholder, valuePlaceholder,
}: Props) {
  const { t: i18n } = useTranslation();
  const { environments, activeEnvId, globals } = useAppStore();
  const activeEnv = environments.find((e) => e.id === activeEnvId);

  const finalKeyPlaceholder = keyPlaceholder ?? i18n.request.key;
  const finalValuePlaceholder = valuePlaceholder ?? i18n.request.valuePlaceholder;

  function hasVar(name: string) {
    if (activeEnv?.variables[name] !== undefined) return true;
    if (globals[name] !== undefined) return true;
    return false;
  }

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
      <div className="flex gap-2 items-center text-xs text-slate-400 font-medium px-1 mb-1 pb-1 border-b border-slate-800/60">
        <span className="w-4 shrink-0" />
        <span className="flex-1">{i18n.request.key}</span>
        <span className="flex-1">{i18n.request.value}</span>
        <span className="w-24 text-slate-500 hidden sm:inline">{i18n.request.description}</span>
        <span className="w-5" />
      </div>
      {items.length === 0 && (
        <p className="text-xs text-slate-500 px-1 py-1">{i18n.request.emptyRows}</p>
      )}
      {items.map((kv) => (
        <div key={kv.id} className="flex gap-1.5 items-center">
          <input
            type="checkbox"
            title={i18n.request.toggleRow}
            checked={kv.enabled}
            onChange={(e) => update(kv.id, { enabled: e.target.checked })}
            className="accent-emerald-500 w-4 h-4"
          />
          <input
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono"
            placeholder={finalKeyPlaceholder}
            value={kv.key}
            onChange={(e) => update(kv.id, { key: e.target.value })}
          />
          <VarHighlightInput
            placeholder={finalValuePlaceholder}
            value={kv.value}
            onChange={(val) => update(kv.id, { value: val })}
            hasVar={hasVar}
          />
          <button
            onClick={() => remove(kv.id)}
            title={i18n.request.deleteRow}
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
        {i18n.request.addRow}
      </button>
    </div>
  );
}
