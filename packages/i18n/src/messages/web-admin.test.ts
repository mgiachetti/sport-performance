import {
  GUARDIAN_RELATIONSHIPS,
  ROSTER_GUARDIAN_OUTCOMES,
  ROSTER_IMPORT_ACTIONS,
  ROSTER_MATCH_REASONS,
  ROSTER_ROW_ISSUE_CODES,
  ROSTER_TABLE_ISSUE_CODES,
  SEASON_ROLLOVER_OUTCOMES,
  SEASON_ROLLOVER_PROPOSALS,
  SEASON_ROLLOVER_STATUSES,
  STAFF_ASSIGNMENT_STATUSES,
  STAGES,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { webAdminMessagesEsAR } from './web-admin.js';

describe('administration messages', () => {
  it('are part of the source catalog under their own prefix', () => {
    for (const [key, message] of Object.entries(webAdminMessagesEsAR)) {
      expect(key, key).toMatch(/^admin\./);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every code the screens show', () => {
    const families: [string, readonly string[]][] = [
      ['admin.guardian', GUARDIAN_RELATIONSHIPS],
      ['admin.stage', STAGES],
      ['admin.assignments.status', STAFF_ASSIGNMENT_STATUSES],
      ['admin.rollover.status', SEASON_ROLLOVER_STATUSES],
      ['admin.rollover.proposal', SEASON_ROLLOVER_PROPOSALS],
      ['admin.rollover.outcome', SEASON_ROLLOVER_OUTCOMES],
      ['admin.roster.action', ROSTER_IMPORT_ACTIONS],
      ['admin.roster.guardian', ROSTER_GUARDIAN_OUTCOMES],
      ['admin.roster.reason', ROSTER_MATCH_REASONS],
      ['admin.roster.issue', ROSTER_ROW_ISSUE_CODES],
      ['admin.roster.sheet', ROSTER_TABLE_ISSUE_CODES],
    ];
    for (const [prefix, codes] of families) {
      for (const code of codes)
        expect(isMessageKey(`${prefix}.${code}`), `${prefix}.${code}`).toBe(true);
    }
  });
});
