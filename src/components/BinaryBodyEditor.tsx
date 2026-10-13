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

function formatHexDump(bytes: Uint8Array, maxBytes = 4096): string {
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
    // Chèn khoảng cách giữa 8 bytes đầu và 8 bytes sau
    const hexStr = hexParts.slice(0, 8).join(' ') + '  ' + hexParts.slice(8).join(' ');
    lines.push(`${offset}  ${hexStr}  |${ascii}|`);
  }
  if (bytes.length > maxBytes) {
    lines.push(`... [Truncated preview: ${bytes.length - maxBytes} bytes more]`);
  }
  return lines.join('\n');
}

export default function BinaryBodyEditor({ value, onChange }: BinaryBodyEditorProps) {
  const [viewMode, setViewMode] = useState<'hex' | 'base64'>('hex');
  const [fileName, setFileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { bytes } = useMemo(() => parseToBytes(value), [value]);
  const hexDump = useMemo(() => formatHexDump(bytes), [bytes]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:...;base64,xxxx"
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
    <div className="flex flex-col gap-2 bg-slate-900/60 border border-slate-800 rounded-lg p-3">
      {/* File attachment bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <span>📁</span>
            <span>{fileName ? 'Đổi file...' : 'Chọn file đính kèm...'}</span>
          </button>
          {fileName && (
            <span className="text-xs text-emerald-400 font-mono truncate max-w-[200px]" title={fileName}>
              {fileName}
            </span>
          )}
          <span className="text-xs text-slate-400 font-mono">
            {bytes.length > 0 ? `(${bytes.length.toLocaleString()} bytes / ${(bytes.length / 1024).toFixed(1)} KB)` : '(0 bytes)'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="bg-slate-800 p-0.5 rounded flex text-xs">
            <button
              type="button"
              onClick={() => setViewMode('hex')}
              className={`px-2 py-1 rounded transition-colors ${
                viewMode === 'hex' ? 'bg-slate-700 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Hex View
            </button>
            <button
              type="button"
              onClick={() => setViewMode('base64')}
              className={`px-2 py-1 rounded transition-colors ${
                viewMode === 'base64' ? 'bg-slate-700 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Base64 Editor
            </button>
          </div>
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded transition-colors"
              title="Xóa nội dung file"
            >
              Xóa
            </button>
          )}
        </div>
      </div>

      {/* 2-way View / Editor */}
      {viewMode === 'hex' ? (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] text-slate-500 flex justify-between">
            <span>Hex Dump (Offset | Hex Bytes | ASCII)</span>
            <span>Chế độ xem Hex nhị phân</span>
          </div>
          <pre className="bg-slate-950 border border-slate-800 rounded p-2.5 font-mono text-xs text-slate-300 overflow-x-auto min-h-36 max-h-72 select-text whitespace-pre leading-relaxed">
            {hexDump || <span className="text-slate-600">Chưa có dữ liệu file nhị phân. Hãy chọn file bên trên hoặc nhập Base64.</span>}
          </pre>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] text-slate-500 flex justify-between">
            <span>Base64 String Payload</span>
            <span>Có thể chỉnh sửa hoặc dán chuỗi Base64</span>
          </div>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Dán chuỗi Base64 vào đây (vd: iVBORw0KGgoAAAANSUhEUgAA...)"
            rows={7}
            className="bg-slate-950 border border-slate-800 rounded p-2.5 font-mono text-xs text-slate-300 min-h-36 focus:outline-none focus:border-emerald-500"
          />
        </div>
      )}
    </div>
  );
}
