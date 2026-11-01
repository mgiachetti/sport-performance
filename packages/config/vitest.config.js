import { defineConfig, mergeConfig } from 'vitest/config';
import preset from './vitest.js';

export default mergeConfig(preset, defineConfig({ test: { include: ['test/**/*.test.ts'] } }));
