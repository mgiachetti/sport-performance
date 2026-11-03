import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { esAR, sourceMessageFiles } from './es-AR.js';

/** Key → the files that define it. */
function filesByKey(files: Readonly<Record<string, Readonly<Record<string, string>>>>) {
  const byKey = new Map<string, string[]>();
  for (const [file, messages] of Object.entries(files)) {
    for (const key of Object.keys(messages)) byKey.set(key, [...(byKey.get(key) ?? []), file]);
  }
  return byKey;
}

function duplicatedKeys(files: Readonly<Record<string, Readonly<Record<string, string>>>>) {
  return [...filesByKey(files)]
    .filter(([, inFiles]) => inFiles.length > 1)
    .map(([key, inFiles]) => `${key} (${inFiles.join(', ')})`);
}

describe('message files of the source catalog', () => {
  it('define every key in exactly one file', () => {
    expect(duplicatedKeys(sourceMessageFiles)).toEqual([]);
  });

  it('lose no key when merged', () => {
    const total = Object.values(sourceMessageFiles).reduce(
      (sum, messages) => sum + Object.keys(messages).length,
      0,
    );
    expect(Object.keys(esAR)).toHaveLength(total);
    for (const messages of Object.values(sourceMessageFiles)) {
      for (const [key, message] of Object.entries(messages)) {
        expect(esAR[key as keyof typeof esAR], key).toBe(message);
      }
    }
  });

  it('list every message file of the folder', () => {
    const messageFiles = readdirSync(new URL('.', import.meta.url))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) => name !== 'index.ts' && name !== 'validate.ts')
      .sort();
    expect(Object.keys(sourceMessageFiles).sort()).toEqual(messageFiles);
  });

  it('catch a key defined twice', () => {
    expect(
      duplicatedKeys({
        'a.ts': { 'nav.home': 'Inicio', 'a.only': 'A' },
        'b.ts': { 'nav.home': 'Inicio', 'b.only': 'B' },
      }),
    ).toEqual(['nav.home (a.ts, b.ts)']);
  });
});
