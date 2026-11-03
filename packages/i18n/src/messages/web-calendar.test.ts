import {
  FIXTURE_STATUSES,
  FIXTURE_VENUES,
  TEST_SESSION_STATUSES,
  type TestWindowProblem,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { webCalendarMessagesEsAR } from './web-calendar.js';

describe('season calendar messages', () => {
  it('are part of the source catalog under their own prefix', () => {
    for (const [key, message] of Object.entries(webCalendarMessagesEsAR)) {
      expect(key, key).toMatch(/^calendar\./);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every status and venue of the calendar', () => {
    for (const status of TEST_SESSION_STATUSES) {
      expect(isMessageKey(`calendar.testSession.status.${status}`), status).toBe(true);
    }
    for (const status of FIXTURE_STATUSES) {
      expect(isMessageKey(`calendar.fixture.status.${status}`), status).toBe(true);
    }
    for (const venue of FIXTURE_VENUES) {
      expect(isMessageKey(`calendar.fixture.venue.${venue}`), venue).toBe(true);
    }
  });

  it('explain every problem of a testing window and every weekday', () => {
    const kinds: readonly TestWindowProblem['kind'][] = [
      'ends_before_start',
      'outside_season',
      'duplicate_number',
      'overlaps',
      'out_of_order',
    ];
    for (const kind of kinds) {
      expect(isMessageKey(`calendar.window.problem.${kind}`), kind).toBe(true);
    }
    for (let day = 1; day <= 7; day += 1) {
      expect(isMessageKey(`calendar.weekday.${String(day)}`)).toBe(true);
      expect(isMessageKey(`calendar.weekdayShort.${String(day)}`)).toBe(true);
    }
  });
});
