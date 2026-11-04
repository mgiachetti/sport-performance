import { describe, expect, it } from 'vitest';
import { createTranslator } from '../translator.js';
import { NBSP } from './number.js';
import { alertMessage, formatAlertValue } from './alert.js';

const { t } = createTranslator({ locale: 'es-AR' });

describe('alert texts (shared by the web and the app)', () => {
  it('formats each value es-AR with its unit before interpolating', () => {
    expect(formatAlertValue('acwrRatio', 1.456)).toBe('1,46');
    expect(formatAlertValue('zScore', -2.04)).toBe('-2,0');
    expect(formatAlertValue('historyDays', 40)).toBe('40');
    expect(
      alertMessage(t, 'alert.cmj_drop.message', {
        dropPct: 8.2,
        heightCm: 33.04,
        baselineHeightCm: 36,
      }),
    ).toBe(`CMJ 8,2${NBSP}% por debajo de la base: 33,0${NBSP}cm contra 36,0${NBSP}cm.`);
  });

  it('formats a suggestion, which has no values', () => {
    expect(alertMessage(t, 'alert.growth_peak.suggestion')).toContain('rodilla y talón');
  });

  it('gives up on a key this build does not know, or values that do not fit it', () => {
    expect(alertMessage(t, 'alert.future_kind.message', {})).toBeNull();
    expect(alertMessage(t, 'alert.acwr_high.message', { acwrRatio: 1.5 })).toBeNull();
  });
});
