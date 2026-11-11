import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    rollupOptions: { external: ['@sx/tracing'] },
    lib: {
      entry: 'src/index.ts',
      fileName: (format) => (format === 'cjs' ? 'index.cjs' : 'index.js'),
      formats: ['es', 'cjs'],
    },
    target: ['chrome107', 'edge107', 'firefox104', 'safari16'],
  },
});
