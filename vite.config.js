import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api/simulations': {
        target: 'http://127.0.0.1:8766',
        changeOrigin: true
      },
      '/api/troubleshooting': {
        target: 'http://127.0.0.1:8766',
        changeOrigin: true
      },
      '/api/components': {
        target: 'http://127.0.0.1:8766',
        changeOrigin: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['node_modules/**', 'dist/**', 'backups/**', 'Jigui_demo/**']
  }
});
