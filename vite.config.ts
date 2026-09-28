import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri-ready: khi cai Tauri se doi server.port + strictPort.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'esnext',
  },
});
