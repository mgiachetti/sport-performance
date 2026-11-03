import { NOTIFICATION_KINDS } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../translator.js';
import { isMessageKey, messageKeys } from './index.js';

describe('notification texts (B-328)', () => {
  it('has a title and a body for every kind, and nothing else under notification.', () => {
    const expected: string[] = NOTIFICATION_KINDS.flatMap((kind) => [
      `notification.${kind}.title`,
      `notification.${kind}.body`,
    ]);
    for (const key of expected) expect(isMessageKey(key), key).toBe(true);
    const extra = messageKeys.filter(
      (key) => key.startsWith('notification.') && !expected.includes(key),
    );
    expect(extra).toEqual(['notification.pre_training_summary.bodyWithoutWellness']);
  });

  it('formats every text with the arguments the worker passes', () => {
    const { t } = createTranslator();
    expect(t('notification.rpe_request.body', { session: 'match' })).toContain('partido');
    expect(t('notification.rpe_reminder.body', { session: 'training' })).toContain('entrenamiento');
    expect(t('notification.critical_alert.title', { categoryName: 'M17' })).toBe(
      'Alerta crítica en M17',
    );
    expect(
      t('notification.pre_training_summary.body', {
        time: '18:00',
        critical: 0,
        warning: 2,
        wellnessSubmitted: 12,
        players: 20,
      }),
    ).toBe(
      'A las 18:00. Jugadores con alertas abiertas: ninguno en crítico y 2 en atención. Bienestar cargado: 12 de 20.',
    );
    expect(
      t('notification.pre_training_summary.bodyWithoutWellness', {
        time: '18:00',
        critical: 1,
        warning: 0,
      }),
    ).toBe('A las 18:00. Jugadores con alertas abiertas: 1 en crítico y ninguno en atención.');
  });
});
