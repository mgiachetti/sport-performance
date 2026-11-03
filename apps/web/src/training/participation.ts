import {
  PARTICIPATION_CONTACTS_MAX,
  PARTICIPATION_MINUTES_MAX,
  type EndpointInput,
  type Participation,
  type recordParticipations,
  type SessionRosterEntry,
} from '@sport-performance/contracts';
import { participationCarriesLoad, type ParticipationStatus } from '@sport-performance/domain';

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
  /** As typed: digits or empty. */
  readonly minutes: string;
  readonly contacts: string;
}

export type RowError = 'minutes' | 'contacts';

/** A row of `POST /v1/training-sessions/{id}/participations/batch`. */
export type ParticipationRow = EndpointInput<typeof recordParticipations>['body']['rows'][number];

function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/** What the API holds, as a draft. */
export function savedDraft(participation: Participation | null): DraftRow {
  if (participation === null) return { status: '', minutes: '', contacts: '' };
  return {
    status: participation.status,
    minutes: numberText(participation.minutes),
    contacts: numberText(participation.contactsN),
  };
}

/**
 * The starting draft of a player: what was recorded, or, for a player the
 * medical staff marked unavailable for this kind of session, "no disponible"
 * (a suggestion the save sends; the staff may change it).
 */
export function initialDraft(entry: SessionRosterEntry): DraftRow {
  if (entry.participation !== null) return savedDraft(entry.participation);
  if (entry.availability?.status === 'unavailable') {
    return { status: 'unavailable', minutes: '', contacts: '' };
  }
  return savedDraft(null);
}

/** A status change: no-load statuses clear minutes and contacts. */
export function withStatus(row: DraftRow, status: DraftStatus): DraftRow {
  if (status !== '' && !participationCarriesLoad(status)) {
    return { status, minutes: '', contacts: '' };
  }
  return { ...row, status };
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
}

/** The values of a draft row, or the fields that are not valid. */
export function rowValues(row: DraftRow): RowValues | { errors: RowError[] } | null {
  if (row.status === '') return null;
  if (!participationCarriesLoad(row.status)) {
    return { status: row.status, minutes: null, contactsN: null };
  }
  const minutes = parseCount(row.minutes, PARTICIPATION_MINUTES_MAX);
  const contactsN = parseCount(row.contacts, PARTICIPATION_CONTACTS_MAX);
  const errors: RowError[] = [];
  if (minutes === 'invalid') errors.push('minutes');
  if (contactsN === 'invalid') errors.push('contacts');
  if (minutes === 'invalid' || contactsN === 'invalid') return { errors };
  return { status: row.status, minutes, contactsN };
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
    numberText(values.contactsN) !== saved.contacts
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
    rows.push({
      clientUuid: newUuid(),
      playerId: entry.player.id,
      status: values.status,
      minutes: values.minutes,
      contactsN: values.contactsN,
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
