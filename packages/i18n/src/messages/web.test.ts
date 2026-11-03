import { SEXES, SPORTS } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { webMessagesEsAR } from './web.js';

describe('staff web messages', () => {
  it('are part of the source catalog and no other entry overrides them', () => {
    for (const [key, message] of Object.entries(webMessagesEsAR)) {
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every sport and sex of the model', () => {
    for (const sport of SPORTS) expect(isMessageKey(`sport.${sport}`), sport).toBe(true);
    for (const sex of SEXES) expect(isMessageKey(`sex.${sex}`), sex).toBe(true);
  });
});
