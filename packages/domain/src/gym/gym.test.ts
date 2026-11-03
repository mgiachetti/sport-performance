import { describe, expect, it } from 'vitest';
import { parseLocalDate } from '../time.js';
import {
  GYM_EXERCISE_LIBRARY,
  GYM_LIBRARY_EXERCISE_CODES,
  gymLibraryExercise,
  isGymExerciseCode,
} from './exercises.js';
import { findPlanExercise, gymPlanIssues, type GymPlan, type GymPlanExercise } from './plan.js';
import {
  gymSetE1rmKg,
  gymSetIssues,
  gymSetWarnings,
  isWithinGymLogWindow,
  summarizeGymSets,
  type GymSetValues,
} from './sets.js';

const d = parseLocalDate;

const exercise = (overrides: Partial<GymPlanExercise> = {}): GymPlanExercise => ({
  exerciseCode: 'trap_bar_deadlift',
  name: null,
  loadKind: 'external',
  measure: 'reps',
  sets: 3,
  repsMin: 3,
  repsMax: 5,
  durationS: null,
  targetRir: 2,
  loadKg: 60,
  restS: 120,
  notes: null,
  ...overrides,
});

const plan = (...exercises: GymPlanExercise[]): GymPlan => ({
  days: [{ key: 'a', name: 'Día A', exercises }],
});

const set = (overrides: Partial<GymSetValues> = {}): GymSetValues => ({
  reps: 5,
  loadKg: 60,
  rir: 2,
  techniqueScore: null,
  durationS: null,
  ...overrides,
});

const external = { loadKind: 'external', measure: 'reps' } as const;
const bodyweight = { loadKind: 'bodyweight', measure: 'reps' } as const;
const weighted = { loadKind: 'bodyweight_plus', measure: 'reps' } as const;
const hold = { loadKind: 'bodyweight', measure: 'duration' } as const;

describe('exercise library', () => {
  it('uses well-formed codes only', () => {
    for (const code of GYM_LIBRARY_EXERCISE_CODES) expect(isGymExerciseCode(code), code).toBe(true);
  });

  it('holds the strength exercises of every stage', () => {
    expect(GYM_EXERCISE_LIBRARY.goblet_squat.loadKind).toBe('external');
    expect(GYM_EXERCISE_LIBRARY.push_up.loadKind).toBe('bodyweight');
    expect(GYM_EXERCISE_LIBRARY.plank.measure).toBe('duration');
    expect(gymLibraryExercise('club_own')).toBeUndefined();
  });
});

