import { DEFAULT_CLUB_TIME_ZONE } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import * as i18n from './index.js';

describe('@sport-performance/i18n public API', () => {
  it('exposes its package name', () => {
    expect(i18n.packageName).toBe('@sport-performance/i18n');
  });

  it('exports the translator, catalog tools and formatters', () => {
    for (const name of [
      'createTranslator',
      'resolveLocale',
      'parseAcceptLanguage',
      'validateCatalog',
      'formatNumber',
      'parseNumber',
      'formatUnit',
      'formatDuration',
      'formatDate',
      'formatTime',
      'formatDateTime',
      'formatDateLong',
      'formatLocalDate',
      'formatLocalDateLong',
      'unitLabelEsAr',
    ] as const) {
      expect(typeof i18n[name], name).toBe('function');
    }
  });

  it('works end to end from the entry point', () => {
    const { t } = i18n.createTranslator({ locale: i18n.resolveLocale('es-AR') });
    const when = i18n.formatDate(Date.UTC(2026, 1, 10, 12), {
      timeZone: DEFAULT_CLUB_TIME_ZONE,
    });
    expect(t('sync.lastSynced', { dateTime: when })).toBe('Última sincronización: 10/02/2026');
  });
});
