import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The screen gallery (`pnpm gallery`): the presentational screens of
 * `src/screens` rendered with fixture props through `react-native-web`, the
 * same renderer as the component tests, to look at the design at a phone size
 * without a simulator or an API. Not shipped: the app is built by Metro.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [{ find: /^react-native$/, replacement: 'react-native-web' }],
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.mjs', '.js', '.json'],
  },
  define: { __DEV__: 'true', 'process.env.NODE_ENV': '"development"' },
  // The ORC crest, as the demo club serves it (`assets/clubs/orc/escudo.png`).
  publicDir: fileURLToPath(new URL('../../../assets/clubs/orc', import.meta.url)),
  server: { port: Number(process.env.GALLERY_PORT ?? 4310), strictPort: true },
  preview: { port: Number(process.env.GALLERY_PORT ?? 4310), strictPort: true },
  build: { outDir: fileURLToPath(new URL('../.gallery', import.meta.url)), emptyOutDir: true },
});
