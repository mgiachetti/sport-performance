import { STAGES } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { categoryReportMessagesEsAR } from './category-report.js';
import { esAR, isMessageKey } from './index.js';

describe('category report messages (B-603)', () => {
  it('are part of the source catalog under `categoryReport.`', () => {
    for (const [key, message] of Object.entries(categoryReportMessagesEsAR)) {
      expect(key.startsWith('categoryReport.'), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every stage and sex the report shows', () => {
    for (const stage of STAGES)
      expect(isMessageKey(`categoryReport.stage.${stage}`), stage).toBe(true);
    for (const sex of ['male', 'female']) expect(isMessageKey(`sex.${sex}`), sex).toBe(true);
  });

  it('never call an injury by its name', () => {
    for (const message of Object.values(categoryReportMessagesEsAR)) {
      expect(message.toLowerCase()).not.toMatch(/lesi[oó]n|lesionad/);
    }
  });
});
