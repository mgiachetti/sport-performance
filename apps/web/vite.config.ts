import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Staff web (ADR 0012, ADR 0056): a static SPA. `VITE_API_URL` is the only
 * build-time variable (see `.env.example`); `src/env.ts` validates it at startup.
 */
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2023',
    sourcemap: true,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: a deploy that only changes the app keeps them cached.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'tanstack', test: /node_modules[\\/]@tanstack[\\/]/ },
            {
              name: 'contracts',
              test: /node_modules[\\/](zod|@sport-performance)[\\/]|packages[\\/]/,
            },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
});
