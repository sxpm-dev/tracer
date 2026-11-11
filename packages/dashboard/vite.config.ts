import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

// The bin entries use top-level await, which CJS cannot represent. Only the
// library entries are emitted in both formats; the CLIs stay ESM-only.
const libraryEntries = {
  data: 'src/data.ts',
  index: 'src/index.ts',
  server: 'src/server.ts',
  vite: 'src/vite.ts',
};
const binEntries = {
  cli: 'src/cli.ts',
  'report-cli': 'src/report-cli.ts',
};

const format = process.env.BUILD_FORMAT === 'cjs' ? 'cjs' : 'es';

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      cssFileName: 'style',
      entry:
        format === 'cjs'
          ? libraryEntries
          : { ...libraryEntries, ...binEntries },
      fileName: (_, name) => `${name}.${format === 'cjs' ? 'cjs' : 'js'}`,
      formats: [format],
    },
    rollupOptions: {
      external: (id) =>
        ['react', 'react-dom', 'vite', '@sx/recordings'].some(
          (name) => id === name || id.startsWith(`${name}/`),
        ) ||
        id.startsWith('node:') ||
        builtinModules.includes(id),
    },
    target: 'es2022',
  },
});
