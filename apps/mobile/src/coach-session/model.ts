import {
  PARTICIPATION_BATCH_MAX,
  PARTICIPATION_CONTACTS_MAX,
  PARTICIPATION_MINUTES_MAX,
  type SessionRosterEntry,
  type SyncOperationRequest,
  type TrainingSession,
} from '@sport-performance/contracts';
import {
  SYNC_RECORDED_AT_MAX_AGE_DAYS,
  addDays,
  compareLocalDates,
  participationCarriesLoad,
  ruleFor,
  type LocalDate,
  type ParticipationStatus,
  type Role,
} from '@sport-performance/domain';

/**
 * The coach's session on the field (B-509, ADR 0080): pure functions over
 * what the phone knows of a session (its roster, kept on the phone, and the
 * participation of the local database with the queue laid over), the draft
 * the coach edits during or after it (statuses, minutes, contacts and the
 * clock of who is on the field) and the writes a save queues. Nothing here
 * reads the clock or talks to a store: callers pass `nowMs`.
 */

/** Who loads minutes and contacts on the phone: whoever records participation in the matrix. */
export function canRecordParticipation(role: Role): boolean {
  return ruleFor('participation', 'record', role).effect === 'allow';
}

// ─── Sessions ────────────────────────────────────────────────────────────────────────

/**
 * Past days the list shows: a mutation recorded further back is measured as
 * recorded at this limit by the server (ADR 0050), so the phone offers the
 * same week.
 */
export const RECENT_SESSION_DAYS = SYNC_RECORDED_AT_MAX_AGE_DAYS;

export interface SessionLists {
  /** The club day of today, by start time. */
  readonly today: readonly TrainingSession[];
  /** The last {@link RECENT_SESSION_DAYS} days, latest first. */
  readonly recent: readonly TrainingSession[];
}

/** The active sessions of today and of the last week, as the list shows them. */
export function sessionLists(sessions: readonly TrainingSession[], today: LocalDate): SessionLists {
  const from = addDays(today, -RECENT_SESSION_DAYS);
  const active = sessions.filter((session) => session.archivedAt === null);
  const byStart = (a: TrainingSession, b: TrainingSession) =>
    a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id);
  return {
    today: active
      .filter((session) => compareLocalDates(session.localDate, today) === 0)
      .sort(byStart),
    recent: active
      .filter((session) => {
        const day = session.localDate;
        return compareLocalDates(day, today) < 0 && compareLocalDates(day, from) >= 0;
      })
      .sort((a, b) => byStart(b, a)),
  };
}

// ─── What the phone knows ────────────────────────────────────────────────────────────

/** The row a later edit names: its server id, or the `clientUuid` of a create still queued. */
export type ParticipationTarget = { readonly id: string } | { readonly clientUuid: string };

/** A player's participation as the phone knows it now. */
export interface KnownParticipation {
  readonly target: ParticipationTarget;
  readonly status: ParticipationStatus;
  readonly minutes: number | null;
  readonly contactsN: number | null;
  /** What the player reported (read only for the coach). */
  readonly rpe: number | null;
  readonly srpeAu: number | null;
  /** A queued write of this phone that the server has not served back yet. */
  readonly pending: boolean;
}

// ─── Draft ───────────────────────────────────────────────────────────────────────────

/** `''`: nothing recorded yet and nothing picked. */
export type DraftStatus = ParticipationStatus | '';

export interface DraftRow {
  readonly status: DraftStatus;
  /** As typed: digits or empty. */
  readonly minutes: string;
  readonly contacts: string;
}

export type RowError = 'minutes' | 'contacts';

/** A field of a draft row. */
export type DraftField = keyof DraftRow;
const DRAFT_FIELDS: readonly DraftField[] = ['status', 'minutes', 'contacts'];

/**
 * A row the coach touched, as the draft keeps it: the values and the fields
 * the coach changed. A field not touched keeps following what the phone
 * knows, also after a pull brings another staff member's change to it
 * (ADR 0080): the draft never holds a stale copy of a value nobody edited here.
 */
export interface DraftEntry extends DraftRow {
  readonly touched: readonly DraftField[];
}

/**
 * The entry after a change of the row the screen shows (`before`, the
 * effective row): the fields that changed join the touched ones.
 */
export function touchRow(
  entry: DraftEntry | undefined,
  before: DraftRow,
  after: DraftRow,
): DraftEntry {
  const touched = new Set(entry?.touched ?? []);
  for (const field of DRAFT_FIELDS) if (before[field] !== after[field]) touched.add(field);
  return {
    status: after.status,
    minutes: after.minutes,
    contacts: after.contacts,
    touched: DRAFT_FIELDS.filter((field) => touched.has(field)),
  };
}

