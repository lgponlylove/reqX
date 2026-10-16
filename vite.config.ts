import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri-ready: khi cai Tauri se doi server.port + strictPort.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
  },
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  build: {
    target: 'esnext',
    sourcemap: false,
    minify: 'esbuild',
  },
}));
