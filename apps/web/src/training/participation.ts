import {
  PARTICIPATION_CONTACTS_MAX,
  PARTICIPATION_MINUTES_MAX,
  type EndpointInput,
  type Participation,
  type recordParticipations,
  type SessionRosterEntry,
} from '@sport-performance/contracts';
import {
  SPORT_FIELD_RULES,
  participationCarriesLoad,
  periodMinutesTotal,
  recordsPeriodMinutes,
  type ExposureContext,
  type ParticipationStatus,
  type Sport,
} from '@sport-performance/domain';

/**
 * The participation sheet of a session as the staff edits it (B-407): one
 * draft row per player of the roster, compared with what the API holds to
 * send only what changed, and to know when the save corrects values already
 * submitted (a correction needs a reason, ADR 0030).
 */

/** `''`: nothing recorded yet and nothing picked. */
export type DraftStatus = ParticipationStatus | '';

export interface DraftRow {
  readonly status: DraftStatus;
  /** As typed: digits or empty. With periods, the saved total (shown, never typed). */
  readonly minutes: string;
  readonly contacts: string;
  /** Minutes of each period as typed, only in a sheet by period (hockey matches, B-803). */
  readonly periods?: readonly string[];
}

export type RowError = 'minutes' | 'contacts' | 'periods';

/**
 * What the sheet of a session asks for, from the field rules of its sport
 * (B-803, ADR 0087): contacts only in sports with contacts; in a match with
 * rolling substitutions, the minutes of each period instead of a total.
 */
export interface SheetRules {
  readonly contacts: boolean;
  /** Periods shown in a sheet by period; `null` for a sheet of totals. */
  readonly periods: number | null;
}

/** The sheet of a session with a total per player and contacts (rugby). */
export const TOTALS_SHEET: SheetRules = { contacts: true, periods: null };

/** The rules of the sheet of a session: its sport's, and enough periods for what was loaded. */
export function sheetRules(
  session: { sport: Sport; kind: ExposureContext },
  entries: readonly SessionRosterEntry[] = [],
): SheetRules {
  const rules = SPORT_FIELD_RULES[session.sport];
  if (!recordsPeriodMinutes(session)) return { contacts: rules.recordsContacts, periods: null };
  const loaded = entries.reduce(
    (most, entry) => Math.max(most, entry.participation?.periodMinutes?.length ?? 0),
    0,
  );
  return { contacts: rules.recordsContacts, periods: Math.max(rules.matchPeriodCount, loaded) };
}

function emptyPeriods(rules: SheetRules): { periods?: readonly string[] } {
  return rules.periods === null ? {} : { periods: Array.from({ length: rules.periods }, () => '') };
}

/** A row of `POST /v1/training-sessions/{id}/participations/batch`. */
export type ParticipationRow = EndpointInput<typeof recordParticipations>['body']['rows'][number];

function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/** What the API holds, as a draft. */
export function savedDraft(
  participation: Participation | null,
  rules: SheetRules = TOTALS_SHEET,
): DraftRow {
  if (participation === null) {
    return { status: '', minutes: '', contacts: '', ...emptyPeriods(rules) };
  }
  const draft: DraftRow = {
    status: participation.status,
    minutes: numberText(participation.minutes),
    contacts: numberText(participation.contactsN),
  };
  if (rules.periods === null) return draft;
  const saved = participation.periodMinutes ?? [];
  return {
    ...draft,
    periods: Array.from({ length: rules.periods }, (_, index) => numberText(saved[index])),
  };
}

/**
 * The starting draft of a player: what was recorded, or, for a player the
 * medical staff marked unavailable for this kind of session, "no disponible"
 * (a suggestion the save sends; the staff may change it).
 */
export function initialDraft(
  entry: SessionRosterEntry,
  rules: SheetRules = TOTALS_SHEET,
): DraftRow {
  if (entry.participation !== null) return savedDraft(entry.participation, rules);
  if (entry.availability?.status === 'unavailable') {
    return { status: 'unavailable', minutes: '', contacts: '', ...emptyPeriods(rules) };
  }
  return savedDraft(null, rules);
}

