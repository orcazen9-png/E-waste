import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Keeps the browser on one origin in development, so no CORS juggling.
      '/v1': { target: process.env['API_URL'] ?? 'http://localhost:3001', changeOrigin: true },
      '/health': { target: process.env['API_URL'] ?? 'http://localhost:3001', changeOrigin: true },
    },
  },
});