/**
 * The row the coach sees: the touched fields of the draft over what the
 * phone knows now (`base`, from {@link initialDraft}). A status without load
 * clears minutes and contacts, as the API does.
 */
export function mergeDraftRow(base: DraftRow, entry: DraftEntry | undefined): DraftRow {
  if (entry === undefined) return base;
  const touched = new Set(entry.touched);
  const pick = <Field extends DraftField>(field: Field): DraftRow[Field] =>
    touched.has(field) ? entry[field] : base[field];
  const status = pick('status');
  if (status !== '' && !participationCarriesLoad(status)) {
    return { status, minutes: '', contacts: '' };
  }
  return { status, minutes: pick('minutes'), contacts: pick('contacts') };
}

function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

export function knownDraft(known: KnownParticipation | null): DraftRow {
  if (known === null) return { status: '', minutes: '', contacts: '' };
  return {
    status: known.status,
    minutes: numberText(known.minutes),
    contacts: numberText(known.contactsN),
  };
}

/**
 * The row a player starts from: what the phone knows, or, for a player the
 * medical staff marked unavailable for this kind of session, "no disponible"
 * (a suggestion the save sends; the coach may change it).
 */
export function initialDraft(
  entry: Pick<SessionRosterEntry, 'availability'>,
  known: KnownParticipation | null,
): DraftRow {
  if (known !== null) return knownDraft(known);
  if (entry.availability?.status === 'unavailable') {
    return { status: 'unavailable', minutes: '', contacts: '' };
  }
  return knownDraft(null);
}

/** A status change: a status without load clears minutes and contacts. */
export function withStatus(row: DraftRow, status: DraftStatus): DraftRow {
  if (status !== '' && !participationCarriesLoad(status)) {
    return { status, minutes: '', contacts: '' };
  }
  return { ...row, status };
}

/** Only digits, at most the length of the largest value: what the number fields accept. */
export function digitsOnly(text: string, max: number): string {
  return text.replace(/\D/g, '').slice(0, String(max).length);
}

/**
 * One more (or one less) contact. A player with nothing recorded who makes a
 * contact took part: present. A status without load has no contacts.
 */
export function stepContacts(row: DraftRow, delta: 1 | -1): DraftRow {
  if (row.status !== '' && !participationCarriesLoad(row.status)) return row;
  if (delta < 0 && row.contacts === '') return row;
  const current = /^\d+$/.test(row.contacts) ? Number(row.contacts) : 0;
  const next = Math.min(PARTICIPATION_CONTACTS_MAX, Math.max(0, current + delta));
  return {
    status: row.status === '' ? 'full' : row.status,
    minutes: row.minutes,
    contacts: String(next),
  };
}

