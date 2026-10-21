import { useEffect, useState } from 'react';
import { getBody, type StoredBody } from '../lib/bodyStore';
import { responseDataUrl, downloadResponse } from '../lib/response-file';
import type { ApiResponse } from '../types/api';

const PREVIEW_LIMIT = 100_000;

/** Modal xem lại body response của 1 step trong lịch sử chạy (text hoặc file). */
export default function ScheduleBodyModal({ bodyKey, stepName, status, contentType, onClose }: {
  bodyKey: string;
  stepName: string;
  status?: number;
  contentType?: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<StoredBody | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    getBody(bodyKey).then((d) => {
      if (!alive) return;
      if (d) setData(d);
      else setMissing(true);
    });
    return () => { alive = false; };
  }, [bodyKey]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const ct = data?.contentType || contentType || '';
  const resp: ApiResponse | null = data
    ? { status: status ?? 200, statusText: '', timeMs: 0, sizeBytes: data.body.length, headers: { 'content-type': ct }, body: data.body, bodyKind: data.bodyKind }
    : null;
  const previewable = /^(image|video|audio)\//.test(ct) || ct === 'application/pdf';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800 text-sm">
          <b className="truncate">📄 {stepName}</b>
          {status !== undefined && <span className="font-mono text-xs text-slate-400">{status}</span>}
          {ct && <span className="font-mono text-xs text-slate-500 truncate">{ct}</span>}
          <span className="ml-auto flex gap-1.5 shrink-0">
            {resp && (
              <button
                onClick={() => downloadResponse(resp)}
                title="Tải body về máy"
                className="bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1 text-xs"
              >
                💾 Lưu file
              </button>
            )}
            <button onClick={onClose} className="bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1 text-xs">✕</button>
          </span>
        </div>
        <div className="p-4 overflow-auto">
          {!data && !missing && <p className="text-slate-400 text-sm animate-pulse">Đang tải body…</p>}
          {missing && <p className="text-amber-400 text-sm">Body này đã bị dọn (chỉ giữ 20 lần chạy gần nhất).</p>}
          {data && data.bodyKind === 'binary' && (
            previewable ? (
              <BodyPreview ct={ct} url={responseDataUrl(resp!)} />
            ) : (
              <p className="text-slate-400 text-sm">
                File nhị phân ({ct || 'không rõ loại'}, ~{(data.body.length * 3 / 4 / 1024).toFixed(1)} KB) — không preview được, bấm 💾 Lưu file để mở bằng app khác.
              </p>
            )
          )}
          {data && data.bodyKind === 'text' && (
            <>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-slate-200">
                {data.body.length > PREVIEW_LIMIT ? data.body.slice(0, PREVIEW_LIMIT) + `\n… (còn ${(data.body.length - PREVIEW_LIMIT).toLocaleString('vi-VN')} ký tự — bấm 💾 để tải full)` : data.body}
              </pre>
              {data.body === '' && <p className="text-slate-500 text-sm">(body rỗng)</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BodyPreview({ ct, url }: { ct: string; url: string }) {
  if (ct.startsWith('image/')) return <img src={url} alt="preview" className="max-w-full rounded" />;
  if (ct.startsWith('video/')) return <video src={url} controls className="max-w-full rounded" />;
  if (ct.startsWith('audio/')) return <audio src={url} controls className="w-full" />;
  return <iframe src={url} title="preview" className="w-full h-[60vh] bg-white rounded" />;
}
