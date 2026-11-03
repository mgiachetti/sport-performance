import { createTranslator } from '@sport-performance/i18n';
import { describe, expect, it } from 'vitest';
import { alertText, formatAlertValue } from './alert-text';

const { t } = createTranslator({ locale: 'es-AR' });

describe('alert text', () => {
  it('formats each value es-AR with its unit before interpolating', () => {
    expect(formatAlertValue('acwrRatio', 1.456)).toBe('1,46');
    expect(formatAlertValue('zScore', -2.04)).toBe('-2,0');
    expect(formatAlertValue('dropPct', 8.25)).toBe('8,3 %');
    expect(formatAlertValue('historyDays', 40)).toBe('40');
    expect(
      alertText(t, {
        messageKey: 'alert.cmj_drop.message',
        values: { dropPct: 8.2, heightCm: 33.04, baselineHeightCm: 36 },
      }),
    ).toBe('CMJ 8,2 % por debajo de la base: 33,0 cm contra 36,0 cm.');
  });

  it('gives up on a key this build does not know', () => {
    expect(alertText(t, { messageKey: 'alert.future_kind.message', values: {} })).toBeNull();
  });
});
