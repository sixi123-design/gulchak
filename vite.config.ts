import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
