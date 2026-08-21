import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  publicDir: 'public',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: true,
  },
});
