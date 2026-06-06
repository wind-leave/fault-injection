import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['node_modules/**', 'dist/**', 'backups/**', 'Jigui_demo/**']
  }
});
