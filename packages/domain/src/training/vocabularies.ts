import { memberGuard, memberParser } from '../enum.js';

/**
 * Contact level of a drill (B-318): contact load and return-to-play
 * planning. `controlled` is contact at reduced intensity (pads, walking
 * pace); `full` is game intensity.
 */
export const CONTACT_LEVELS = ['none', 'controlled', 'full'] as const;
export type ContactLevel = (typeof CONTACT_LEVELS)[number];

export const isContactLevel = memberGuard(CONTACT_LEVELS);
export const parseContactLevel = memberParser(CONTACT_LEVELS, 'invalid_argument', 'contact level');

/**
 * Participation of a player in a session (B-318):
 *
 * - `full`: took part in the whole session (present);
 * - `partial`: took part with restrictions or for part of it (limited);
 * - `absent`: did not come;
 * - `unavailable`: could not take part (injured, medically blocked). The
 *   coach sees only this, never the cause (ADR 0008).
 *
 * `absent` and `unavailable` carry no load: no minutes and no RPE.
 */
export const PARTICIPATION_STATUSES = ['full', 'partial', 'absent', 'unavailable'] as const;
export type ParticipationStatus = (typeof PARTICIPATION_STATUSES)[number];

export const isParticipationStatus = memberGuard(PARTICIPATION_STATUSES);
export const parseParticipationStatus = memberParser(
  PARTICIPATION_STATUSES,
  'invalid_argument',
  'participation status',
);

/** Statuses without training load: no minutes, no RPE. */
export const NO_LOAD_PARTICIPATION_STATUSES = [
  'absent',
  'unavailable',
] as const satisfies readonly ParticipationStatus[];

/** Whether a player with this status took part (and so has minutes and an RPE). */
export function participationCarriesLoad(status: ParticipationStatus): boolean {
  return !(NO_LOAD_PARTICIPATION_STATUSES as readonly ParticipationStatus[]).includes(status);
}

/**
 * Where a field metric value comes from (`external_metric.source`): a
 * Catapult OpenField import (B-601), the shared heart-rate bands (Phase 2),
 * the player's pod (Phase 3) or typed by hand. Each one is its own method
 * (principle 4): values of different sources are never merged or averaged.
 */
export const FIELD_METRIC_SOURCES = ['catapult', 'pod', 'hr_band', 'manual'] as const;
export type FieldMetricSource = (typeof FIELD_METRIC_SOURCES)[number];

export const isFieldMetricSource = memberGuard(FIELD_METRIC_SOURCES);
