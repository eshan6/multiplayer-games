import { defineConfig } from 'vite';

/**
 * File names are deliberately not hashed. The game is published as a page
 * plus the files beside it, and each publish replaces files by path: a hash
 * in the name would leave every previous build's assets behind.
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: { port: 5174 },
});
