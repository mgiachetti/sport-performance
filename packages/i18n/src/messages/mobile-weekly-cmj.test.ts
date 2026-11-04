import { describe, expect, it } from 'vitest';
import { createTranslator } from '../translator.js';
import { esAR, isMessageKey } from './index.js';
import { mobileWeeklyCmjMessagesEsAR } from './mobile-weekly-cmj.js';

describe('weekly CMJ messages (B-506)', () => {
  it('are part of the source catalog and no other entry overrides them', () => {
    for (const [key, message] of Object.entries(mobileWeeklyCmjMessagesEsAR)) {
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('say the protocol, the baseline and who is left out in Spanish (vos)', () => {
    const { t } = createTranslator();
    expect(t('weeklyCmj.protocol', { version: 1, count: 3, aggregation: 'best' })).toBe(
      'Protocolo v1: 3 intentos, vale el mejor.',
    );
    expect(t('weeklyCmj.baseline', { height: '41,0 cm', count: 4, weeks: 6 })).toBe(
      'Base: 41,0 cm (4 días en 6 semanas)',
    );
    expect(t('weeklyCmj.baseline.none', { samples: 1, min: 3 })).toBe(
      'Sin base todavía: 1 de 3 días con el mismo método.',
    );
    expect(t('weeklyCmj.roster.otherStages', { count: 1 })).toBe(
      '1 jugador de otra etapa no hace CMJ semanal.',
    );
  });
});
