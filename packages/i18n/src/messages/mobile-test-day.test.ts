import { describe, expect, it } from 'vitest';
import { createTranslator } from '../translator.js';
import { esAR, isMessageKey } from './index.js';
import { mobileTestDayMessagesEsAR } from './mobile-test-day.js';

describe('field test day messages', () => {
  it('are part of the source catalog under their own prefix', () => {
    for (const [key, message] of Object.entries(mobileTestDayMessagesEsAR)) {
      expect(key.startsWith('fieldTest.'), key).toBe(true);
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('format counts in Spanish', () => {
    const { t } = createTranslator();
    expect(t('fieldTest.player.summary', { count: 0 })).toBe('Sin intentos');
    expect(t('fieldTest.player.summary', { count: 1 })).toBe('1 intento');
    expect(t('fieldTest.notApplicable.all', { count: 3 })).toBe(
      'Registrar 3 jugadores como «No corresponde a la etapa»',
    );
  });
});
