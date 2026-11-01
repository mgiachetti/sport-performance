import {
  STAGES,
  STAGE_PROFILES,
  type CanonicalTestCode,
  type Sex,
  type Sport,
  type Stage,
} from '@sport-performance/domain';
import { testAppliesToSport, testDefinitionSeeds } from './test-definitions.js';

/**
 * Default battery (CLAUDE.md, "Batería de tests" and "Calendario"): which
 * tests each stage does, in which windows and at which cadence. "2 V" is V1
 * and V3; "4 V" is V1 to V4. Anthropometry is continuous, at the cadence of
 * `STAGE_PROFILES[stage].anthropometryEveryWeeks`; the performance stage adds
 * a weekly CMJ (`STAGE_PROFILES.performance.weeklyCmj`).
 */

/** Test windows of the season: 1 = V1 (February) … 4 = V4 (November). */
export type TestWindowNumber = 1 | 2 | 3 | 4;

const TWO_WINDOWS: readonly TestWindowNumber[] = [1, 3];
const FOUR_WINDOWS: readonly TestWindowNumber[] = [1, 2, 3, 4];

/** How a stage schedules a test; absent stages do not do it. */
interface StageSchedule {
  readonly windows: readonly TestWindowNumber[];
  /** Continuous schedule on top of (or instead of) the windows. */
  readonly cadence?: 'anthropometry' | 'weekly_cmj';
}

const all = (schedule: StageSchedule): Readonly<Record<Stage, StageSchedule>> => ({
  foundation: schedule,
  development: schedule,
  performance: schedule,
});

/** The battery table of CLAUDE.md, column by column. */
const BATTERY: Readonly<
  Record<CanonicalTestCode, Partial<Readonly<Record<Stage, StageSchedule>>>>
> = {
  anthro: all({ windows: [], cadence: 'anthropometry' }),
  sprint_40: all({ windows: FOUR_WINDOWS }),
  cmj: {
    foundation: { windows: FOUR_WINDOWS },
    development: { windows: FOUR_WINDOWS },
    performance: { windows: FOUR_WINDOWS, cadence: 'weekly_cmj' },
  },
  cod_505: {
    foundation: { windows: TWO_WINDOWS },
    development: { windows: FOUR_WINDOWS },
    performance: { windows: FOUR_WINDOWS },
  },
  ift_3015: {
    foundation: { windows: TWO_WINDOWS },
    development: { windows: FOUR_WINDOWS },
    performance: { windows: FOUR_WINDOWS },
  },
  bronco: { performance: { windows: TWO_WINDOWS } },
  strength: all({ windows: FOUR_WINDOWS }),
  mobility: all({ windows: TWO_WINDOWS }),
  reaction: all({ windows: TWO_WINDOWS }),
  neck: {
    development: { windows: TWO_WINDOWS },
    performance: { windows: FOUR_WINDOWS },
  },
};

export interface BatterySeed {
  readonly sport: Sport;
  readonly sex: Sex;
  readonly stage: Stage;
  readonly testCode: CanonicalTestCode;
  readonly windows: readonly TestWindowNumber[];
  readonly cadenceWeeksMin: number | null;
  readonly cadenceWeeksMax: number | null;
}

function cadenceWeeks(
  stage: Stage,
  cadence: StageSchedule['cadence'],
): { min: number; max: number } | null {
  const profile = STAGE_PROFILES[stage];
  if (cadence === 'anthropometry') return profile.anthropometryEveryWeeks;
  if (cadence === 'weekly_cmj') return profile.weeklyCmj ? { min: 1, max: 1 } : null;
  return null;
}

/**
 * Battery rows of one branch (sport and sex), by stage, for the tests that
 * apply to the sport. Club-wide (no category): a club narrows it per
 * category in B-322.
 */
export function batterySeeds(sport: Sport, sex: Sex): BatterySeed[] {
  const seeds: BatterySeed[] = [];
  for (const test of testDefinitionSeeds()) {
    if (!testAppliesToSport(test, sport)) continue;
    for (const stage of STAGES) {
      const schedule = BATTERY[test.code][stage];
      if (schedule === undefined) continue;
      const cadence = cadenceWeeks(stage, schedule.cadence);
      if (schedule.windows.length === 0 && cadence === null) continue;
      seeds.push({
        sport,
        sex,
        stage,
        testCode: test.code,
        windows: schedule.windows,
        cadenceWeeksMin: cadence?.min ?? null,
        cadenceWeeksMax: cadence?.max ?? null,
      });
    }
  }
  return seeds;
}
