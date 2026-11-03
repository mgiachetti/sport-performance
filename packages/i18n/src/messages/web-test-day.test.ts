import {
  CANONICAL_TEST_CODES,
  E1RM_SET_ISSUES,
  TEST_NOT_DONE_REASONS,
  canonicalMetricsOfTest,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { webTestDayMessagesEsAR } from './web-test-day.js';

describe('test day messages', () => {
  it('are part of the source catalog under their own prefix', () => {
    for (const [key, message] of Object.entries(webTestDayMessagesEsAR)) {
      expect(key.startsWith('testDay.'), key).toBe(true);
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every metric a station shows, every reason and every protocol issue', () => {
    for (const test of CANONICAL_TEST_CODES.filter((code) => code !== 'anthro')) {
      for (const code of canonicalMetricsOfTest(test)) {
        expect(isMessageKey(`testDay.metric.${code}`), code).toBe(true);
      }
    }
    for (const reason of [...TEST_NOT_DONE_REASONS, 'unavailable']) {
      expect(isMessageKey(`testDay.reason.${reason}`), reason).toBe(true);
    }
    for (const issue of E1RM_SET_ISSUES) {
      expect(isMessageKey(`testDay.protocolIssue.${issue}`), issue).toBe(true);
    }
  });
});
