import {
  AVAILABILITY_STATUSES,
  CANONICAL_METRICS,
  MATURITY_OFFSET_EQUATIONS,
  STAGES,
  STAGE_BASES,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { webPlayerMessagesEsAR } from './web-player.js';
import { webMessagesEsAR } from './web.js';

describe('player profile messages (B-404)', () => {
  it('are part of the source catalog and no other entry overrides them', () => {
    for (const [key, message] of Object.entries(webPlayerMessagesEsAR)) {
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
      expect(Object.hasOwn(webMessagesEsAR, key), key).toBe(false);
    }
  });

  it('name every stage, availability status and maturity equation', () => {
    for (const stage of STAGES) expect(isMessageKey(`player.stage.${stage}`), stage).toBe(true);
    for (const basis of STAGE_BASES) {
      expect(isMessageKey(`player.stage.basis.${basis}`), basis).toBe(true);
    }
    for (const status of AVAILABILITY_STATUSES) {
      expect(isMessageKey(`player.availability.status.${status}`), status).toBe(true);
    }
    for (const equation of MATURITY_OFFSET_EQUATIONS) {
      expect(isMessageKey(`player.maturation.equation.${equation}`), equation).toBe(true);
    }
  });

  it('name every test metric of the dictionary but anthropometry', () => {
    const metrics = Object.entries(CANONICAL_METRICS)
      .filter(([, m]) => m.source === 'test' && m.test !== 'anthro')
      .map(([code]) => code);
    expect(metrics.length).toBeGreaterThan(0);
    for (const code of metrics) expect(isMessageKey(`player.metric.${code}`), code).toBe(true);
  });
});
