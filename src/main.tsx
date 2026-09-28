import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Tắt menu chuột phải gốc của browser/WebView (menu custom của app tự xử lý riêng).
// Giữ lại trong ô nhập liệu để còn copy/paste.
window.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
