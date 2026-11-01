import { DEFAULT_CLUB_TIME_ZONE } from '@sport-performance/domain';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { formatUnit } from './format/unit.js';
import { formatDateTime } from './format/date.js';
import { NBSP } from './format/number.js';
import type { MessageKey } from './messages/index.js';
import { MessageFormatError, createTranslator } from './translator.js';

describe('createTranslator', () => {
  const { t, locale } = createTranslator();

  it('defaults to es-AR', () => {
    expect(locale).toBe('es-AR');
  });

  it('formats plain messages', () => {
    expect(t('common.save')).toBe('Guardar');
    expect(t('status.insufficientHistory')).toBe('Historia insuficiente');
  });

  it('interpolates arguments', () => {
    expect(t('common.category', { name: 'M15' })).toBe('Categoría M15');
    expect(t('error.validation.range', { min: '1,00', max: '10,00' })).toBe(
      'Ingresá un valor entre 1,00 y 10,00.',
    );
  });

  it('selects plural forms and formats numbers es-AR', () => {
    expect(t('sync.pending', { count: 0 })).toBe('Nada pendiente de envío');
    expect(t('sync.pending', { count: 1 })).toBe('1 cambio sin enviar');
    expect(t('sync.pending', { count: 1234 })).toBe('1.234 cambios sin enviar');
    expect(t('duration.years', { count: 1.5 })).toBe('1,5 años');
    expect(t('status.insufficientHistoryDetail', { days: 28 })).toBe(
      'Hacen falta al menos 28 días de carga para calcular este indicador.',
    );
  });

  it('takes pre-formatted dates and measures', () => {
    const dateTime = formatDateTime(Date.UTC(2026, 2, 3, 21, 5), {
      timeZone: DEFAULT_CLUB_TIME_ZONE,
    });
    expect(t('sync.lastSynced', { dateTime })).toBe('Última sincronización: 03/03/2026 18:05');
    expect(t('rpe.sessionLoad', { load: formatUnit(420, 'au') })).toBe(
      `Carga de la sesión: 420${NBSP}UA`,
    );
  });

  it('throws a MessageFormatError naming the key when a value is missing', () => {
    // Bypass the compile-time check on purpose.
    const loose = t as (key: MessageKey, values?: Record<string, string | number>) => string;
    expect(() => loose('common.category', {})).toThrow(MessageFormatError);
    expect(() => loose('common.category')).toThrow(/common\.category/);
    try {
      loose('common.category');
    } catch (error) {
      expect(error).toBeInstanceOf(MessageFormatError);
      expect((error as MessageFormatError).key).toBe('common.category');
      expect((error as MessageFormatError).locale).toBe('es-AR');
      expect((error as MessageFormatError).cause).toBeDefined();
    }
  });

  it('returns the same text on repeated calls (cached formatters)', () => {
    expect(t('sync.pending', { count: 2 })).toBe(t('sync.pending', { count: 2 }));
  });

  it('enforces keys and arguments at compile time', () => {
    expectTypeOf(t).toBeFunction();
    // @ts-expect-error unknown key
    expect(() => t('common.nope')).toThrow();
    // @ts-expect-error message with arguments requires values
    expect(() => t('common.category')).toThrow();
    // @ts-expect-error message without arguments takes no values
    expect(t('common.save', { x: 1 })).toBe('Guardar');
  });
});

describe('club overrides', () => {
  it('replace messages per key and fall back to the catalog', () => {
    const { t } = createTranslator({
      overrides: { 'role.coach': 'Coach', 'common.category': 'División {name}' },
    });
    expect(t('role.coach')).toBe('Coach');
    expect(t('common.category', { name: 'M17' })).toBe('División M17');
    expect(t('role.sc')).toBe('Preparador/a físico/a');
  });

  it('do not leak between translators', () => {
    createTranslator({ overrides: { 'role.coach': 'Coach' } });
    expect(createTranslator().t('role.coach')).toBe('Entrenador/a');
  });
});
