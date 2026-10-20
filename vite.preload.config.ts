import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    target: 'node22',
    lib: { entry: 'src/preload/preload.ts', formats: ['cjs'], fileName: () => 'preload.cjs' },
    rollupOptions: { external: ['electron'] },
  },
});
