import { useMemo, useState } from 'react';
import { useAppStore } from '../stores/app';
import { parseCurlCommands } from '../lib/curl-import';
import { uid } from '../lib/variables';
import type { ApiRequest, Collection } from '../types/api';

/** Modal: dán 1 hoặc nhiều lệnh curl → tạo collection mới. */
export default function CurlImport({ onClose }: { onClose: () => void }) {
  const { importData, dirs, moveCollection } = useAppStore();
  const [text, setText] = useState('');
  const [colName, setColName] = useState('');
  const [dirId, setDirId] = useState('');

  const parsed = useMemo(() => {
    if (!text.trim()) return { ok: [], errors: [] as string[] };
    const ok: { req: ApiRequest; warnings: string[]; index: number }[] = [];
    const errors: string[] = [];
    parseCurlCommands(text).forEach((c, i) => {
      if (c.parsed) ok.push({ req: c.parsed.request, warnings: c.parsed.warnings, index: i });
      else errors.push(`Lệnh ${i + 1}: ${c.error}`);
    });
    return { ok, errors };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const doImport = () => {
    if (parsed.ok.length === 0) return;
    const reqs = parsed.ok.map((p) => p.req);
    const firstHost = (() => {
      try {
        return new URL(reqs[0].url).hostname;
      } catch {
        return '';
      }
    })();
    const name =
      colName.trim() ||
      (firstHost ? `${firstHost} (${reqs.length} req)` : `Curl import ${new Date().toLocaleString('vi-VN')}`);
    const col: Collection = {
      id: uid('col'),
      name,
      folders: [],
      rootRequestIds: reqs.map((r) => r.id),
    };
    importData(col, reqs);
    if (dirId) moveCollection(col.id, dirId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-slate-900 border border-slate-700 rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <b>📥 Import từ curl</b>
          <button onClick={onClose} className="text-slate-400 hover:text-white px-2">
            ✕
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-auto">
          <p className="text-xs text-slate-500">
            Dán 1 hoặc nhiều lệnh <code className="font-mono text-slate-300">curl</code> (kể cả xuống dòng bằng{' '}
            <code className="font-mono text-slate-300">\</code>) — mỗi lệnh thành 1 request trong collection mới.
            Hỗ trợ: <code className="font-mono text-slate-300">-X -H -d/--data* -u -G -F --json --url -b -A</code>.
          </p>
          <textarea
            rows={8}
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"curl --location 'https://api.example.com/token' \\\n  --header 'Content-Type: application/x-www-form-urlencoded' \\\n  --data-urlencode 'grant_type=client_credentials'"}
            className="bg-slate-950 border border-slate-700 rounded p-2.5 font-mono text-xs outline-none focus:border-emerald-600"
          />
          {parsed.errors.map((e, i) => (
            <p key={i} className="text-red-400 text-xs font-mono">
              Lỗi: {e}
            </p>
          ))}
          {parsed.ok.length > 0 && (
            <div className="text-sm">
              <p className="text-slate-400 mb-1">
                Nhận diện {parsed.ok.length} request:
              </p>
              <ul className="flex flex-col gap-1">
                {parsed.ok.map((p) => (
                  <li key={p.index} className="bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-xs">
                    <span className="text-sky-300 font-bold">{p.req.method}</span>{' '}
                    <span className="text-slate-300 break-all">{p.req.url}</span>
                    {p.warnings.map((w, j) => (
                      <span key={j} className="block text-amber-300">
                        ⚠ {w}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex gap-3">
            <label className="flex-[2] flex flex-col gap-1 text-sm">
              Tên collection mới
              <input
                value={colName}
                onChange={(e) => setColName(e.target.value)}
                placeholder="Để trống = tự đặt theo domain"
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5"
              />
            </label>
            <label className="flex-1 flex flex-col gap-1 text-sm">
              Thư mục
              <select
                value={dirId}
                onChange={(e) => setDirId(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5"
              >
                <option value="">Ngoài thư mục</option>
                {(() => {
                  const out: { id: string; path: string; depth: number }[] = [];
                  const walk = (pid: string | null, depth: number, prefix: string) => {
                    for (const d of dirs.filter((x) => (x.parentId ?? null) === pid)) {
                      const path = prefix ? `${prefix} / ${d.name}` : d.name;
                      out.push({ id: d.id, path, depth });
                      walk(d.id, depth + 1, path);
                    }
                  };
                  walk(null, 0, '');
                  return out.map((o) => (
                    <option key={o.id} value={o.id}>{`${'— '.repeat(o.depth)}📁 ${o.path}`}</option>
                  ));
                })()}
              </select>
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-800">
          <button onClick={onClose} className="bg-slate-800 hover:bg-slate-700 rounded px-4 py-1.5 text-sm">
            Hủy
          </button>
          <button
            onClick={doImport}
            disabled={parsed.ok.length === 0}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded px-4 py-1.5 text-sm font-semibold"
          >
            Import {parsed.ok.length > 0 ? `(${parsed.ok.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
