import { memberGuard, memberParser } from '../enum.js';
import { DomainValidationError, describeValue } from '../errors.js';
import { compareLocalDates, isLocalDate, type LocalDate } from '../time.js';
import type { Alert } from './engine.js';
import { compareAlertSeverities, type AlertSeverity } from './rules.js';

/**
 * Alert episodes (B-327, ADR 0053).
 *
 * The engine (`evaluateAlertRules`) answers "does this rule fire for this
 * player on this club day". A stored alert is an **episode**: it opens the
 * first day a rule fires, continues while it keeps firing (a high ACWR for
 * five days is one alert, not five) and resolves the first evaluated day it
 * does not (inside its thresholds, not evaluable, rule disabled, player
 * gone). This module is the transition of one rule for one player from one
 * evaluated day to the next, as a pure function, so the worker only has to
 * persist what it returns.
 */

/** Lifecycle of the staff's review of an alert. */
export const ALERT_STATUSES = ['open', 'acknowledged', 'dismissed'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const isAlertStatus = memberGuard(ALERT_STATUSES);
export const parseAlertStatus = memberParser(ALERT_STATUSES, 'invalid_argument', 'alert status');

/** Statuses a staff member may set: an acknowledgement or a dismissal. */
export const ALERT_REVIEW_STATUSES = ['acknowledged', 'dismissed'] as const;
export type AlertReviewStatus = (typeof ALERT_REVIEW_STATUSES)[number];

/**
 * What happened to an alert, in order (`alert_event`, append-only):
 *
 * - `raised`: the episode opened.
 * - `escalated`: it reached a more severe level than ever before in the
 *   episode (yellow → red). A reviewed alert goes back to `open`.
 * - `resolved`: the rule stopped firing.
 * - `reopened`: it fired again the same club day it had resolved (a
 *   correction of that day's data).
 * - `acknowledged` / `dismissed`: a staff member reviewed it, with a note.
 */
export const ALERT_EVENT_TYPES = [
  'raised',
  'escalated',
  'resolved',
  'reopened',
  'acknowledged',
  'dismissed',
] as const;
export type AlertEventType = (typeof ALERT_EVENT_TYPES)[number];

export const isAlertEventType = memberGuard(ALERT_EVENT_TYPES);

/** Maximum length of an acknowledgement or dismissal note. */
export const ALERT_NOTE_MAX_LENGTH = 1000;

/** The stored state of an episode of one rule for one player. */
export interface AlertEpisode {
  /** First club day the rule fired. */
  readonly raisedOn: LocalDate;
  /** Latest club day the rule fired. */
  readonly lastSeenOn: LocalDate;
  /** First club day it stopped firing; `null` while active. */
  readonly resolvedOn: LocalDate | null;
  /** Highest severity reached in the episode: never lowered. */
  readonly severity: AlertSeverity;
  /** Severity of `lastSeenOn`. */
  readonly currentSeverity: AlertSeverity;
  readonly status: AlertStatus;
  /** Day of the data behind the latest firing (wellness, CMJ, height). */
  readonly observedOn: LocalDate;
  /** Values of the latest firing, for the i18n message. */
  readonly values: Readonly<Record<string, number>>;
}

/**
 * What to persist for one rule and player after evaluating a day:
 * nothing, a new episode, or the latest episode updated.
 */
export type AlertEpisodeChange =
  | { readonly type: 'none' }
  | { readonly type: 'raise'; readonly episode: AlertEpisode }
  | { readonly type: 'update'; readonly episode: AlertEpisode };

const NONE: AlertEpisodeChange = { type: 'none' };

function assertDate(value: unknown, label: string): asserts value is LocalDate {
  if (!isLocalDate(value)) {
    throw new DomainValidationError(
      'invalid_argument',
      `Invalid ${label}: ${describeValue(value)}. Expected a LocalDate (YYYY-MM-DD).`,
      value,
    );
  }
}

function sameValues(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.is(a[key], b[key]));
}

function sameEpisode(a: AlertEpisode, b: AlertEpisode): boolean {
  return (
    a.raisedOn === b.raisedOn &&
    a.lastSeenOn === b.lastSeenOn &&
    a.resolvedOn === b.resolvedOn &&
    a.severity === b.severity &&
    a.currentSeverity === b.currentSeverity &&
    a.status === b.status &&
    a.observedOn === b.observedOn &&
    sameValues(a.values, b.values)
  );
}

const maxSeverity = (a: AlertSeverity, b: AlertSeverity): AlertSeverity =>
  compareAlertSeverities(a, b) >= 0 ? a : b;

/** The latest episode continued (or reopened) by a firing on `date`. */
function continued(latest: AlertEpisode, date: LocalDate, fired: Alert): AlertEpisode {
  const severity = maxSeverity(latest.severity, fired.severity);
  const escalated = compareAlertSeverities(severity, latest.severity) > 0;
  return {
    raisedOn: latest.raisedOn,
    lastSeenOn: date,
    resolvedOn: null,
    severity,
    currentSeverity: fired.severity,
    // A more severe level than the staff reviewed needs a new review.
    status: escalated ? 'open' : latest.status,
    observedOn: fired.observedOn,
    values: fired.values,
  };
}

