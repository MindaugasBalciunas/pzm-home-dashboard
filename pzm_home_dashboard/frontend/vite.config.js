import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Vendor libs in their own hashed chunks: a dashboard release only
        // changes the small app chunk, so the kiosk re-downloads ~80 kB
        // instead of ~800 kB (hls.js/react hashes stay put → cache hits).
        manualChunks: {
          hls: ['hls.js'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8099',
      '/hls': 'http://localhost:8099',
    },
  },
});