/** "Todos presentes": every recordable row with nothing yet becomes present with the planned minutes. */
export function fillPresent(
  rows: ReadonlyMap<string, DraftRow>,
  editable: ReadonlySet<string>,
  plannedMinutes: number | null,
): Map<string, DraftRow> {
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

/** The values of a draft row (`null`: nothing picked), or the fields that are not valid. */
export function rowValues(row: DraftRow): RowValues | { readonly errors: RowError[] } | null {
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
  value: RowValues | { readonly errors: RowError[] } | null,
): value is { readonly errors: RowError[] } {
  return value !== null && 'errors' in value;
}

/** The fields a row changes against what the phone knows (all of them for a new row). */
export function changedFields(
  values: RowValues,
  known: KnownParticipation | null,
): ('status' | 'minutes' | 'contactsN')[] {
  if (known === null) return ['status', 'minutes', 'contactsN'];
  const fields: ('status' | 'minutes' | 'contactsN')[] = [];
  if (values.status !== known.status) fields.push('status');
  if (values.minutes !== known.minutes) fields.push('minutes');
  if (values.contactsN !== known.contactsN) fields.push('contactsN');
  return fields;
}

/** Whether the draft says something other than what the phone knows. */
export function isDirty(row: DraftRow, known: KnownParticipation | null): boolean {
  const values = rowValues(row);
  if (values === null) return false;
  if (isError(values)) return true;
  return changedFields(values, known).length > 0;
}

/**
 * Whether saving the row corrects a value already loaded (ADR 0030): the
 * status of an existing participation, or minutes or contacts that had a
 * value. Filling an empty value is not a correction.
 */
export function isCorrection(values: RowValues, known: KnownParticipation | null): boolean {
  if (known === null) return false;
  if (values.status !== known.status) return true;
  if (known.minutes !== null && values.minutes !== known.minutes) return true;
  if (known.contactsN !== null && values.contactsN !== known.contactsN) return true;
  return false;
}

// ─── Clock of who is on the field ────────────────────────────────────────────────────

/**
 * The clock of the session on the phone. Wall-clock milliseconds: it
 * survives the app being killed (a match does not stop for that), and a
 * clock moved backwards never makes a negative stint.
 */
export interface FieldClock {
  /** When it last started running; `null` while paused (or before the start). */
  readonly runningSinceMs: number | null;
  /** Time it ran before `runningSinceMs`. */
  readonly elapsedMs: number;
  /** Players on the field now, in the order they went in. */
  readonly onField: readonly string[];
  /** Time on the field of each player before their current stint. */
  readonly playedMs: Readonly<Record<string, number>>;
  /** When the current stint of each player on the field started counting (only while running). */
  readonly stintSinceMs: Readonly<Record<string, number>>;
}

export const EMPTY_CLOCK: FieldClock = {
  runningSinceMs: null,
  elapsedMs: 0,
  onField: [],
  playedMs: {},
  stintSinceMs: {},
};

const since = (fromMs: number, nowMs: number) => Math.max(0, nowMs - fromMs);

export function clockRunning(clock: FieldClock): boolean {
  return clock.runningSinceMs !== null;
}

export function clockElapsedMs(clock: FieldClock, nowMs: number): number {
  return clock.elapsedMs + (clock.runningSinceMs === null ? 0 : since(clock.runningSinceMs, nowMs));
}

export function playedMsOf(clock: FieldClock, playerId: string, nowMs: number): number {
  const stint = clock.stintSinceMs[playerId];
  return (clock.playedMs[playerId] ?? 0) + (stint === undefined ? 0 : since(stint, nowMs));
}

/** Starts or resumes the clock: the players on the field start counting. */
export function startClock(clock: FieldClock, nowMs: number): FieldClock {
  if (clock.runningSinceMs !== null) return clock;
  return {
    ...clock,
    runningSinceMs: nowMs,
    stintSinceMs: Object.fromEntries(clock.onField.map((playerId) => [playerId, nowMs])),
  };
}

/** Pauses it (half time): every stint is settled; who is on the field stays. */
export function pauseClock(clock: FieldClock, nowMs: number): FieldClock {
  if (clock.runningSinceMs === null) return clock;
  const playedMs = { ...clock.playedMs };
  for (const playerId of clock.onField) playedMs[playerId] = playedMsOf(clock, playerId, nowMs);
  return {
    runningSinceMs: null,
    elapsedMs: clockElapsedMs(clock, nowMs),
    onField: clock.onField,
    playedMs,
    stintSinceMs: {},
  };
}

/** A player goes in or comes off. */
export function toggleOnField(clock: FieldClock, playerId: string, nowMs: number): FieldClock {
  const running = clock.runningSinceMs !== null;
  if (clock.onField.includes(playerId)) {
    const stintSinceMs = Object.fromEntries(
      Object.entries(clock.stintSinceMs).filter(([id]) => id !== playerId),
    );
    return {
      ...clock,
      onField: clock.onField.filter((id) => id !== playerId),
      playedMs: { ...clock.playedMs, [playerId]: playedMsOf(clock, playerId, nowMs) },
      stintSinceMs,
    };
  }
  return {
    ...clock,
    onField: [...clock.onField, playerId],
    stintSinceMs: running ? { ...clock.stintSinceMs, [playerId]: nowMs } : clock.stintSinceMs,
  };
}

/** Minutes of a time on the field, to the nearest minute. */
export function minutesOf(ms: number): number {
  return Math.min(PARTICIPATION_MINUTES_MAX, Math.round(ms / 60_000));
}

/** Within a minute of the whole clock: the player took part in all of it. */
const WHOLE_SESSION_TOLERANCE_MS = 60_000;

/**
 * Ends the clock and writes what it measured into the draft: the minutes of
 * every player who was on the field, and, for one with no status (or one
 * marked without load, who did play), present for the whole session or
 * limited for part of it. Players who never went in are left as they were.
 */
export function finishClock(
  clock: FieldClock,
  rows: ReadonlyMap<string, DraftRow>,
  editable: ReadonlySet<string>,
  nowMs: number,
): Map<string, DraftRow> {
  const settled = pauseClock(clock, nowMs);
  const next = new Map(rows);
  for (const [playerId, playedMs] of Object.entries(settled.playedMs)) {
    const row = rows.get(playerId);
    if (row === undefined || !editable.has(playerId) || playedMs <= 0) continue;
    const whole = playedMs >= settled.elapsedMs - WHOLE_SESSION_TOLERANCE_MS;
    const status: ParticipationStatus =
      row.status !== '' && participationCarriesLoad(row.status)
        ? row.status
        : whole
          ? 'full'
          : 'partial';
    next.set(playerId, { status, minutes: String(minutesOf(playedMs)), contacts: row.contacts });
  }
  return next;
}

// ─── Save ────────────────────────────────────────────────────────────────────────────

/** A row of the batch of new participations. */
export type NewParticipationRow =
  SyncOperationRequest<'participation.record'>['body']['rows'][number];

/** A new participation a save plans; its `clientUuid` is given when it is queued. */
export type PlannedParticipation = Omit<NewParticipationRow, 'clientUuid'>;

/** An edit of a participation the phone already knows, with only the fields it changes. */
export interface ParticipationEdit {
  readonly playerId: string;
  readonly target: ParticipationTarget;
  readonly correction: boolean;
  readonly fields: {
    readonly status?: ParticipationStatus;
    readonly minutes?: number | null;
    readonly contactsN?: number | null;
  };
}

export interface SavePlan {
  /** Participations nobody loaded yet: one batch (`participation.record`). */
  readonly creates: PlannedParticipation[];
  /**
   * Edits of loaded ones, one per player (`participation.update`): each field
   * is resolved by its own clock on the server, so a field this phone did not
   * touch never overwrites what someone else loaded meanwhile.
   */
  readonly edits: ParticipationEdit[];
  readonly errors: ReadonlyMap<string, RowError[]>;
  /** Some edit corrects a value already loaded: the save needs a reason. */
  readonly needsReason: boolean;
}

/** Who the coach can load: the matrix and a current data consent (`canRecord`). */
export function recordable(entry: Pick<SessionRosterEntry, 'canRecord'>): boolean {
  return entry.canRecord;
}

/**
 * What a save queues: the rows of the sheet (the draft merged over what the
 * phone knows, {@link mergeDraftRow}) that differ from what the phone knows,
 * for the players the coach may record. Pure: the `clientUuid` of each new
 * row is given by `queueSave`.
 */
export function planSave(
  entries: readonly SessionRosterEntry[],
  known: ReadonlyMap<string, KnownParticipation>,
  rows: ReadonlyMap<string, DraftRow>,
): SavePlan {
  const creates: PlannedParticipation[] = [];
  const edits: ParticipationEdit[] = [];
  const errors = new Map<string, RowError[]>();
  let needsReason = false;
  for (const entry of entries) {
    if (!recordable(entry)) continue;
    const playerId = entry.player.id;
    const row = rows.get(playerId);
    const current = known.get(playerId) ?? null;
    if (row === undefined || !isDirty(row, current)) continue;
    const values = rowValues(row);
    if (values === null) continue;
    if (isError(values)) {
      errors.set(playerId, values.errors);
      continue;
    }
    if (current === null) {
      creates.push({
        playerId,
        status: values.status,
        minutes: values.minutes,
        contactsN: values.contactsN,
      });
      continue;
    }
    const correction = isCorrection(values, current);
    if (correction) needsReason = true;
    const fields = changedFields(values, current);
    edits.push({
      playerId,
      target: current.target,
      correction,
      fields: Object.fromEntries(fields.map((field) => [field, values[field]])),
    });
  }
  return { creates, edits, errors, needsReason };
}

/** The batches of new rows a save queues (the batch endpoint takes at most 100). */
export function createBatches<Row>(rows: readonly Row[], max = PARTICIPATION_BATCH_MAX): Row[][] {
  const batches: Row[][] = [];
  for (let start = 0; start < rows.length; start += max) {
    batches.push(rows.slice(start, start + max));
  }
  return batches;
}

/** How many players a save writes. */
export function planSize(plan: Pick<SavePlan, 'creates' | 'edits'>): number {
  return plan.creates.length + plan.edits.length;
}

// ─── Summary ─────────────────────────────────────────────────────────────────────────

export interface SheetSummary {
  readonly present: number;
  readonly absent: number;
  readonly unavailable: number;
  readonly pending: number;
  readonly minutes: number;
  readonly contacts: number;
}

/** The sheet as the coach sees it now (draft included). */
export function sheetSummary(rows: Iterable<DraftRow>): SheetSummary {
  let present = 0;
  let absent = 0;
  let unavailable = 0;
  let pending = 0;
  let minutes = 0;
  let contacts = 0;
  for (const row of rows) {
    if (row.status === '') {
      pending += 1;
      continue;
    }
    if (row.status === 'absent') absent += 1;
    else if (row.status === 'unavailable') unavailable += 1;
    else present += 1;
    const values = rowValues(row);
    if (values !== null && !isError(values)) {
      minutes += values.minutes ?? 0;
      contacts += values.contactsN ?? 0;
    }
  }
  return { present, absent, unavailable, pending, minutes, contacts };
}
