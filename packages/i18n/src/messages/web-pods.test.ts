import { CONSENT_TYPES, POD_STATUSES } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { webPodsMessagesEsAR } from './web-pods.js';

describe('pod messages', () => {
  it('are part of the source catalog under their own prefix', () => {
    for (const [key, message] of Object.entries(webPodsMessagesEsAR)) {
      expect(key, key).toMatch(/^pods\./);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every status of a pod and every consent a player may miss', () => {
    for (const status of POD_STATUSES) {
      expect(isMessageKey(`pods.status.${status}`), status).toBe(true);
    }
    for (const type of CONSENT_TYPES) {
      expect(isMessageKey(`pods.session.missing.${type}`), type).toBe(true);
    }
  });

  it('explain every conflict of an assignment', () => {
    for (const code of [
      'pod_overlap',
      'player_overlap',
      'pod_not_active',
      'category_not_enabled',
      'consent_required',
    ]) {
      expect(isMessageKey(`pods.error.${code}`), code).toBe(true);
    }
  });
});
