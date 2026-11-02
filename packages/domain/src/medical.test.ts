import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_STATUSES,
  CONCUSSION_GRTP_STAGES,
  concussionAvailability,
  notDoneReasonForViewer,
  parseAvailabilityStatus,
  worstAvailability,
} from './medical.js';
import { ROLES } from './role.js';
import { TEST_NOT_DONE_REASONS } from './test-result.js';

describe('availability', () => {
  it('is ordered from best to worst', () => {
    expect(AVAILABILITY_STATUSES).toEqual(['available', 'limited', 'unavailable']);
  });

  it('takes the worst status, available when there is none', () => {
    expect(worstAvailability([])).toBe('available');
    expect(worstAvailability(['limited', 'available'])).toBe('limited');
    expect(worstAvailability(['limited', 'unavailable', 'available'])).toBe('unavailable');
  });

  it('parses only known statuses', () => {
    expect(parseAvailabilityStatus('limited')).toBe('limited');
    expect(() => parseAvailabilityStatus('injured')).toThrow(/availability status/);
  });
});

describe('graduated return to play after a concussion', () => {
  it('has six stages, the last one being the clearance', () => {
    expect(CONCUSSION_GRTP_STAGES.map((s) => s.stage)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(CONCUSSION_GRTP_STAGES.at(-1)?.code).toBe('return_to_play');
  });

  it('is never available for a match until cleared', () => {
    for (const stage of [1, 2, 3, 4, 5]) {
      expect(concussionAvailability({ stage, outcome: 'passed' }, false).match).toBe('unavailable');
    }
    expect(concussionAvailability({ stage: 5, outcome: 'passed' }, true)).toEqual({
      training: 'available',
      match: 'available',
    });
  });

  it('rests without a stage or when symptoms come back, trains limited from stage 2', () => {
    expect(concussionAvailability(null, false).training).toBe('unavailable');
    expect(concussionAvailability({ stage: 1, outcome: 'in_progress' }, false).training).toBe(
      'unavailable',
    );
    expect(concussionAvailability({ stage: 3, outcome: 'symptomatic' }, false).training).toBe(
      'unavailable',
    );
    expect(concussionAvailability({ stage: 2, outcome: 'in_progress' }, false).training).toBe(
      'limited',
    );
    expect(concussionAvailability({ stage: 5, outcome: 'passed' }, false).training).toBe('limited');
  });
});

describe('not-done reason of a test as a viewer sees it', () => {
  it('shows injured only to the medical staff', () => {
    for (const role of ROLES) {
      expect(notDoneReasonForViewer('injured', role)).toBe(
        role === 'medical' ? 'injured' : 'unavailable',
      );
    }
  });

  it('leaves the other reasons as they are', () => {
    for (const reason of TEST_NOT_DONE_REASONS.filter((r) => r !== 'injured')) {
      for (const role of ROLES) expect(notDoneReasonForViewer(reason, role)).toBe(reason);
    }
  });
});
