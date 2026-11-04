import {
  MENARCHE_DATE_PRECISIONS,
  MENARCHE_OFFSET_VERDICTS,
  MENARCHE_REPORTERS,
  MENARCHE_REPORT_PROBLEMS,
  MENARCHE_STATUSES,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { menarcheMessagesEsAR } from './menarche.js';

describe('menarche messages (B-805)', () => {
  it('are part of the source catalog under their own namespace', () => {
    for (const [key, message] of Object.entries(menarcheMessagesEsAR)) {
      expect(key, key).toMatch(/^menarche\./);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every status, precision, reporter, problem and verdict of the domain', () => {
    const keys = [
      ...MENARCHE_STATUSES.map((v) => `menarche.status.${v}`),
      ...MENARCHE_DATE_PRECISIONS.map((v) => `menarche.precision.${v}`),
      ...MENARCHE_REPORTERS.map((v) => `menarche.reportedBy.${v}`),
      ...MENARCHE_REPORT_PROBLEMS.map((v) => `menarche.problem.${v}`),
      ...MENARCHE_OFFSET_VERDICTS.map((v) => `menarche.check.verdict.${v}`),
    ];
    for (const key of keys) expect(isMessageKey(key), key).toBe(true);
  });
});
