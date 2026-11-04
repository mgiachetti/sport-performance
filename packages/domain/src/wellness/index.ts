import { meanWellnessScore } from '../alerts/engine.js';
import { WELLNESS_ITEMS, type WellnessItem } from '../measurement.js';
import { STAGE_PROFILES, compareStages, type Stage } from '../stage.js';
import { addDays, compareLocalDates, type LocalDate } from '../time.js';

/**
 * Pre-training wellness check-in (B-319, ADR 0038): the item set a stage
 * asks, how an answer is validated against it and the window in which a
 * player loads or corrects the entry of a club day.
 */

/** Size of an item set: also its version, stored as `wellness.item_count`. */
export type WellnessItemCount = 3 | 5;

/** Lowest and highest score of an item (higher is better: items are stored oriented). */
export const WELLNESS_SCORE_MIN = 1;
export const WELLNESS_SCORE_MAX = 5;

/**
 * The item sets, in the order the app asks them. The 3-item set (M13/M14,
 * with faces) keeps the physical items the staff acts on (sleep, fatigue,
 * soreness); stress and mood are added from M15. A new set is a new count
 * here and in the `wellness_item_count` check, never a change of an existing
 * one: past entries keep the set they were answered with.
 */
export const WELLNESS_ITEM_SETS: Readonly<Record<WellnessItemCount, readonly WellnessItem[]>> = {
  3: ['sleep', 'fatigue', 'soreness'],
  5: WELLNESS_ITEMS,
};

export function isWellnessItemCount(value: unknown): value is WellnessItemCount {
  return value === 3 || value === 5;
}

/** The item set a stage asks (`STAGE_PROFILES[stage].wellnessItemCount`). */
export function wellnessItemSetForStage(stage: Stage): {
  readonly itemCount: WellnessItemCount;
  readonly items: readonly WellnessItem[];
} {
  const itemCount = STAGE_PROFILES[stage].wellnessItemCount;
  return { itemCount, items: WELLNESS_ITEM_SETS[itemCount] };
}

/** Scores of one entry, by item; unanswered items absent or `null`. */
export type WellnessScores = Readonly<Partial<Record<WellnessItem, number | null | undefined>>>;

/** Why an item of an answer does not fit its set. */
export type WellnessScoreIssue =
  | { readonly item: WellnessItem; readonly problem: 'missing' }
  | { readonly item: WellnessItem; readonly problem: 'not_in_set' }
  | { readonly item: WellnessItem; readonly problem: 'out_of_range' };

/**
 * Checks an answer against an item set: every item of the set answered
 * with an integer 1–5, nothing outside the set. Returns the issues, empty
 * when valid.
 */
export function wellnessScoreIssues(
  itemCount: WellnessItemCount,
  scores: WellnessScores,
): WellnessScoreIssue[] {
  const set = WELLNESS_ITEM_SETS[itemCount];
  const issues: WellnessScoreIssue[] = [];
  for (const item of WELLNESS_ITEMS) {
    const score = scores[item] ?? null;
    if (!set.includes(item)) {
      if (score !== null) issues.push({ item, problem: 'not_in_set' });
      continue;
    }
    if (score === null) {
      issues.push({ item, problem: 'missing' });
    } else if (
      !Number.isInteger(score) ||
      score < WELLNESS_SCORE_MIN ||
      score > WELLNESS_SCORE_MAX
    ) {
      issues.push({ item, problem: 'out_of_range' });
    }
  }
  return issues;
}

/** Mean of the answered items (1–5); the score the alert rules evaluate. */
export function wellnessMeanScore(scores: WellnessScores): number {
  const answered: Partial<Record<WellnessItem, number>> = {};
  for (const item of WELLNESS_ITEMS) {
    const score = scores[item];
    if (score !== undefined && score !== null) answered[item] = score;
  }
  return meanWellnessScore(answered);
}

/**
 * Club days on which a player may still load or correct an entry: today and
 * yesterday (an offline queue that syncs after midnight, a check-in loaded
 * the morning after). Never a future day.
 */
export const WELLNESS_SUBMISSION_WINDOW_DAYS = 2;

/** Whether `day` is inside the submission window of `today` (both club days). */
export function isWithinWellnessWindow(day: LocalDate, today: LocalDate): boolean {
  if (compareLocalDates(day, today) > 0) return false;
  return compareLocalDates(day, addDays(today, -(WELLNESS_SUBMISSION_WINDOW_DAYS - 1))) >= 0;
}

/**
 * Stage that decides the item set of a day: the player's stage assignment
 * valid that day (B-204, including staff pins) or, without one, the default
 * stage of the categories the player is in that day. With several
 * categories the youngest stage wins (the shorter set is the safe
 * choice). `null` when neither exists.
 */
export function wellnessStageOn(input: {
  readonly assignedStage: Stage | null;
  readonly categoryDefaultStages: readonly Stage[];
}): Stage | null {
  if (input.assignedStage !== null) return input.assignedStage;
  let youngest: Stage | null = null;
  for (const stage of input.categoryDefaultStages) {
    if (youngest === null || compareStages(stage, youngest) < 0) youngest = stage;
  }
  return youngest;
}

export * from './pain-report.js';
