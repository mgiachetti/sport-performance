import type { ClubModules } from '../club-modules.js';
import type { ConsentType } from '../consent.js';
import { memberGuard, memberParser } from '../enum.js';
import { INJURY_BODY_REGIONS, type InjuryBodyRegion } from '../medical.js';

/**
 * Pain report of the wellness check-in (B-609, ADR 0078): "¿te duele algo?"
 * with a body map. It is health data: it goes to the `medical` schema, only
 * the player writes it (with `data` and `health` consents), only the medical
 * staff and the holder read it, and the coach never sees it. The product
 * does not diagnose (principle 7): an area and an intensity are what the
 * player says, for the medical staff to follow up.
 */

/**
 * Areas of the body map: the injury regions (Fuller et al. 2007) without
 * `other`, so a report can be turned into an injury by the medical staff
 * with the same vocabulary. Whatever the map does not cover goes in the
 * comment. `packages/db` builds no new enum: the area column reuses
 * `medical.injury_body_region`, with a check that excludes `other`.
 */
export const PAIN_BODY_REGIONS = INJURY_BODY_REGIONS.filter(
  (region): region is Exclude<InjuryBodyRegion, 'other'> => region !== 'other',
);
export type PainBodyRegion = Exclude<InjuryBodyRegion, 'other'>;
export const isPainBodyRegion = memberGuard(PAIN_BODY_REGIONS);
export const parsePainBodyRegion = memberParser(
  PAIN_BODY_REGIONS,
  'invalid_argument',
  'pain body region',
);

/**
 * Side of an area. A limb or a hip is `left` or `right` (pain on both is two
 * areas, each with its intensity); the head and the trunk are `central`. A
 * subset of `INJURY_SIDES`: the column reuses `medical.injury_side`.
 */
export const PAIN_SIDES = ['left', 'right', 'central'] as const;
export type PainSide = (typeof PAIN_SIDES)[number];
export const isPainSide = memberGuard(PAIN_SIDES);
export const parsePainSide = memberParser(PAIN_SIDES, 'invalid_argument', 'pain side');

/** Areas on the midline of the body: their only side is `central`. */
export const CENTRAL_PAIN_REGIONS: readonly PainBodyRegion[] = [
  'head_face',
  'neck',
  'chest',
  'thoracic_spine',
  'lumbar_spine',
  'abdomen',
];

/** The sides an area of the map takes. */
export function painSidesForRegion(region: PainBodyRegion): readonly PainSide[] {
  return CENTRAL_PAIN_REGIONS.includes(region) ? ['central'] : ['left', 'right'];
}

/**
 * Pain intensity on the 0–10 numeric rating scale (NRS); an area that hurts
 * is at least 1. "No pain" is the answer without areas, never an area at 0.
 */
export const PAIN_INTENSITY_MIN = 1;
export const PAIN_INTENSITY_MAX = 10;

/** Most areas in one report: the map has 30 places, and more is a comment for the doctor. */
export const PAIN_AREAS_MAX = 12;

/** Longest comment of a report (characters): a short note, not a clinical history. */
export const PAIN_COMMENT_MAX_LENGTH = 280;

export interface PainArea {
  readonly region: PainBodyRegion;
  readonly side: PainSide;
  readonly intensity: number;
}

/** A report as the player sends it. */
export interface PainReportAnswer {
  readonly hasPain: boolean;
  readonly areas: readonly PainArea[];
  readonly comment?: string | null | undefined;
}

export type PainReportProblem =
  | 'areas_required'
  | 'areas_without_pain'
  | 'too_many_areas'
  | 'side_not_for_region'
  | 'intensity_out_of_range'
  | 'duplicate_area'
  | 'comment_without_pain'
  | 'comment_blank'
  | 'comment_too_long';

export interface PainReportIssue {
  /** Where: `['areas', i, 'side']`, `['comment']`… */
  readonly path: readonly (string | number)[];
  readonly problem: PainReportProblem;
}

/**
 * What is wrong with an answer, or `[]`. With pain, one to
 * {@link PAIN_AREAS_MAX} distinct areas, each with a side of its region and
 * an integer intensity; without pain, no areas and no comment (the comment
 * is about the pain). The database checks the same (`pain_report_*`).
 */
export function painReportIssues(answer: PainReportAnswer): PainReportIssue[] {
  const issues: PainReportIssue[] = [];
  if (answer.hasPain && answer.areas.length === 0) {
    issues.push({ path: ['areas'], problem: 'areas_required' });
  }
  if (!answer.hasPain && answer.areas.length > 0) {
    issues.push({ path: ['areas'], problem: 'areas_without_pain' });
  }
  if (answer.areas.length > PAIN_AREAS_MAX) {
    issues.push({ path: ['areas'], problem: 'too_many_areas' });
  }
  const seen = new Set<string>();
  answer.areas.forEach((area, index) => {
    if (!painSidesForRegion(area.region).includes(area.side)) {
      issues.push({ path: ['areas', index, 'side'], problem: 'side_not_for_region' });
    }
    if (
      !Number.isInteger(area.intensity) ||
      area.intensity < PAIN_INTENSITY_MIN ||
      area.intensity > PAIN_INTENSITY_MAX
    ) {
      issues.push({ path: ['areas', index, 'intensity'], problem: 'intensity_out_of_range' });
    }
    const key = painAreaKey(area);
    if (seen.has(key)) issues.push({ path: ['areas', index], problem: 'duplicate_area' });
    seen.add(key);
  });
  const comment = answer.comment ?? null;
  if (comment !== null) {
    if (!answer.hasPain) issues.push({ path: ['comment'], problem: 'comment_without_pain' });
    if (comment.trim() === '') issues.push({ path: ['comment'], problem: 'comment_blank' });
    if (painCommentLength(comment) > PAIN_COMMENT_MAX_LENGTH) {
      issues.push({ path: ['comment'], problem: 'comment_too_long' });
    }
  }
  return issues;
}

/**
 * Length of a comment in Unicode code points, as Postgres counts it
 * (`char_length`): an emoji is one character, not two UTF-16 units.
 */
export function painCommentLength(comment: string): number {
  return Array.from(comment).length;
}

/** Identity of an area within a report: one row per region and side. */
export function painAreaKey(area: Pick<PainArea, 'region' | 'side'>): string {
  return `${area.region}:${area.side}`;
}

/** The highest intensity of a report (`0` without pain): what the medical inbox sorts by. */
export function maxPainIntensity(areas: readonly Pick<PainArea, 'intensity'>[]): number {
  return areas.reduce((max, area) => Math.max(max, area.intensity), 0);
}

/**
 * Whether the club asks the question: the pain report is a step of the
 * wellness check-in, so both modules must be on (B-322).
 */
export function painReportModuleOn(
  modules: Pick<ClubModules, 'wellness' | 'pain_report'>,
): boolean {
  return modules.wellness && modules.pain_report;
}

/** Why a player is not asked, or `null` when they are. */
export type PainReportUnavailableReason = 'module_off' | 'missing_consent';

/**
 * Whether a player is asked "¿te duele algo?" today: the modules on and a
 * current `data` and `health` consent (the permission matrix,
 * `pain_report.submit`, says the same).
 */
export function painReportUnavailableReason(
  modules: Pick<ClubModules, 'wellness' | 'pain_report'>,
  consents: readonly ConsentType[],
): PainReportUnavailableReason | null {
  if (!painReportModuleOn(modules)) return 'module_off';
  if (!consents.includes('data') || !consents.includes('health')) return 'missing_consent';
  return null;
}
