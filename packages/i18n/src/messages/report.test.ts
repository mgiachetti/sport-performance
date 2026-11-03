import {
  MATURITY_OFFSET_EQUATIONS,
  SPORTS,
  TEST_COMPARISON_WARNINGS,
  TEST_NOT_DONE_REASONS,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { reportMessagesEsAR } from './report.js';

describe('player report messages (B-602)', () => {
  it('are part of the source catalog under `report.`', () => {
    for (const [key, message] of Object.entries(reportMessagesEsAR)) {
      expect(key.startsWith('report.'), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every not-done reason, comparison warning, sport and equation the report shows', () => {
    for (const reason of [...TEST_NOT_DONE_REASONS, 'unavailable']) {
      expect(isMessageKey(`report.notDone.reason.${reason}`), reason).toBe(true);
    }
    for (const warning of TEST_COMPARISON_WARNINGS) {
      expect(isMessageKey(`report.warning.${warning}`), warning).toBe(true);
    }
    for (const sport of SPORTS) expect(isMessageKey(`sport.${sport}`), sport).toBe(true);
    for (const equation of MATURITY_OFFSET_EQUATIONS) {
      expect(isMessageKey(`player.maturation.equation.${equation}`), equation).toBe(true);
    }
  });

  it('never call an injury by its name', () => {
    expect(reportMessagesEsAR['report.notDone.reason.injured']).toBe(
      reportMessagesEsAR['report.notDone.reason.unavailable'],
    );
    for (const message of Object.values(reportMessagesEsAR)) {
      expect(message.toLowerCase()).not.toMatch(/lesi[oó]n|lesionad/);
    }
  });
});
