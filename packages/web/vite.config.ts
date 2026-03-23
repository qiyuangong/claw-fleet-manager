import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendTarget = 'https://localhost:3001';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: backendTarget,
        secure: false,
      },
      '/ws': {
        target: backendTarget,
        ws: true,
        secure: false,
      },
      '/proxy': {
        target: backendTarget,
        ws: true,
        secure: false,
        changeOrigin: false,
      },
    },
  },
  plugins: [react()],
});
