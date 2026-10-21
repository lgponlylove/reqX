import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// Tắt menu chuột phải gốc của browser/WebView (menu custom của app tự xử lý riêng).
// Giữ lại trong ô nhập liệu để còn copy/paste.
window.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  e.preventDefault();
});

// Chặn Ctrl+A / Cmd+A bôi đen toàn bộ giao diện app khi không đứng trong ô nhập liệu/vùng chọn text.
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('input, textarea, select, [contenteditable="true"], .selectable, .select-text')) return;
    e.preventDefault();
  }
});

// Chặn phím tắt mở DevTools / View Source trên bản phát hành (Production)
if (import.meta.env.PROD) {
  window.addEventListener('keydown', (e) => {
    // F12
    if (e.key === 'F12') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Ctrl+Shift+I / Cmd+Opt+I (Inspect), Ctrl+Shift+J (Console), Ctrl+Shift+C (Element picker)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Ctrl+U / Cmd+Opt+U (View Source)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U')) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
