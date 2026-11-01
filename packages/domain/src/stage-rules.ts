import type { AgeBand } from './category.js';
import { STAGE_PROFILES, type Stage, type StrengthAssessment } from './stage.js';

/**
 * Whether a player may do maximal loaded tests (principle 3): the stage must
 * allow them (`StageProfile.maximalLoadTests`) **and** the age band too
 * (`AgeBand.maximalLoadTestsForPlayers`). An M13/M14 pinned at, or matured
 * into, `performance` still never does them.
 */
export function maximalLoadTestsAllowed(
  stage: Stage,
  ageBand: Pick<AgeBand, 'maximalLoadTestsForPlayers'>,
): boolean {
  return STAGE_PROFILES[stage].maximalLoadTests && ageBand.maximalLoadTestsForPlayers;
}

/**
 * How strength is assessed for a player: the stage's assessment, downgraded
 * to `estimated_rm` (submaximal sets, never to failure) when the stage asks
 * for a direct RM but the age band forbids maximal loads. Test protocols
 * (B-4xx) must use this instead of `STAGE_PROFILES[stage].strengthAssessment`.
 */
export function strengthAssessmentFor(
  stage: Stage,
  ageBand: Pick<AgeBand, 'maximalLoadTestsForPlayers'>,
): StrengthAssessment {
  const { strengthAssessment } = STAGE_PROFILES[stage];
  if (strengthAssessment === 'direct_rm' && !maximalLoadTestsAllowed(stage, ageBand)) {
    return 'estimated_rm';
  }
  return strengthAssessment;
}
