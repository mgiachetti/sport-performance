import type { ClubModules } from '../club-modules.js';
import { CONSENT_TYPES, type ConsentType } from '../consent.js';
import { memberGuard, memberParser } from '../enum.js';
import type { Role } from '../role.js';
import type { Sex } from '../sex.js';
import { addDays, compareLocalDates, daysBetween, type LocalDate } from '../time.js';

/**
 * Menstrual cycle tracking (B-806, ADR 0087): an optional module, health data
 * with the strictest access of the product. It needs three keys at once: the
 * club's module (`menstrual_cycle`, off by default), the specific consent
 * (`menstrual_cycle`, signed by a guardian while the player is a minor, by the
 * player once of age) together with `data` and `health`, and the player's own
 * opt-in. Only the player writes it; only she and the members she authorizes
 * one by one (assigned `medical` or `sc` staff) read it. Never the coach, the
 * administration, the superadmin, the worker or the guardian (who consents and
 * can revoke, but does not read).
 *
 * The product does not diagnose (principle 7) nor predict: no phase estimate
 * and no forecast of the next period. Counting days is not a valid way to
 * place a phase (Elliott-Sale et al. 2021, Sports Med 51:843–861); the
 * summary only describes what the player logged. The vocabulary below is a
 * starting point to be defined with the club's medical staff (B-806).
 */

/**
 * Bleeding of a day. `spotting` is a trace that does not start nor extend a
 * period (WHO reference definitions, Belsey & Farley 1988, Stat Med
 * 7:1181–1198 — verify against the paper before production). `packages/db`
 * builds the `medical.menstrual_flow` enum from here: never rename a value.
 */
export const MENSTRUAL_FLOWS = ['none', 'spotting', 'light', 'moderate', 'heavy'] as const;
export type MenstrualFlow = (typeof MENSTRUAL_FLOWS)[number];
export const isMenstrualFlow = memberGuard(MENSTRUAL_FLOWS);
export const parseMenstrualFlow = memberParser(
  MENSTRUAL_FLOWS,
  'invalid_argument',
  'menstrual flow',
);

/** Flows that are a day of the period (bleeding, not spotting). */
export const PERIOD_FLOWS: readonly MenstrualFlow[] = ['light', 'moderate', 'heavy'];

/** Whether a flow is a day of the period. */
export function isPeriodFlow(flow: MenstrualFlow): boolean {
  return PERIOD_FLOWS.includes(flow);
}

/**
 * Symptoms the player can mark, a closed set (the common cycle-related
 * symptoms reported by athletes, Bruinvels et al. 2021, Br J Sports Med
 * 55:438–443 — to be agreed with the club's medical staff). Whatever is not
 * here goes in the note. `packages/db` builds `medical.menstrual_symptom`.
 */
export const MENSTRUAL_SYMPTOMS = [
  'cramps',
  'lower_back_pain',
  'headache',
  'bloating',
  'breast_tenderness',
  'fatigue',
  'mood_changes',
  'sleep_disturbance',
  'nausea',
  'gastrointestinal',
] as const;
export type MenstrualSymptom = (typeof MENSTRUAL_SYMPTOMS)[number];
export const isMenstrualSymptom = memberGuard(MENSTRUAL_SYMPTOMS);
export const parseMenstrualSymptom = memberParser(
  MENSTRUAL_SYMPTOMS,
  'invalid_argument',
  'menstrual symptom',
);

/** Longest note of a day (characters, counted as Postgres counts them). */
export const MENSTRUAL_NOTE_MAX_LENGTH = 280;

/**
 * How far back the player logs a day (club days, today included): a period
 * remembered a few days later still goes in; older history is not a diary.
 */
export const MENSTRUAL_LOG_WINDOW_DAYS = 14;

/** Longest range of days read at once (one read of the logged access). */
export const MENSTRUAL_READ_MAX_DAYS = 400;

/**
 * Roles a player can authorize to read her cycle, among the members assigned
 * to her: the medical staff and the strength and conditioning staff (who may
 * adjust the training). Never `coach`, `admin`, `superadmin` or `parent`.
 */
