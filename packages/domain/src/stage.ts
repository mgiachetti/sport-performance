import { memberGuard, memberParser } from './enum.js';

/**
 * Development stages ("cada etapa mide lo que puede entrenar"), youngest first.
 *
 * - `foundation`: M13 / M14. Speed, coordination, technique with bodyweight.
 * - `development`: M15 / M16. Progressive loaded strength, power, intermittent capacity.
 * - `performance`: M17 / M19. Mirrors the senior squad.
 *
 * The stage is assigned from maturation (years from PHV) plus category and can
 * be pinned by staff (B-204); this module only defines the vocabulary.
 */
export const STAGES = ['foundation', 'development', 'performance'] as const;
export type Stage = (typeof STAGES)[number];

export const isStage = memberGuard(STAGES);
export const parseStage = memberParser(STAGES, 'invalid_stage', 'stage');

/** Negative if `a` is a younger stage than `b`, 0 if equal, positive otherwise. */
export function compareStages(a: Stage, b: Stage): number {
  return STAGES.indexOf(a) - STAGES.indexOf(b);
}

/** How strength is assessed in a stage. */
export type StrengthAssessment =
  /** Bodyweight reps with good technique plus a 1–3 technique score; no maximal loads. */
  | 'technique_reps'
  /** 1RM estimated from submaximal sets (3–5 reps, RIR ≥ 2). Never to failure. */
  | 'estimated_rm'
  /** Direct 1RM or 3RM. */
  | 'direct_rm';

/** Default rules of a stage, from the stage table in CLAUDE.md. */
export interface StageProfile {
  readonly stage: Stage;
  readonly strengthAssessment: StrengthAssessment;
  /** Whether maximal loaded tests are allowed at all. */
  readonly maximalLoadTests: boolean;
  /** Anthropometry cadence, as a range of weeks between measurements. */
  readonly anthropometryEveryWeeks: { readonly min: number; readonly max: number };
  /** Whether skinfolds (ISAK) are part of anthropometry. */
  readonly skinfolds: boolean;
  /** Number of pre-training wellness items (3 with faces, or 5). */
  readonly wellnessItemCount: 3 | 5;
  /** Whether the stage adds a weekly CMJ to wellness monitoring. */
  readonly weeklyCmj: boolean;
  /** Whether players see their own percentiles. */
  readonly playerSeesOwnPercentiles: boolean;
  /**
   * Whether players may see rankings with other players' names (senior-like).
   * The permission matrix (B-303) must also require an age band outside
   * M13–M16 (`AgeBand.namedRankingsForPlayers`), because the stage
   * follows maturation and an early maturer can reach `performance` early.
   */
  readonly playerSeesNamedRankings: boolean;
}

/**
 * Default profile per stage. Product rules, not club configuration; clubs can
 * tune batteries and cadences on top (B-322), never relax the privacy rules.
 */
export const STAGE_PROFILES: Readonly<Record<Stage, StageProfile>> = {
  foundation: {
    stage: 'foundation',
    strengthAssessment: 'technique_reps',
    maximalLoadTests: false,
    anthropometryEveryWeeks: { min: 4, max: 6 },
    skinfolds: false,
    wellnessItemCount: 3,
    weeklyCmj: false,
    playerSeesOwnPercentiles: false,
    playerSeesNamedRankings: false,
  },
  development: {
    stage: 'development',
    strengthAssessment: 'estimated_rm',
    maximalLoadTests: false,
    anthropometryEveryWeeks: { min: 12, max: 13 },
    skinfolds: false,
    wellnessItemCount: 5,
    weeklyCmj: false,
    playerSeesOwnPercentiles: true,
    playerSeesNamedRankings: false,
  },
  performance: {
    stage: 'performance',
    strengthAssessment: 'direct_rm',
    maximalLoadTests: true,
    anthropometryEveryWeeks: { min: 12, max: 13 },
    skinfolds: true,
    wellnessItemCount: 5,
    weeklyCmj: true,
    playerSeesOwnPercentiles: true,
    playerSeesNamedRankings: true,
  },
};