/** A status change: no-load statuses clear minutes, periods and contacts. */
export function withStatus(row: DraftRow, status: DraftStatus): DraftRow {
  if (status !== '' && !participationCarriesLoad(status)) {
    return {
      status,
      minutes: '',
      contacts: '',
      ...(row.periods === undefined ? {} : { periods: row.periods.map(() => '') }),
    };
  }
  return { ...row, status };
}

/** A period typed: the row's minutes become their sum when saved. */
export function withPeriod(row: DraftRow, index: number, text: string): DraftRow {
  if (row.periods === undefined) return row;
  return { ...row, periods: row.periods.map((value, at) => (at === index ? text : value)) };
}

/**
 * The planned minutes split across the periods (whole minutes, the
 * remainder to the first ones): "todos presentes" in a sheet by period.
 */
export function splitMinutes(minutes: number, periods: number): number[] {
  const base = Math.floor(minutes / periods);
  const rest = minutes - base * periods;
  return Array.from({ length: periods }, (_, index) => base + (index < rest ? 1 : 0));
}

/** "Todos presentes": every row with nothing yet becomes present with the planned minutes. */
export function fillPresent<K extends string>(
  rows: ReadonlyMap<K, DraftRow>,
  editable: ReadonlySet<K>,
  plannedMinutes: number | null,
): Map<K, DraftRow> {
  const next = new Map(rows);
  for (const [playerId, row] of rows) {
    if (!editable.has(playerId) || row.status !== '') continue;
    next.set(playerId, {
      status: 'full',
      minutes: plannedMinutes === null ? '' : String(plannedMinutes),
      contacts: row.contacts,
      ...(row.periods === undefined
        ? {}
        : {
            periods:
              plannedMinutes === null
                ? row.periods
                : splitMinutes(plannedMinutes, row.periods.length).map(String),
          }),
    });
  }
  return next;
}

function parseCount(text: string, max: number): number | null | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  const value = Number(trimmed);
  return value <= max ? value : 'invalid';
}

export interface RowValues {
  readonly status: ParticipationStatus;
  readonly minutes: number | null;
  readonly contactsN: number | null;
  /** Minutes by period, in a sheet by period (`null`: no period typed, the total stays). */
  readonly periodMinutes?: readonly number[] | null;
}

/**
 * The periods of a row: `null` when none is typed (the row keeps its total),
 * otherwise every period, an empty one as 0; `'invalid'` for a period that is
 * not a count or a total over the maximum.
 */
function periodValues(periods: readonly string[]): number[] | null | 'invalid' {
  if (periods.every((text) => text.trim() === '')) return null;
  const values: number[] = [];
  for (const text of periods) {
    const value = parseCount(text, PARTICIPATION_MINUTES_MAX);
    if (value === 'invalid') return 'invalid';
    values.push(value ?? 0);
  }
  return periodMinutesTotal(values) <= PARTICIPATION_MINUTES_MAX ? values : 'invalid';
}

/** The values of a draft row, or the fields that are not valid. */
export function rowValues(row: DraftRow): RowValues | { errors: RowError[] } | null {
  if (row.status === '') return null;
  if (!participationCarriesLoad(row.status)) {
    return {
      status: row.status,
      minutes: null,
      contactsN: null,
      ...(row.periods === undefined ? {} : { periodMinutes: null }),
    };
  }
  const periods = row.periods === undefined ? null : periodValues(row.periods);
  const minutes =
    periods === null || periods === 'invalid'
      ? parseCount(row.minutes, PARTICIPATION_MINUTES_MAX)
      : periodMinutesTotal(periods);
  const contactsN = parseCount(row.contacts, PARTICIPATION_CONTACTS_MAX);
  const errors: RowError[] = [];
  if (minutes === 'invalid') errors.push('minutes');
  if (periods === 'invalid') errors.push('periods');
  if (contactsN === 'invalid') errors.push('contacts');
  if (minutes === 'invalid' || periods === 'invalid' || contactsN === 'invalid') {
    return { errors };
  }
  return {
    status: row.status,
    minutes,
    contactsN,
    ...(row.periods === undefined ? {} : { periodMinutes: periods }),
  };
}

