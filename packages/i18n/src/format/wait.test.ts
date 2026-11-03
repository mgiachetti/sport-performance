import { describe, expect, it } from 'vitest';
import { createTranslator } from '../translator.js';
import { retryWaitValues } from './wait.js';

describe('retryWaitValues', () => {
  it('keeps seconds under a minute and rounds minutes up', () => {
    expect(retryWaitValues(0)).toEqual({ unit: 'seconds', amount: 1 });
    expect(retryWaitValues(1)).toEqual({ unit: 'seconds', amount: 1 });
    expect(retryWaitValues(42)).toEqual({ unit: 'seconds', amount: 42 });
    expect(retryWaitValues(58.2)).toEqual({ unit: 'seconds', amount: 59 });
    expect(retryWaitValues(59.2)).toEqual({ unit: 'minutes', amount: 1 });
    expect(retryWaitValues(60)).toEqual({ unit: 'minutes', amount: 1 });
    expect(retryWaitValues(61)).toEqual({ unit: 'minutes', amount: 2 });
    expect(retryWaitValues(900)).toEqual({ unit: 'minutes', amount: 15 });
  });

  it('falls back to a minute for a wait that is not a number', () => {
    expect(retryWaitValues(Number.NaN)).toEqual({ unit: 'minutes', amount: 1 });
  });

  it('feeds auth.rateLimitedFor', () => {
    const { t } = createTranslator();
    expect(t('auth.rateLimitedFor', retryWaitValues(1))).toBe(
      'Hiciste muchos intentos seguidos. Probá de nuevo en 1 segundo.',
    );
    expect(t('auth.rateLimitedFor', retryWaitValues(42))).toBe(
      'Hiciste muchos intentos seguidos. Probá de nuevo en 42 segundos.',
    );
    expect(t('auth.rateLimitedFor', retryWaitValues(60))).toBe(
      'Hiciste muchos intentos seguidos. Probá de nuevo en 1 minuto.',
    );
    expect(t('auth.rateLimitedFor', retryWaitValues(900))).toBe(
      'Hiciste muchos intentos seguidos. Probá de nuevo en 15 minutos.',
    );
  });
});
