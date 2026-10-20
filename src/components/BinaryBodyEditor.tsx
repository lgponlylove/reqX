import { useState, useRef, useMemo } from 'react';

interface BinaryBodyEditorProps {
  value: string;
  onChange: (value: string) => void;
}

function parseToBytes(val: string): { bytes: Uint8Array; isBase64: boolean } {
  if (!val.trim()) return { bytes: new Uint8Array(0), isBase64: false };
  try {
    const raw = atob(val.trim());
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return { bytes: arr, isBase64: true };
  } catch {
    return { bytes: new TextEncoder().encode(val), isBase64: false };
  }
}

function formatHexDump(bytes: Uint8Array, maxBytes = 2048): string {
  const slice = bytes.slice(0, maxBytes);
  const lines: string[] = [];
  for (let i = 0; i < slice.length; i += 16) {
    const offset = i.toString(16).padStart(8, '0');
    const chunk = slice.slice(i, i + 16);
    const hexParts: string[] = [];
    let ascii = '';
    for (let j = 0; j < 16; j++) {
      if (j < chunk.length) {
        const b = chunk[j];
        hexParts.push(b.toString(16).padStart(2, '0'));
        ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.';
      } else {
        hexParts.push('  ');
      }
    }
    const hexStr = hexParts.slice(0, 8).join(' ') + '  ' + hexParts.slice(8).join(' ');
    lines.push(`${offset}  ${hexStr}  |${ascii}|`);
  }
  if (bytes.length > maxBytes) {
    lines.push(`... [Truncated preview: ${bytes.length - maxBytes} bytes more]`);
  }
  return lines.join('\n');
}

function formatFileSize(bytesCount: number): string {
  if (bytesCount <= 0) return '0 B';
  if (bytesCount < 1024) return `${bytesCount} B`;
  if (bytesCount < 1024 * 1024) return `${(bytesCount / 1024).toFixed(1)} KB`;
  return `${(bytesCount / (1024 * 1024)).toFixed(2)} MB`;
}

export default function BinaryBodyEditor({ value, onChange }: BinaryBodyEditorProps) {
  const [showHexDetails, setShowHexDetails] = useState(false);
  const [hexTab, setHexTab] = useState<'hex' | 'base64'>('hex');
  const [fileName, setFileName] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { bytes } = useMemo(() => parseToBytes(value), [value]);
  const hexDump = useMemo(() => formatHexDump(bytes), [bytes]);

  const hasFile = Boolean(value && value.trim() !== '');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(',');
      const b64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      onChange(b64);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(',');
      const b64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      onChange(b64);
    };
    reader.readAsDataURL(file);
  };

  const handleClear = () => {
    setFileName('');
    onChange('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="flex flex-col gap-2.5 flex-1 min-h-0 bg-slate-950/30 border border-slate-800 rounded-lg p-3">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Postman-style Binary File Box */}
      {!hasFile ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg transition-all ${
            isDragging
              ? 'border-emerald-400 bg-emerald-950/20'
              : 'border-slate-800 hover:border-slate-700 bg-slate-900/40'
          }`}
        >
          <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-700/80 flex items-center justify-center text-xl mb-3 text-slate-300">
            📦
          </div>
          <p className="text-xs font-semibold text-slate-300 mb-1">
            Gửi dữ liệu nhị phân (Binary File)
          </p>
          <p className="text-[11px] text-slate-500 mb-4 text-center max-w-sm">
            Kéo thả file vào đây hoặc bấm nút bên dưới để chọn file (ảnh, video, âm thanh, PDF, file zip...)
          </p>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
          >
            <span>📁</span>
            <span>Chọn file từ máy tính...</span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between p-3.5 bg-slate-900/90 border border-slate-800 rounded-lg">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-emerald-950/60 border border-emerald-500/30 flex items-center justify-center text-xl shrink-0">
                📄
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-emerald-300 truncate" title={fileName || 'Attached Binary'}>
                  {fileName || 'Tệp nhị phân đã chọn'}
                </span>
                <span className="text-[11px] text-slate-400 font-mono mt-0.5">
                  {formatFileSize(bytes.length)} ({bytes.length.toLocaleString()} bytes)
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-2.5 py-1 rounded text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              >
                🔄 Đổi file khác
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="px-2.5 py-1 rounded text-xs bg-red-950/40 text-red-400 hover:bg-red-900/50 hover:text-red-300 transition-colors"
                title="Gỡ file này"
              >
                ✕ Gỡ file
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tùy chọn nâng cao: Xem Hex Dump / Chỉnh sửa Base64 */}
      <div className="border-t border-slate-800/80 pt-2 flex flex-col gap-2 mt-auto">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowHexDetails(!showHexDetails)}
            className="text-[11px] text-slate-400 hover:text-emerald-400 flex items-center gap-1 transition-colors"
          >
            <span>{showHexDetails ? '▼' : '▶'}</span>
            <span>Xem chi tiết kỹ thuật (Hex Dump & Base64 Payload)</span>
          </button>
          <span className="text-[11px] text-slate-500">Mặc định Content-Type: application/octet-stream</span>
        </div>

        {showHexDetails && (
          <div className="flex flex-col gap-2 mt-1 bg-slate-900/50 border border-slate-800/80 rounded p-2.5">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
              <div className="bg-slate-800 p-0.5 rounded flex text-xs">
                <button
                  type="button"
                  onClick={() => setHexTab('hex')}
                  className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                    hexTab === 'hex' ? 'bg-slate-700 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Hex Dump
                </button>
                <button
                  type="button"
                  onClick={() => setHexTab('base64')}
                  className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                    hexTab === 'base64' ? 'bg-slate-700 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Base64 Text
                </button>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                {bytes.length} bytes
              </span>
            </div>

            {hexTab === 'hex' ? (
              <pre className="bg-slate-950 border border-slate-800/80 rounded p-2 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-48 select-text whitespace-pre leading-relaxed">
                {hexDump || <span className="text-slate-600">Chưa có dữ liệu nhị phân.</span>}
              </pre>
            ) : (
              <textarea
                spellCheck={false}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Dán hoặc chỉnh sửa chuỗi Base64 tại đây..."
                rows={5}
                className="bg-slate-950 border border-slate-800/80 rounded p-2 font-mono text-[11px] text-slate-300 focus:outline-none focus:border-emerald-500 resize-none"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