describe('gymPlanIssues', () => {
  it('accepts a development program that never goes to failure', () => {
    expect(gymPlanIssues(plan(exercise()), 'estimated_rm')).toEqual([]);
  });

  it('asks M15/M16 for reps in reserve at or above the protocol', () => {
    expect(gymPlanIssues(plan(exercise({ targetRir: null })), 'estimated_rm')).toEqual([
      { path: ['days', 0, 'exercises', 0, 'targetRir'], code: 'target_rir_required' },
    ]);
    expect(gymPlanIssues(plan(exercise({ targetRir: 1 })), 'estimated_rm')).toEqual([
      { path: ['days', 0, 'exercises', 0, 'targetRir'], code: 'target_rir_below_protocol' },
    ]);
    // The protocol of the club rules.
    expect(
      gymPlanIssues(plan(exercise({ targetRir: 2 })), 'estimated_rm', {
        minReps: 3,
        maxReps: 5,
        minRir: 3,
      }).map((i) => i.code),
    ).toEqual(['target_rir_below_protocol']);
  });

  it('keeps M13/M14 on the body or a stick', () => {
    expect(gymPlanIssues(plan(exercise()), 'technique_reps').map((i) => i.code)).toEqual([
      'loaded_exercise_not_allowed',
    ]);
    const pushUps = exercise({
      exerciseCode: 'push_up',
      loadKind: 'bodyweight',
      targetRir: null,
      loadKg: null,
      repsMin: 8,
      repsMax: 12,
    });
    expect(gymPlanIssues(plan(pushUps), 'technique_reps')).toEqual([]);
  });

  it('leaves M17/M19 free, as the first team', () => {
    expect(gymPlanIssues(plan(exercise({ targetRir: 0 })), 'direct_rm')).toEqual([]);
  });

  it('checks the coherence of each exercise', () => {
    const issues = gymPlanIssues(
      plan(
        exercise({ loadKind: 'bodyweight' }),
        exercise({
          exerciseCode: 'plank',
          loadKind: 'bodyweight',
          measure: 'duration',
          targetRir: null,
          loadKg: null,
        }),
        exercise({ exerciseCode: 'sled_push', name: null, repsMin: 6, repsMax: 4 }),
      ),
      'direct_rm',
    );
    expect(issues).toEqual([
      { path: ['days', 0, 'exercises', 0, 'loadKind'], code: 'load_kind_mismatch' },
      { path: ['days', 0, 'exercises', 0, 'loadKg'], code: 'load_not_applicable' },
      { path: ['days', 0, 'exercises', 1, 'durationS'], code: 'duration_required' },
      { path: ['days', 0, 'exercises', 1, 'repsMin'], code: 'reps_not_applicable' },
      { path: ['days', 0, 'exercises', 2, 'name'], code: 'name_required' },
      { path: ['days', 0, 'exercises', 2, 'repsMax'], code: 'reps_range' },
    ]);
  });

  it('flags repeated days and exercises', () => {
    const day = { key: 'a', name: 'A', exercises: [exercise(), exercise()] };
    expect(gymPlanIssues({ days: [day, day] }, 'direct_rm').map((i) => i.code)).toEqual([
      'duplicate_exercise',
      'duplicate_day_key',
      'duplicate_exercise',
    ]);
  });

  it('finds an exercise of the plan, in a day or in any', () => {
    const p: GymPlan = {
      days: [
        { key: 'a', name: 'A', exercises: [exercise()] },
        { key: 'b', name: 'B', exercises: [exercise({ exerciseCode: 'bench_press' })] },
      ],
    };
    expect(findPlanExercise(p, 'bench_press')?.exerciseCode).toBe('bench_press');
    expect(findPlanExercise(p, 'bench_press', 'a')).toBeUndefined();
  });
});

describe('gymSetIssues', () => {
  it('accepts a valid loaded set', () => {
    expect(gymSetIssues(set(), external, 'estimated_rm')).toEqual([]);
  });

  it('asks a loaded set from M15 for its RIR', () => {
    expect(gymSetIssues(set({ rir: null }), external, 'estimated_rm')).toEqual([
      { field: 'rir', code: 'rir_required' },
    ]);
    expect(gymSetIssues(set({ rir: null }), external, 'direct_rm')).toEqual([
      { field: 'rir', code: 'rir_required' },
    ]);
  });

  it('rejects loads in M13/M14', () => {
    expect(gymSetIssues(set(), external, 'technique_reps')).toEqual([
      { field: 'exerciseCode', code: 'loaded_exercise_not_allowed' },
    ]);
    expect(
      gymSetIssues(
        set({ loadKg: null, rir: null, techniqueScore: 3 }),
        bodyweight,
        'technique_reps',
      ),
    ).toEqual([]);
  });

  it('checks the values against the exercise', () => {
    expect(gymSetIssues(set({ loadKg: null }), external, 'direct_rm')).toEqual([
      { field: 'loadKg', code: 'load_required' },
    ]);
    expect(gymSetIssues(set({ loadKg: 0 }), weighted, 'direct_rm')).toEqual([]);
    expect(gymSetIssues(set(), bodyweight, 'direct_rm')).toEqual([
      { field: 'loadKg', code: 'load_not_applicable' },
    ]);
    expect(
      gymSetIssues(set({ loadKg: null, durationS: 30, reps: null }), hold, 'technique_reps'),
    ).toEqual([]);
    expect(gymSetIssues(set({ loadKg: null, reps: 10 }), hold, 'technique_reps')).toEqual([
      { field: 'durationS', code: 'duration_required' },
      { field: 'reps', code: 'reps_not_applicable' },
    ]);
    expect(gymSetIssues(set({ reps: 0 }), external, 'direct_rm')).toEqual([
      { field: 'reps', code: 'reps_required' },
    ]);
  });
});

