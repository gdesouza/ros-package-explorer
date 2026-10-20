import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

// Forge packages only the Vite output, so every dependency except Electron
// and Node built-ins must be bundled.
export default defineConfig({
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    target: 'node22',
    lib: { entry: 'src/main/main.ts', formats: ['cjs'], fileName: () => 'main.js' },
    rollupOptions: {
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
  },
});