function samePeriods(
  a: readonly number[] | null | undefined,
  b: readonly number[] | null | undefined,
): boolean {
  const left = a ?? null;
  const right = b ?? null;
  if (left === null || right === null) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isError(
  value: RowValues | { errors: RowError[] } | null,
): value is { errors: RowError[] } {
  return value !== null && 'errors' in value;
}

/** Whether the draft says something other than what the API holds. */
export function isDirty(row: DraftRow, participation: Participation | null): boolean {
  const saved = savedDraft(participation);
  const values = rowValues(row);
  if (values === null) return false;
  if (isError(values)) return true;
  if (participation === null) return true;
  return (
    values.status !== saved.status ||
    numberText(values.minutes) !== saved.minutes ||
    numberText(values.contactsN) !== saved.contacts ||
    // In a sheet by period, typed periods that differ, or every period of a
    // row saved by period cleared (it is saved back as its total).
    (values.periodMinutes !== undefined &&
      !samePeriods(values.periodMinutes, participation.periodMinutes))
  );
}

/**
 * Whether saving the row corrects a value already submitted (ADR 0030): the
 * status of an existing participation, minutes or contacts that had a value,
 * or the player's RPE that a no-load status clears.
 */
export function isCorrection(values: RowValues, participation: Participation | null): boolean {
  if (participation === null) return false;
  if (values.status !== participation.status) return true;
  if (participation.minutes !== null && values.minutes !== participation.minutes) return true;
  if (participation.contactsN !== null && values.contactsN !== participation.contactsN) return true;
  if (
    participation.periodMinutes !== null &&
    values.periodMinutes !== undefined &&
    !samePeriods(values.periodMinutes, participation.periodMinutes)
  ) {
    return true;
  }
  return false;
}

export interface SavePlan {
  readonly rows: ParticipationRow[];
  readonly errors: ReadonlyMap<string, RowError[]>;
  readonly needsReason: boolean;
}

/**
 * The batch to send: the dirty rows of the players the caller may record,
 * each with a fresh `clientUuid` (stable across the mutation's retries, since
 * the plan is built once per save) and the version it was read at.
 */
export function planSave(
  entries: readonly SessionRosterEntry[],
  drafts: ReadonlyMap<string, DraftRow>,
  newUuid: () => string,
  rules: SheetRules = TOTALS_SHEET,
): SavePlan {
  const rows: ParticipationRow[] = [];
  const errors = new Map<string, RowError[]>();
  let needsReason = false;
  for (const entry of entries) {
    if (!entry.canRecord) continue;
    const draft = drafts.get(entry.player.id);
    if (draft === undefined || !isDirty(draft, entry.participation)) continue;
    const values = rowValues(draft);
    if (values === null) continue;
    if (isError(values)) {
      errors.set(entry.player.id, values.errors);
      continue;
    }
    if (isCorrection(values, entry.participation)) needsReason = true;
    const periodMinutes = values.periodMinutes ?? null;
    rows.push({
      clientUuid: newUuid(),
      playerId: entry.player.id,
      status: values.status,
      // Periods set the minutes as their sum (the API adds them up); a total clears them.
      ...(periodMinutes === null
        ? { minutes: values.minutes }
        : { periodMinutes: [...periodMinutes] }),
      ...(rules.contacts ? { contactsN: values.contactsN } : {}),
      ...(entry.participation === null ? {} : { version: entry.participation.version }),
    });
  }
  return { rows, errors, needsReason };
}

export interface SessionTotals {
  readonly recorded: number;
  readonly present: number;
  readonly absent: number;
  readonly unavailable: number;
  readonly minutes: number;
  readonly rpeReported: number;
  readonly srpeAu: number;
}

/** What the API holds for the session: counts, minutes and the sRPE load (UA). */
export function sessionTotals(entries: readonly SessionRosterEntry[]): SessionTotals {
  let recorded = 0;
  let present = 0;
  let absent = 0;
  let unavailable = 0;
  let minutes = 0;
  let rpeReported = 0;
  let srpeAu = 0;
  for (const { participation } of entries) {
    if (participation === null) continue;
    recorded += 1;
    if (participation.status === 'full' || participation.status === 'partial') present += 1;
    if (participation.status === 'absent') absent += 1;
    if (participation.status === 'unavailable') unavailable += 1;
    minutes += participation.minutes ?? 0;
    if (participation.rpe !== null) rpeReported += 1;
    srpeAu += participation.srpeAu ?? 0;
  }
  return { recorded, present, absent, unavailable, minutes, rpeReported, srpeAu };
}
