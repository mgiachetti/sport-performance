import { describe, expect, it } from 'vitest';
import {
  POD_SHORT_ID_MAX,
  canChangePodStatus,
  isPodMissing,
  isPodSerial,
  nextPodShortId,
  normalizePodSerial,
  podAssignmentCovers,
  podAssignmentNeedsReprocess,
  podAssignmentProblem,
  podAssignmentRangeProblem,
  podAssignmentRangesOverlap,
  podsEnabledByDefault,
  type PodAssignmentCandidate,
} from './index.js';

const at = (iso: string) => new Date(iso);

describe('pod devices', () => {
  it('normalizes and checks serial numbers', () => {
    expect(normalizePodSerial('  spp-0001 ')).toBe('SPP-0001');
    expect(isPodSerial('SPP-0001')).toBe(true);
    expect(isPodSerial('spp-0001')).toBe(false);
    expect(isPodSerial('-SPP')).toBe(false);
    expect(isPodSerial('SP')).toBe(false);
    expect(isPodSerial('A'.repeat(33))).toBe(false);
  });
});

describe('pods of a club', () => {
  it('takes the lowest free short id', () => {
    expect(nextPodShortId([])).toBe(1);
    expect(nextPodShortId([1, 2, 4])).toBe(3);
    const full = Array.from({ length: POD_SHORT_ID_MAX }, (_, i) => i + 1);
    expect(nextPodShortId(full)).toBeNull();
  });

  it('moves statuses only along the fleet transitions', () => {
    expect(canChangePodStatus('active', 'lost')).toBe(true);
    expect(canChangePodStatus('lost', 'active')).toBe(true);
    expect(canChangePodStatus('stolen', 'lost')).toBe(true);
    expect(canChangePodStatus('active', 'lent')).toBe(false);
    expect(canChangePodStatus('lent', 'active')).toBe(false);
    expect(canChangePodStatus('retired', 'active')).toBe(false);
    expect(isPodMissing('stolen')).toBe(true);
    expect(isPodMissing('active')).toBe(false);
  });

  it('enables pods in M19 by default', () => {
    expect(podsEnabledByDefault('m19')).toBe(true);
    expect(podsEnabledByDefault('m15')).toBe(false);
  });
});

describe('pod assignments', () => {
  const base: PodAssignmentCandidate = {
    podId: 'pod-1',
    playerId: 'player-1',
    startsAt: at('2026-11-08T15:00:00Z'),
    endsAt: at('2026-11-08T17:00:00Z'),
    podStatus: 'active',
    categoryPodsEnabled: true,
    consents: ['data', 'location'],
    existing: [],
  };

  it('compares half-open ranges, open ends forever', () => {
    const a = { startsAt: at('2026-11-08T15:00:00Z'), endsAt: at('2026-11-08T16:00:00Z') };
    const next = { startsAt: at('2026-11-08T16:00:00Z'), endsAt: null };
    expect(podAssignmentRangesOverlap(a, next)).toBe(false);
    expect(podAssignmentRangesOverlap(next, { ...a, endsAt: null })).toBe(true);
    expect(podAssignmentCovers(a, at('2026-11-08T16:00:00Z'))).toBe(false);
    expect(podAssignmentCovers(next, at('2030-01-01T00:00:00Z'))).toBe(true);
  });

  it('checks the range', () => {
    expect(podAssignmentRangeProblem(base)).toBeNull();
    expect(podAssignmentRangeProblem({ ...base, endsAt: base.startsAt })).toBe('ends_before_start');
    expect(podAssignmentRangeProblem({ ...base, endsAt: at('2026-12-08T15:00:00Z') })).toBe(
      'too_long',
    );
    expect(podAssignmentRangeProblem({ ...base, endsAt: null })).toBeNull();
  });

  it('accepts a valid assignment', () => {
    expect(podAssignmentProblem(base)).toBeNull();
  });

  it('answers the first problem in order', () => {
    expect(podAssignmentProblem({ ...base, podStatus: 'lost' })).toEqual({
      code: 'pod_not_active',
      status: 'lost',
    });
    expect(podAssignmentProblem({ ...base, categoryPodsEnabled: false })).toEqual({
      code: 'category_not_enabled',
    });
    expect(podAssignmentProblem({ ...base, consents: ['data'] })).toEqual({
      code: 'consent_required',
      missing: ['location'],
    });
    expect(podAssignmentProblem({ ...base, consents: [] })).toEqual({
      code: 'consent_required',
      missing: ['data', 'location'],
    });
    expect(podAssignmentProblem({ ...base, podStatus: 'lost', endsAt: base.startsAt })?.code).toBe(
      'ends_before_start',
    );
  });

  it('rejects overlaps of the pod and of the player, but not the assignment it corrects', () => {
    const podBusy = {
      id: 'a-1',
      podId: 'pod-1',
      playerId: 'player-2',
      startsAt: at('2026-11-08T16:30:00Z'),
      endsAt: null,
    };
    const playerBusy = { ...podBusy, id: 'a-2', podId: 'pod-2', playerId: 'player-1' };
    expect(podAssignmentProblem({ ...base, existing: [podBusy] })).toEqual({
      code: 'pod_overlap',
      assignmentId: 'a-1',
    });
    expect(podAssignmentProblem({ ...base, existing: [playerBusy] })).toEqual({
      code: 'player_overlap',
      assignmentId: 'a-2',
    });
    expect(podAssignmentProblem({ ...base, existing: [podBusy], ignoreId: 'a-1' })).toBeNull();
    const before = { ...podBusy, startsAt: at('2026-11-08T13:00:00Z'), endsAt: base.startsAt };
    expect(podAssignmentProblem({ ...base, existing: [before] })).toBeNull();
  });

  it('flags a correction of the range for reprocessing', () => {
    expect(podAssignmentNeedsReprocess(base, { ...base })).toBe(false);
    expect(podAssignmentNeedsReprocess(base, { ...base, endsAt: null })).toBe(true);
    expect(
      podAssignmentNeedsReprocess(base, { ...base, startsAt: at('2026-11-08T15:05:00Z') }),
    ).toBe(true);
  });
});
