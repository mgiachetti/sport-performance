import preset from '@sport-performance/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

// railway.ts sits at the root of the folder (where the Railway CLI looks for it): tests in test/.
export default mergeConfig(preset, defineConfig({ test: { include: ['test/**/*.test.ts'] } }));
