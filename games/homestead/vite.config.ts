import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Two builds from one source:
 *
 *   vite build                the normal build — hashed assets beside index.html
 *   vite build --mode single  one self-contained HTML file, every model and
 *                             texture inlined, for sharing a look without a server
 */
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: single ? [viteSingleFile()] : [],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      assetsInlineLimit: single ? Number.MAX_SAFE_INTEGER : 0,
      chunkSizeWarningLimit: 20_000,
    },
    server: { port: 5174 },
  };
});
