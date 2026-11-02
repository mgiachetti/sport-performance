import { memberGuard, memberParser } from './enum.js';
import type { Role } from './role.js';
import type { TestNotDoneReason } from './test-result.js';

/**
 * Vocabularies of the medical module (B-304, ADR 0008, ADR 0029). They are
 * the single source of the enums of the `medical` schema. The product is not
 * a medical device: these describe what the medical staff records and the
 * availability the rest of the staff sees, never a diagnosis made by the
 * software (principle 7).
 */

/**
 * Availability of a player for an activity, as the staff sees it: never the
 * cause. Ordered from best to worst (the database enum keeps this order, so
 * `max()` / `greatest()` give the worst one).
 */
export const AVAILABILITY_STATUSES = ['available', 'limited', 'unavailable'] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export const isAvailabilityStatus = memberGuard(AVAILABILITY_STATUSES);
export const parseAvailabilityStatus = memberParser(
  AVAILABILITY_STATUSES,
  'invalid_argument',
  'availability status',
);

/** The worst of several statuses; `available` for none. */
export function worstAvailability(statuses: Iterable<AvailabilityStatus>): AvailabilityStatus {
  let worst = 0;
  for (const status of statuses) {
    worst = Math.max(worst, AVAILABILITY_STATUSES.indexOf(status));
  }
  return AVAILABILITY_STATUSES[worst] ?? 'available';
}

/**
 * Body region of an injury: the regions of the rugby injury consensus
 * (Fuller et al. 2007), coarse enough to aggregate statistics. The precise
 * diagnosis, if any, goes in free text or an OSIICS code.
 */
export const INJURY_BODY_REGIONS = [
  'head_face',
  'neck',
  'shoulder',
  'upper_arm',
  'elbow',
  'forearm',
  'wrist_hand',
  'chest',
  'thoracic_spine',
  'lumbar_spine',
  'abdomen',
  'pelvis_hip_groin',
  'thigh_anterior',
  'thigh_posterior',
  'knee',
  'lower_leg',
  'ankle',
  'foot',
  'other',
] as const;
export type InjuryBodyRegion = (typeof INJURY_BODY_REGIONS)[number];
export const isInjuryBodyRegion = memberGuard(INJURY_BODY_REGIONS);

export const INJURY_SIDES = ['left', 'right', 'bilateral', 'central', 'not_applicable'] as const;
export type InjurySide = (typeof INJURY_SIDES)[number];
export const isInjurySide = memberGuard(INJURY_SIDES);

/** Acute (a single identifiable event) or gradual onset (Fuller et al. 2007). */
export const INJURY_ONSETS = ['acute', 'gradual'] as const;
export type InjuryOnset = (typeof INJURY_ONSETS)[number];
export const isInjuryOnset = memberGuard(INJURY_ONSETS);

export const INJURY_MECHANISMS = ['contact', 'non_contact', 'unknown'] as const;
export type InjuryMechanism = (typeof INJURY_MECHANISMS)[number];
export const isInjuryMechanism = memberGuard(INJURY_MECHANISMS);

/**
 * Stages of the graduated return to play after a concussion (World Rugby
 * GRTP). Stages 1–5 are recorded as the player goes through them; stage 6,
 * return to play, is the mandatory medical clearance: it needs stage 5
 * passed and is recorded on the concussion itself, never inferred.
 *
 * `training` / `match` is the availability the rest of the staff sees while
 * the player is at that stage and not cleared. Timing (minimum days per
 * stage, longer for under-19s) is the medical staff's protocol, not a rule
 * of the software (principle 7).
 */
export const CONCUSSION_GRTP_STAGES = [
  { stage: 1, code: 'symptom_limited_activity', training: 'unavailable', match: 'unavailable' },
  { stage: 2, code: 'light_aerobic_exercise', training: 'limited', match: 'unavailable' },
  { stage: 3, code: 'sport_specific_exercise', training: 'limited', match: 'unavailable' },
  { stage: 4, code: 'non_contact_training', training: 'limited', match: 'unavailable' },
  { stage: 5, code: 'full_contact_practice', training: 'limited', match: 'unavailable' },
  { stage: 6, code: 'return_to_play', training: 'available', match: 'available' },
] as const satisfies readonly {
  readonly stage: number;
  readonly code: string;
  readonly training: AvailabilityStatus;
  readonly match: AvailabilityStatus;
}[];

/** Last stage recorded as a row; the next one is the clearance. */
export const CONCUSSION_LAST_RECORDED_STAGE = 5;

/** Outcome of a GRTP stage: still going, passed, or symptoms came back (drop back). */
export const CONCUSSION_STAGE_OUTCOMES = ['in_progress', 'passed', 'symptomatic'] as const;
export type ConcussionStageOutcome = (typeof CONCUSSION_STAGE_OUTCOMES)[number];
export const isConcussionStageOutcome = memberGuard(CONCUSSION_STAGE_OUTCOMES);

export interface ConcussionAvailability {
  readonly training: AvailabilityStatus;
  readonly match: AvailabilityStatus;
}

/**
 * Availability of a player with a concussion, from its latest recorded stage.
 * Not cleared: never available for a match. Without a stage yet, or when the
 * latest stage brought symptoms back, the player rests (stage 1).
 */
export function concussionAvailability(
  latest: { readonly stage: number; readonly outcome: ConcussionStageOutcome } | null,
  cleared: boolean,
): ConcussionAvailability {
  if (cleared) return { training: 'available', match: 'available' };
  const stage =
    latest === null || latest.outcome === 'symptomatic'
      ? 1
      : Math.min(Math.max(Math.trunc(latest.stage), 1), CONCUSSION_LAST_RECORDED_STAGE);
  const definition = CONCUSSION_GRTP_STAGES[stage - 1] ?? CONCUSSION_GRTP_STAGES[0];
  return { training: definition.training, match: definition.match };
}

/** Who reads a clinical note: the medical staff only, or also the player and their guardian. */
export const MEDICAL_NOTE_VISIBILITIES = ['medical', 'shared'] as const;
export type MedicalNoteVisibility = (typeof MEDICAL_NOTE_VISIBILITIES)[number];
export const isMedicalNoteVisibility = memberGuard(MEDICAL_NOTE_VISIBILITIES);

/** Operations recorded in `medical.access_log`. `delete` only happens in the erasure of a player (ADR 0051). */
export const MEDICAL_ACCESS_ACTIONS = ['read', 'insert', 'update', 'delete'] as const;
export type MedicalAccessAction = (typeof MEDICAL_ACCESS_ACTIONS)[number];
export const isMedicalAccessAction = memberGuard(MEDICAL_ACCESS_ACTIONS);

/**
 * `test_result.not_done_reason` as a viewer sees it (ADR 0026, ADR 0029):
 * `injured` reveals a health condition, so everyone but the medical staff
 * sees `unavailable`, like the availability of the player. The database has
 * the same rule as `app.not_done_reason_for_viewer()`.
 */
export function notDoneReasonForViewer(
  reason: TestNotDoneReason,
  viewer: Role,
): TestNotDoneReason | 'unavailable' {
  return reason === 'injured' && viewer !== 'medical' ? 'unavailable' : reason;
}
