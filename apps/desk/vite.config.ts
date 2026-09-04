import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const host = process.env['TAURI_DEV_HOST'];

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri: keep rust errors on screen and hold a
  // fixed port, since `devUrl` in tauri.conf.json is not negotiated.
  clearScreen: false,
  server: {
    port: 1425,
    strictPort: true,
    host: host || false,
    hmr: host ? {protocol: 'ws', host, port: 1426} : undefined,
    watch: {ignored: ['**/src-tauri/**']},
  },
});
