import React from 'react';

interface MarkdownProps {
  content: string;
}

/**
 * Trình render Markdown mini, siêu nhẹ, không cần thư viện ngoài.
 * Xử lý: Bold (**), Code (`...`), Code Block (```), Headers (###), Lists (- / 1.), Line breaks.
 */
export const MarkdownMessage: React.FC<MarkdownProps> = ({ content }) => {
  if (!content) return null;

  // Tách nội dung thành các dòng để xử lý blocks
  const lines = content.split('\n');
  const renderedElements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = '';

  const renderInline = (text: string): React.ReactNode => {
    // Tách các đoạn inline code `...`
    const parts = text.split(/(`[^`]+`)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
        const code = part.slice(1, -1);
        return (
          <code
            key={idx}
            className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-800 text-teal-300 font-mono text-[11px] border border-slate-700"
          >
            {code}
          </code>
        );
      }

      // Xử lý Bold (**text**)
      const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
      return (
        <React.Fragment key={idx}>
          {boldParts.map((bPart, bIdx) => {
            if (bPart.startsWith('**') && bPart.endsWith('**') && bPart.length >= 4) {
              return (
                <strong key={bIdx} className="font-bold text-slate-100">
                  {bPart.slice(2, -2)}
                </strong>
              );
            }
            return bPart;
          })}
        </React.Fragment>
      );
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Xử lý Code Block ```
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // Đóng code block
        const code = codeBlockLines.join('\n');
        renderedElements.push(
          <div key={`codeblock-${i}`} className="my-2 rounded-lg bg-slate-950 border border-slate-800 p-2.5 overflow-x-auto font-mono text-xs text-cyan-200">
            {codeBlockLang && (
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-sans font-semibold">
                {codeBlockLang}
              </div>
            )}
            <pre className="whitespace-pre">{code}</pre>
          </div>
        );
        inCodeBlock = false;
        codeBlockLines = [];
        codeBlockLang = '';
      } else {
        // Mở code block
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    // Dòng trống
    if (!trimmed) {
      renderedElements.push(<div key={`empty-${i}`} className="h-1.5" />);
      continue;
    }

    // Tiêu đề ###
    if (trimmed.startsWith('### ')) {
      renderedElements.push(
        <h4 key={`h3-${i}`} className="font-bold text-teal-300 text-xs mt-2 mb-1">
          {renderInline(trimmed.slice(4))}
        </h4>
      );
      continue;
    }
    if (trimmed.startsWith('## ')) {
      renderedElements.push(
        <h3 key={`h2-${i}`} className="font-bold text-teal-300 text-sm mt-2.5 mb-1 border-b border-slate-800 pb-0.5">
          {renderInline(trimmed.slice(3))}
        </h3>
      );
      continue;
    }
    if (trimmed.startsWith('# ')) {
      renderedElements.push(
        <h2 key={`h1-${i}`} className="font-bold text-cyan-300 text-sm mt-3 mb-1.5">
          {renderInline(trimmed.slice(2))}
        </h2>
      );
      continue;
    }

    // Gạch đầu dòng / Bullet list (- hoặc *)
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      renderedElements.push(
        <div key={`li-${i}`} className="flex items-start gap-1.5 ml-1.5 my-0.5 text-xs text-slate-200 leading-relaxed">
          <span className="text-teal-400 select-none mt-0.5">•</span>
          <span className="flex-1 min-w-0">{renderInline(trimmed.slice(2))}</span>
        </div>
      );
      continue;
    }

    // Numbered list (1. 2. 3.)
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numMatch) {
      renderedElements.push(
        <div key={`num-${i}`} className="flex items-start gap-1.5 ml-1.5 my-0.5 text-xs text-slate-200 leading-relaxed">
          <span className="text-teal-400 font-mono text-[11px] select-none mt-0.5">{numMatch[1]}.</span>
          <span className="flex-1 min-w-0">{renderInline(numMatch[2])}</span>
        </div>
      );
      continue;
    }

    // Đoạn văn thông thường
    renderedElements.push(
      <p key={`p-${i}`} className="my-0.5 text-xs text-slate-200 leading-relaxed break-words">
        {renderInline(line)}
      </p>
    );
  }

  // Nếu file kết thúc khi đang trong code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    renderedElements.push(
      <div key="codeblock-end" className="my-2 rounded-lg bg-slate-950 border border-slate-800 p-2.5 overflow-x-auto font-mono text-xs text-cyan-200">
        <pre className="whitespace-pre">{codeBlockLines.join('\n')}</pre>
      </div>
    );
  }

  return <div className="space-y-0.5">{renderedElements}</div>;
};
