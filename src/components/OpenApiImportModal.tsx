import { useState, useRef } from 'react';
import { useAppStore } from '../stores/app';
import { sendRequest } from '../lib/http-client';
import { DEFAULT_REQUEST, type ApiRequest } from '../types/api';
import { importOpenApiSpec, isOpenApiSpec, parseYamlOrJson, type OpenApiImportResult } from '../lib/openapi-import';

interface OpenApiImportModalProps {
  onClose: () => void;
}

export default function OpenApiImportModal({ onClose }: OpenApiImportModalProps) {
  const { importData, dirs, moveCollection } = useAppStore();
  const [tab, setTab] = useState<'url' | 'file' | 'raw'>('url');
  const [url, setUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OpenApiImportResult | null>(null);
  const [targetDirId, setTargetDirId] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFetchUrl() {
    if (!url.trim()) {
      setError('Vui lòng nhập URL của tài liệu Swagger / OpenAPI.');
      return;
    }
    setError(null);
    setLoading(true);
    setPreview(null);

    try {
      let content = '';
      try {
        const dummyReq: ApiRequest = {
          ...DEFAULT_REQUEST,
          id: 'temp-req',
          method: 'GET',
          url: url.trim(),
          updatedAt: Date.now(),
        };
        const res = await sendRequest(dummyReq, {}, {});
        if (res.status >= 200 && res.status < 300) {
          content = res.body;
        } else {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
      } catch {
        const res = await fetch(url.trim());
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        content = await res.text();
      }

      const parsed = parseYamlOrJson(content);
      if (!isOpenApiSpec(parsed)) {
        throw new Error('Dữ liệu tải về không phải là đặc tả Swagger 2.0 hoặc OpenAPI 3.x hợp lệ.');
      }

      const result = importOpenApiSpec(parsed, 'Swagger / OpenAPI');
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPreview(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = parseYamlOrJson(content);
        if (!isOpenApiSpec(parsed)) {
          throw new Error('File này không phải là Swagger 2.0 hoặc OpenAPI 3.x.');
        }
        const result = importOpenApiSpec(parsed, file.name.replace(/\.[^/.]+$/, ''));
        setPreview(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleParseRaw() {
    if (!rawText.trim()) {
      setError('Vui lòng dán nội dung JSON hoặc YAML.');
      return;
    }
    setError(null);
    setPreview(null);
    try {
      const parsed = parseYamlOrJson(rawText);
      if (!isOpenApiSpec(parsed)) {
        throw new Error('Nội dung không phải là Swagger 2.0 hoặc OpenAPI 3.x.');
      }
      const result = importOpenApiSpec(parsed, 'Swagger Imported');
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleConfirmImport() {
    if (!preview) return;
    importData(preview.collection, preview.requests);
    if (targetDirId) {
      moveCollection(preview.collection.id, targetDirId);
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-cyan-500/30 rounded-xl shadow-[0_0_30px_rgba(6,182,212,0.15)] w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌐</span>
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">
                Import Swagger / OpenAPI 3.x
              </h3>
              <p className="text-xs text-slate-400">
                Tự động đồng bộ tài liệu API, tạo Collection và sinh Test Validate JSON Schema
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white rounded-lg p-1.5 hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tab selection */}
        <div className="flex border-b border-slate-800 px-6 pt-3 gap-2 bg-slate-950/30">
          <button
            onClick={() => { setTab('url'); setError(null); }}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all ${
              tab === 'url'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            🔗 Nhập qua URL (Tự động Sync)
          </button>
          <button
            onClick={() => { setTab('file'); setError(null); }}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all ${
              tab === 'file'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            📁 File JSON / YAML
          </button>
          <button
            onClick={() => { setTab('raw'); setError(null); }}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all ${
              tab === 'raw'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            📝 Dán nội dung thô
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {tab === 'url' && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-slate-300">
                Swagger / OpenAPI Spec URL (JSON hoặc YAML):
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://petstore.swagger.io/v2/swagger.json hoặc http://localhost:8080/v3/api-docs"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleFetchUrl()}
                  className="flex-1 bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-lg px-3.5 py-2 text-xs text-white placeholder-slate-500 outline-none transition-colors"
                />
                <button
                  onClick={handleFetchUrl}
                  disabled={loading}
                  className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  {loading ? <span className="animate-spin">⏳</span> : '⚡'} Tải về
                </button>
              </div>
              <p className="text-[11px] text-slate-400 italic">
                💡 Hỗ trợ Swagger 2.0, OpenAPI 3.0, OpenAPI 3.1 từ mọi máy chủ backend (Spring Boot, FastAPI, NestJS, Go, v.v.).
              </p>
            </div>
          )}

          {tab === 'file' && (
            <div className="space-y-3 text-center py-6 border-2 border-dashed border-slate-800 hover:border-cyan-500/50 rounded-xl transition-colors bg-slate-950/20">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.yaml,.yml"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="text-3xl">📄</div>
              <p className="text-xs text-slate-300 font-medium">
                Chọn file đặc tả API từ máy tính
              </p>
              <p className="text-[11px] text-slate-500">
                Định dạng hỗ trợ: <code className="text-cyan-400">.json</code>, <code className="text-cyan-400">.yaml</code>, <code className="text-cyan-400">.yml</code>
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-4 py-2 rounded-lg font-semibold border border-slate-700 transition-colors"
              >
                Chọn File...
              </button>
            </div>
          )}

          {tab === 'raw' && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-slate-300">
                Dán nội dung JSON hoặc YAML của OpenAPI:
              </label>
              <textarea
                spellCheck={false}
                rows={8}
                placeholder="openapi: 3.0.0&#10;info:&#10;  title: Sample API..."
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-lg p-3 text-xs font-mono text-slate-200 placeholder-slate-600 outline-none transition-colors"
              />
              <button
                onClick={handleParseRaw}
                className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-colors"
              >
                Phân tích cú pháp
              </button>
            </div>
          )}

          {error && (
            <div className="bg-red-950/50 border border-red-800/80 rounded-lg p-3 text-xs text-red-300">
              <b>Lỗi:</b> {error}
            </div>
          )}

          {/* Preview Section */}
          {preview && (
            <div className="bg-cyan-950/20 border border-cyan-800/50 rounded-xl p-4 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-cyan-300">
                    📦 {preview.collection.name}
                  </h4>
                </div>
                <span className="text-xs bg-cyan-900/60 border border-cyan-700/60 text-cyan-200 px-2.5 py-1 rounded-full font-semibold">
                  {preview.requests.length} requests
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 bg-slate-950/60 rounded-lg p-3 border border-slate-800">
                <div>
                  Folders (Tags): <b className="text-white">{preview.collection.folders.length}</b>
                </div>
                <div>
                  Root requests: <b className="text-white">{preview.collection.rootRequestIds.length}</b>
                </div>
                <div>
                  Schema Assertions: <b className="text-emerald-400">Đã tích hợp sẵn</b>
                </div>
                <div>
                  Payload Mẫu: <b className="text-emerald-400">Tự động sinh từ Schema</b>
                </div>
              </div>

              {preview.collection.folders.length > 0 && (
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[11px] text-slate-400 mr-1">Các nhóm API:</span>
                  {preview.collection.folders.map((f) => (
                    <span
                      key={f.id}
                      className="text-[11px] bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-slate-300"
                    >
                      📁 {f.name} ({f.requestIds.length})
                    </span>
                  ))}
                </div>
              )}

              {/* Destination Directory */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-4">
                <span className="text-xs text-slate-400">Lưu vào thư mục:</span>
                <select
                  value={targetDirId}
                  onChange={(e) => setTargetDirId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 outline-none"
                >
                  <option value="">(Ngoài thư mục / Gốc)</option>
                  {dirs.map((d) => (
                    <option key={d.id} value={d.id}>
                      📁 {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-800 bg-slate-950/60">
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            Đóng
          </button>
          {preview ? (
            <button
              onClick={handleConfirmImport}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-5 py-2 rounded-lg shadow-[0_0_15px_rgba(16,185,129,0.4)] transition-all flex items-center gap-1.5"
            >
              ✓ Xác nhận nhập {preview.requests.length} Requests vào ReqX
            </button>
          ) : (
            <span className="text-xs text-slate-500 italic">
              Chọn URL hoặc File để xem trước cấu trúc
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
