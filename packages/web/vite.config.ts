import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
      '/proxy': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: false,
      },
    },
  },
  plugins: [react()],
});