export const MENSTRUAL_CYCLE_VIEWER_ROLES = ['medical', 'sc'] as const satisfies readonly Role[];
export type MenstrualCycleViewerRole = (typeof MENSTRUAL_CYCLE_VIEWER_ROLES)[number];
export const isMenstrualCycleViewerRole = memberGuard(MENSTRUAL_CYCLE_VIEWER_ROLES);

/** Most members a player authorizes at once. */
export const MENSTRUAL_CYCLE_VIEWERS_MAX = 10;

/** Consents the module needs, all current. */
export const MENSTRUAL_CYCLE_CONSENTS: readonly ConsentType[] = [
  'data',
  'health',
  'menstrual_cycle',
];

/** A day as the player logs it. */
export interface MenstrualCycleDayInput {
  readonly flow: MenstrualFlow;
  readonly symptoms: readonly MenstrualSymptom[];
  readonly note?: string | null | undefined;
}

export type MenstrualCycleDayProblem = 'duplicate_symptom' | 'note_blank' | 'note_too_long';

export interface MenstrualCycleDayIssue {
  readonly path: readonly (string | number)[];
  readonly problem: MenstrualCycleDayProblem;
}

/**
 * What is wrong with a day, or `[]`: each symptom once and a non-blank note
 * of at most {@link MENSTRUAL_NOTE_MAX_LENGTH} characters. The database checks
 * the same (`menstrual_cycle_log_*`).
 */
export function menstrualCycleDayIssues(day: MenstrualCycleDayInput): MenstrualCycleDayIssue[] {
  const issues: MenstrualCycleDayIssue[] = [];
  const seen = new Set<MenstrualSymptom>();
  day.symptoms.forEach((symptom, index) => {
    if (seen.has(symptom)) issues.push({ path: ['symptoms', index], problem: 'duplicate_symptom' });
    seen.add(symptom);
  });
  const note = day.note ?? null;
  if (note !== null) {
    if (note.trim() === '') issues.push({ path: ['note'], problem: 'note_blank' });
    if (Array.from(note).length > MENSTRUAL_NOTE_MAX_LENGTH) {
      issues.push({ path: ['note'], problem: 'note_too_long' });
    }
  }
  return issues;
}

/** Symptoms in vocabulary order, each once: how they are stored and shown. */
export function normalizeMenstrualSymptoms(
  symptoms: readonly MenstrualSymptom[],
): MenstrualSymptom[] {
  return MENSTRUAL_SYMPTOMS.filter((symptom) => symptoms.includes(symptom));
}

/** Whether `day` can be logged on the club's `today` (the last {@link MENSTRUAL_LOG_WINDOW_DAYS} days). */
export function isWithinMenstrualLogWindow(day: LocalDate, today: LocalDate): boolean {
  if (compareLocalDates(day, today) > 0) return false;
  return compareLocalDates(day, addDays(today, -(MENSTRUAL_LOG_WINDOW_DAYS - 1))) >= 0;
}

/** A logged day with the moment it was logged. */
export interface MenstrualCycleLogEntry {
  readonly localDate: LocalDate;
  readonly flow: MenstrualFlow;
  readonly loggedAt: Date;
}

/**
 * The day log is append-only (a correction is a new entry): the entry that
 * counts for each day is the last one logged. Returned by date, oldest first.
 */
export function latestMenstrualEntryPerDay<E extends MenstrualCycleLogEntry>(
  entries: readonly E[],
): E[] {
  const byDay = new Map<LocalDate, E>();
  for (const entry of entries) {
    const current = byDay.get(entry.localDate);
    if (current === undefined || entry.loggedAt.getTime() >= current.loggedAt.getTime()) {
      byDay.set(entry.localDate, entry);
    }
  }
  return [...byDay.values()].sort((a, b) => compareLocalDates(a.localDate, b.localDate));
}

export interface MenstrualCycleSummary {
  /** First days of each period found in the range, oldest first. */
  readonly periodStarts: LocalDate[];
  /** The last one, or `null`. */
  readonly lastPeriodStart: LocalDate | null;
  /**
   * Day of the cycle on the range's last day `to` (the first day of the last
   * period is day 1), or `null` without a period start in the range.
   */
  readonly cycleDay: number | null;
  /** Days between consecutive period starts (only complete cycles in the range). */
  readonly cycleLengthsDays: number[];
  /** Days with an entry in the range. */
  readonly daysLogged: number;
}

