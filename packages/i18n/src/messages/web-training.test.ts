import {
  AVAILABILITY_STATUSES,
  CONTACT_LEVELS,
  EXPOSURE_CONTEXTS,
  PARTICIPATION_STATUSES,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { webTrainingMessagesEsAR } from './web-training.js';

describe('training screen messages', () => {
  it('are part of the source catalog under training.*, and nothing overrides them', () => {
    for (const [key, message] of Object.entries(webTrainingMessagesEsAR)) {
      expect(key, key).toMatch(/^training\./);
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every session kind, contact level, participation and availability status', () => {
    for (const kind of EXPOSURE_CONTEXTS) expect(isMessageKey(`training.kind.${kind}`)).toBe(true);
    for (const level of CONTACT_LEVELS) {
      expect(isMessageKey(`training.contact.${level}`), level).toBe(true);
    }
    for (const status of PARTICIPATION_STATUSES) {
      expect(isMessageKey(`training.status.${status}`), status).toBe(true);
    }
    for (const status of AVAILABILITY_STATUSES) {
      expect(isMessageKey(`training.availability.${status}`), status).toBe(true);
    }
  });
});
