import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Hermes on Android has no `Intl.PluralRules` nor `Intl.Locale`, and its
 * `DateTimeFormat` lacks `formatToParts`/`formatRange`: an ICU plural message
 * threw and closed the app on the sign-in code screen. Here Node's Intl is
 * stripped the same way before loading the polyfills and the code that formats.
 */
beforeAll(() => {
  Reflect.deleteProperty(Intl, 'PluralRules');
  Reflect.deleteProperty(Intl, 'Locale');
  Reflect.deleteProperty(Intl.DateTimeFormat.prototype, 'formatRange');
  Reflect.deleteProperty(Intl.DateTimeFormat.prototype, 'formatToParts');
});

async function load() {
  const intl = await import('./intl.ts');
  const i18n = await import('@sport-performance/i18n');
  const domain = await import('@sport-performance/domain');
  return { intl, i18n, domain };
}

describe('Intl polyfills for Hermes', () => {
  it('formats ICU plural messages', async () => {
    const { i18n } = await load();
    expect(typeof Intl.PluralRules).toBe('function');
    const { t } = i18n.createTranslator();
    expect(t('auth.otp.expiresIn', { minutes: 1 })).toContain('1 minuto ');
    expect(t('auth.otp.expiresIn', { minutes: 10 })).toContain('10 minutos');
  });

  it('computes the day in the club zone with formatToParts', async () => {
    const { domain } = await load();
    expect(typeof Intl.DateTimeFormat.prototype.formatToParts).toBe('function');
    const zone = domain.parseTimeZone('America/Argentina/Buenos_Aires');
    // 01:30 UTC is still the previous day in Buenos Aires (UTC−3).
    expect(domain.localDateInTimeZone(Date.UTC(2026, 10, 6, 1, 30), zone)).toBe('2026-11-05');
  });

  it('defaults the polyfilled DateTimeFormat to the phone zone', async () => {
    const { intl } = await load();
    intl.setDefaultTimeZone('America/Argentina/Cordoba');
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Argentina/Cordoba');
    intl.setDefaultTimeZone('Not/AZone');
    intl.setDefaultTimeZone(null);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Argentina/Cordoba');
  });
});