describe('gymSetWarnings', () => {
  it('flags a set to failure before M17/M19', () => {
    expect(gymSetWarnings(set({ rir: 0 }), external, 'estimated_rm')).toEqual(['to_failure']);
    expect(gymSetWarnings(set({ rir: 0, loadKg: null }), bodyweight, 'technique_reps')).toEqual([
      'to_failure',
    ]);
    expect(gymSetWarnings(set({ rir: 0 }), external, 'direct_rm')).toEqual([]);
  });

  it('flags RIR below the protocol and reps outside the e1RM range', () => {
    expect(gymSetWarnings(set({ rir: 1, reps: 8 }), external, 'estimated_rm')).toEqual([
      'rir_below_protocol',
      'outside_e1rm_range',
    ]);
  });
});

describe('gymSetE1rmKg', () => {
  it('is Epley with RIR: load × (1 + (reps + RIR) / 30)', () => {
    // 60 × (1 + 7/30) = 74.
    expect(gymSetE1rmKg(set(), external, 'estimated_rm')).toBeCloseTo(74, 10);
  });

  it('is never estimated in M13/M14', () => {
    expect(gymSetE1rmKg(set(), external, 'technique_reps')).toBeNull();
  });

  it('uses only the sets of the protocol', () => {
    expect(gymSetE1rmKg(set({ reps: 8 }), external, 'estimated_rm')).toBeNull();
    expect(gymSetE1rmKg(set({ rir: 1 }), external, 'estimated_rm')).toBeNull();
    expect(gymSetE1rmKg(set({ rir: 0 }), external, 'direct_rm')).toBeCloseTo(70, 10);
    expect(gymSetE1rmKg(set({ rir: null }), external, 'direct_rm')).toBeNull();
    expect(
      gymSetE1rmKg(set({ reps: 6 }), external, 'estimated_rm', {
        protocol: { minReps: 3, maxReps: 6, minRir: 2 },
      }),
    ).toBeCloseTo(76, 10);
  });

  it('adds the body mass to an added load, and needs it', () => {
    // (70 + 10) × (1 + 7/30).
    expect(
      gymSetE1rmKg(set({ loadKg: 10 }), weighted, 'estimated_rm', { bodyMassKg: 70 }),
    ).toBeCloseTo(98.666_666, 5);
    expect(gymSetE1rmKg(set({ loadKg: 10 }), weighted, 'estimated_rm')).toBeNull();
  });

  it('gives nothing for bodyweight or holds', () => {
    expect(gymSetE1rmKg(set({ loadKg: null }), bodyweight, 'direct_rm')).toBeNull();
    expect(gymSetE1rmKg(set({ loadKg: null }), hold, 'direct_rm')).toBeNull();
  });
});

describe('summarizeGymSets', () => {
  it('gives the best e1RM per exercise and its evolution by day', () => {
    const summary = summarizeGymSets([
      { exerciseCode: 'bench_press', performedOn: d('2026-03-02'), e1rmKg: 50 },
      { exerciseCode: 'bench_press', performedOn: d('2026-03-02'), e1rmKg: 55 },
      { exerciseCode: 'bench_press', performedOn: d('2026-03-09'), e1rmKg: 53 },
      { exerciseCode: 'bench_press', performedOn: d('2026-03-12'), e1rmKg: null },
      { exerciseCode: 'push_up', performedOn: d('2026-03-01'), e1rmKg: null },
    ]);
    expect(summary).toEqual([
      {
        exerciseCode: 'bench_press',
        setsN: 4,
        lastPerformedOn: '2026-03-12',
        bestE1rmKg: 55,
        bestOn: '2026-03-02',
        series: [
          { on: '2026-03-02', e1rmKg: 55 },
          { on: '2026-03-09', e1rmKg: 53 },
        ],
      },
      {
        exerciseCode: 'push_up',
        setsN: 1,
        lastPerformedOn: '2026-03-01',
        bestE1rmKg: null,
        bestOn: null,
        series: [],
      },
    ]);
  });
});

describe('isWithinGymLogWindow', () => {
  const today = d('2026-05-10');
  it('never takes a future day', () => {
    expect(isWithinGymLogWindow(d('2026-05-11'), today, 'staff')).toBe(false);
  });
  it('gives the player a week, the staff any past day', () => {
    expect(isWithinGymLogWindow(d('2026-05-03'), today, 'player')).toBe(true);
    expect(isWithinGymLogWindow(d('2026-05-02'), today, 'player')).toBe(false);
    expect(isWithinGymLogWindow(d('2025-05-02'), today, 'staff')).toBe(true);
  });
});
