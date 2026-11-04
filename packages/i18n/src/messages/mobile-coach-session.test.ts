import { EXPOSURE_CONTEXTS, PARTICIPATION_STATUSES } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../translator.js';
import { esAR, isMessageKey } from './index.js';
import { mobileCoachSessionMessagesEsAR } from './mobile-coach-session.js';

describe('coach session messages', () => {
  it('are part of the source catalog under coachSession.*', () => {
    for (const [key, message] of Object.entries(mobileCoachSessionMessagesEsAR)) {
      expect(key, key).toMatch(/^coachSession\./);
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every participation status and session kind', () => {
    for (const status of PARTICIPATION_STATUSES) {
      expect(isMessageKey(`coachSession.status.${status}`), status).toBe(true);
    }
    for (const kind of EXPOSURE_CONTEXTS) {
      expect(isMessageKey(`coachSession.kind.${kind}`), kind).toBe(true);
    }
  });

  it('format counts in Spanish', () => {
    const { t } = createTranslator();
    expect(t('coachSession.save', { count: 0 })).toBe('Guardar');
    expect(t('coachSession.save', { count: 1 })).toBe('Guardar 1 jugador');
    expect(t('coachSession.save', { count: 12 })).toBe('Guardar 12 jugadores');
    expect(t('coachSession.clock.onField', { count: 0 })).toBe('Nadie en cancha');
    expect(t('coachSession.clock.onField', { count: 15 })).toBe('15 en cancha');
  });
});
