import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createConfig } from '../eslint.js';
import preset from '../vitest.js';

const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

describe('tsconfig/base.json', () => {
  it('enables the strict flags the project relies on', () => {
    const base = readJson('../tsconfig/base.json') as { compilerOptions: Record<string, unknown> };
    expect(base.compilerOptions).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true,
      isolatedModules: true,
    });
  });
});

describe('createConfig', () => {
  it('returns a flat config that ignores build output and points at the package tsconfig', () => {
    const config = createConfig({ tsconfigRootDir: '/repo/packages/x' });
    expect(config.some((entry) => entry.ignores?.includes('dist/**'))).toBe(true);
    const withParser = config.find(
      (entry) =>
        (entry.languageOptions?.parserOptions as { tsconfigRootDir?: string } | undefined)
          ?.tsconfigRootDir === '/repo/packages/x',
    );
    expect(withParser).toBeDefined();
  });

  it('uses browser globals when asked', () => {
    const config = createConfig({ tsconfigRootDir: '/x', browser: true });
    const globals = config.find((entry) => entry.languageOptions?.globals)?.languageOptions
      ?.globals as Record<string, unknown>;
    expect(globals).toHaveProperty('window');
    expect(globals).not.toHaveProperty('process');
  });
});

describe('vitest preset', () => {
  it('collects co-located *.test.ts files and fails when none exist', () => {
    expect(preset.test?.include).toContain('src/**/*.test.ts');
    expect(preset.test?.passWithNoTests).toBe(false);
  });

  it('gives tests room for a loaded runner without hiding hangs', () => {
    expect(preset.test?.testTimeout).toBe(30_000);
    expect(preset.test?.hookTimeout).toBe(60_000);
  });
});