/**
 * The transition of one rule for one player on the club day `date`.
 *
 * - `latest`: the player's most recent episode of the rule (active or not),
 *   or `null`.
 * - `fired`: the rule's alert of `date` from `evaluateAlertRules`, or `null`
 *   when it did not fire (inside its thresholds or skipped).
 *
 * Idempotent: evaluating the same day with the same outcome again returns
 * `none`. A day before the latest one the episode already knows is ignored
 * (`none`): episodes only move forward, so a re-evaluation never rewrites
 * history the staff may have reviewed.
 */
export function nextAlertEpisode(
  latest: AlertEpisode | null,
  date: LocalDate,
  fired: Alert | null,
): AlertEpisodeChange {
  assertDate(date, 'date');
  if (fired !== null && fired.date !== date) {
    throw new DomainValidationError(
      'invalid_argument',
      `The alert was evaluated on ${fired.date}, not on ${date}.`,
      fired.date,
    );
  }
  const raise = (alert: Alert): AlertEpisodeChange => ({
    type: 'raise',
    episode: {
      raisedOn: date,
      lastSeenOn: date,
      resolvedOn: null,
      severity: alert.severity,
      currentSeverity: alert.severity,
      status: 'open',
      observedOn: alert.observedOn,
      values: alert.values,
    },
  });
  const update = (episode: AlertEpisode): AlertEpisodeChange =>
    latest !== null && sameEpisode(latest, episode) ? NONE : { type: 'update', episode };

  if (latest === null) return fired === null ? NONE : raise(fired);

  if (latest.resolvedOn === null) {
    // Episodes only move forward.
    if (compareLocalDates(date, latest.lastSeenOn) < 0) return NONE;
    if (fired !== null) return update(continued(latest, date, fired));
    // Stopped firing: resolved that day (also when it fired earlier the same day
    // and a correction of the data cleared it).
    return update({ ...latest, resolvedOn: date });
  }

  const order = compareLocalDates(date, latest.resolvedOn);
  if (order < 0) return NONE;
  if (order === 0) {
    // Fires again the day it resolved: the same episode, reopened.
    return fired === null ? NONE : update(continued(latest, date, fired));
  }
  return fired === null ? NONE : raise(fired);
}

/**
 * Problems of a review of an alert by the staff, or an empty list: only an
 * `open` alert is reviewed, and a dismissal needs a note (why it does not
 * apply). Notes are trimmed and at most {@link ALERT_NOTE_MAX_LENGTH} chars.
 */
export type AlertReviewProblem = 'not_open' | 'note_required' | 'note_too_long';

export function alertReviewProblems(input: {
  readonly currentStatus: AlertStatus;
  readonly status: AlertReviewStatus;
  readonly note: string | null;
}): AlertReviewProblem[] {
  const problems: AlertReviewProblem[] = [];
  if (input.currentStatus !== 'open') problems.push('not_open');
  const note = input.note?.trim() ?? '';
  if (input.status === 'dismissed' && note === '') problems.push('note_required');
  if (note.length > ALERT_NOTE_MAX_LENGTH) problems.push('note_too_long');
  return problems;
}

// ---------------------------------------------------------------------------
// CMJ input

/** Where the `cmj_drop` rule reads its jumps: the CMJ test and its height metric. */
export const CMJ_ALERT_SOURCE = { testCode: 'cmj', metricCode: 'cmj_height_cm' } as const;

/** A scored CMJ result (best valid attempt) with how it was measured. */
export interface CmjResultForAlerts {
  readonly date: LocalDate;
  readonly heightCm: number;
  /** Measurement method of the result (`manual`, `app`, `video`…). */
  readonly method: string;
}

/**
 * The CMJ measurements the `cmj_drop` rule compares, up to `date`: those
 * measured with the same method as the latest one (principle 4: methods are
 * never compared silently). A latest day measured with several methods
 * keeps the method of its best jump.
 */
export function cmjMeasurementsForAlerts(
  results: readonly CmjResultForAlerts[],
  date: LocalDate,
): { readonly date: LocalDate; readonly heightCm: number }[] {
  assertDate(date, 'date');
  const upTo = results.filter((r) => compareLocalDates(r.date, date) <= 0);
  let latest: CmjResultForAlerts | null = null;
  for (const result of upTo) {
    const order = latest === null ? 1 : compareLocalDates(result.date, latest.date);
    if (latest === null || order > 0 || (order === 0 && result.heightCm > latest.heightCm)) {
      latest = result;
    }
  }
  if (latest === null) return [];
  const method = latest.method;
  return upTo
    .filter((r) => r.method === method)
    .map((r) => ({ date: r.date, heightCm: r.heightCm }));
}