/** A range of club days, both ends included. */
export interface MenstrualCycleRange {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

/**
 * The days a summary of `range` reads: the range plus the day before `from`,
 * which only tells whether a period on `from` starts there or comes from
 * before the range.
 */
export function menstrualSummaryReadFrom(range: MenstrualCycleRange): LocalDate {
  return addDays(range.from, -1);
}

/**
 * A descriptive summary of the days that count (one per day, e.g. from
 * {@link latestMenstrualEntryPerDay}) in `range`: a period starts on a day of
 * the period whose previous calendar day is not one (logged without bleeding,
 * with spotting, or not logged). No phase, no forecast (see the module's
 * note): the summary says what was logged, nothing more. A day not logged
 * inside a period splits it in two: the app asks to log every day of the
 * period.
 *
 * `days` must include the day before `from` when it was logged (read from
 * {@link menstrualSummaryReadFrom}): a period that crosses `from` started
 * before the range, so it is not a start in it. Days outside
 * [`from` − 1, `to`] are ignored. `cycleDay` is counted on `to`, so a past
 * range shows the cycle day of its last day.
 */
export function summarizeMenstrualCycle(
  days: readonly Pick<MenstrualCycleLogEntry, 'localDate' | 'flow'>[],
  range: MenstrualCycleRange,
): MenstrualCycleSummary {
  const { from, to } = range;
  const inRange = (day: LocalDate) =>
    compareLocalDates(day, from) >= 0 && compareLocalDates(day, to) <= 0;
  const periodDays = new Set(
    days
      .filter((d) => isPeriodFlow(d.flow))
      .map((d) => d.localDate)
      .filter((day) => inRange(day) || day === menstrualSummaryReadFrom(range)),
  );
  const periodStarts = [...periodDays]
    .filter((day) => inRange(day) && !periodDays.has(addDays(day, -1)))
    .sort(compareLocalDates);
  const lastPeriodStart = periodStarts.at(-1) ?? null;
  const cycleLengthsDays = periodStarts
    .slice(1)
    .map((start, i) => daysBetween(periodStarts[i] ?? start, start));
  return {
    periodStarts,
    lastPeriodStart,
    cycleDay: lastPeriodStart === null ? null : daysBetween(lastPeriodStart, to) + 1,
    cycleLengthsDays,
    daysLogged: new Set(days.map((d) => d.localDate).filter(inRange)).size,
  };
}

/** Why the module is not offered to a player, or `null` when it is. */
export type MenstrualCycleUnavailableReason = 'module_off' | 'not_female' | 'missing_consent';

/**
 * Whether the module is offered to a player: the club's module on, a female
 * player and the consents of {@link MENSTRUAL_CYCLE_CONSENTS} current. The
 * player's own opt-in comes after (she decides once it is offered).
 */
export function menstrualCycleUnavailableReason(
  modules: Pick<ClubModules, 'menstrual_cycle'>,
  sex: Sex,
  consents: readonly ConsentType[],
): MenstrualCycleUnavailableReason | null {
  if (!modules.menstrual_cycle) return 'module_off';
  if (sex !== 'female') return 'not_female';
  if (!MENSTRUAL_CYCLE_CONSENTS.every((type) => consents.includes(type))) {
    return 'missing_consent';
  }
  return null;
}

/**
 * The consent types a player is asked for: every type but `menstrual_cycle`,
 * which is asked only when the module is offered to her (the club's module on
 * and a female player) or when one was ever signed (so it can be revoked).
 */
export function consentTypesAskedFor(
  modules: Pick<ClubModules, 'menstrual_cycle'>,
  sex: Sex,
  signedTypes: readonly ConsentType[],
): ConsentType[] {
  const cycleOffered =
    (modules.menstrual_cycle && sex === 'female') || signedTypes.includes('menstrual_cycle');
  return CONSENT_TYPES.filter((type) => type !== 'menstrual_cycle' || cycleOffered);
}
