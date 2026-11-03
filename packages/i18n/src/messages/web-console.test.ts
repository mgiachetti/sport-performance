import { CLUB_MODULES } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '../locale.js';
import { esAR, isMessageKey } from './index.js';
import { webConsoleMessagesEsAR } from './web-console.js';

describe('superadmin console messages', () => {
  it('are part of the source catalog and no other entry overrides them', () => {
    for (const [key, message] of Object.entries(webConsoleMessagesEsAR)) {
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('use only their own namespaces', () => {
    for (const key of Object.keys(webConsoleMessagesEsAR)) {
      expect(key, key).toMatch(/^(console|supportAccess)\./);
    }
  });

  it('name every module of the club and every supported locale', () => {
    for (const module of CLUB_MODULES) {
      expect(isMessageKey(`console.module.${module}`), module).toBe(true);
    }
    for (const locale of SUPPORTED_LOCALES) {
      expect(isMessageKey(`console.locale.${locale.replace('-', '_')}`), locale).toBe(true);
    }
  });
});
