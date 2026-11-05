import { USAGE_CLIENTS, USAGE_SURFACES } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { webUsageMessagesEsAR } from './web-usage.js';

describe('usage metrics messages', () => {
  it('are part of the source catalog and no other entry overrides them', () => {
    for (const [key, message] of Object.entries(webUsageMessagesEsAR)) {
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('use only their own namespace', () => {
    for (const key of Object.keys(webUsageMessagesEsAR)) {
      expect(key, key).toMatch(/^usage\./);
    }
  });

  it('name every surface and client of the domain', () => {
    for (const surface of USAGE_SURFACES) {
      expect(isMessageKey(`usage.surface.${surface}`), surface).toBe(true);
    }
    for (const client of USAGE_CLIENTS) {
      expect(isMessageKey(`usage.client.${client}`), client).toBe(true);
    }
  });
});
