import {
  COEFFICIENT_VERIFICATION_STATUSES,
  MATURATION_GAPS,
  MATURITY_OFFSET_EQUATIONS,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { anthropometryMessagesEsAR } from './anthropometry.js';
import { mobileAnthropometryMessagesEsAR } from './mobile-anthropometry.js';

describe('anthropometry messages of the staff web and the field sheet', () => {
  it('are part of the source catalog under their own namespace', () => {
    for (const [key, message] of Object.entries({
      ...anthropometryMessagesEsAR,
      ...mobileAnthropometryMessagesEsAR,
    })) {
      expect(key, key).toMatch(/^anthropometry\./);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every maturation gap, maturity-offset equation and verification status', () => {
    for (const gap of MATURATION_GAPS) {
      expect(isMessageKey(`anthropometry.gap.${gap}`), gap).toBe(true);
    }
    for (const equation of MATURITY_OFFSET_EQUATIONS) {
      expect(isMessageKey(`anthropometry.equation.${equation}`), equation).toBe(true);
    }
    for (const status of COEFFICIENT_VERIFICATION_STATUSES) {
      expect(isMessageKey(`anthropometry.verification.status.${status}`), status).toBe(true);
    }
  });
});
