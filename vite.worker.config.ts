import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    target: 'node22',
    lib: { entry: 'src/worker/scanWorker.ts', formats: ['cjs'], fileName: () => 'scanWorker.js' },
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
  },
});
