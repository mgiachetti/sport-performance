import {
  ApiError,
  type EndpointInput,
  type TrainingSession,
  type createTrainingSession,
  type updateTrainingSession,
} from '@sport-performance/contracts';
import {
  MAX_SESSION_DURATION_MIN,
  type ContactLevel,
  type ExposureContext,
  type LocalDate,
  type TimeZone,
} from '@sport-performance/domain';
import { fromLocalStart, toLocalStart } from './local-time';

/**
 * The session form (create and edit) as plain data: the values as typed,
 * their parsing with the contract's limits, the body of the create, and the
 * patch of an edit with whether it corrects values already submitted (a
 * correction needs `changeReason`, ADR 0030).
 */

export interface SessionFormValues {
  readonly kind: ExposureContext;
  readonly categoryId: string;
  /** `aaaa-mm-dd`, the club's day. */
  readonly date: string;
  /** `HH:mm`, the club's clock. */
  readonly time: string;
  readonly plannedDurationMin: string;
  readonly title: string;
  readonly location: string;
  readonly opponent: string;
  readonly notes: string;
}

export type SessionField = keyof SessionFormValues;

/** Why a field is not valid; the screen turns it into a message. */
export type FieldError = 'required' | 'start' | 'duration' | 'invalid';

export type SessionFormErrors = Partial<Record<SessionField, FieldError>>;

export interface DrillDraft {
  /** Local key of the row (React list key), not sent. */
  readonly key: string;
  readonly name: string;
  readonly durationMin: string;
  readonly contactLevel: ContactLevel;
}

export type DrillField = 'name' | 'durationMin';
export type DrillErrors = ReadonlyMap<string, Partial<Record<DrillField, FieldError>>>;

export interface ParsedSession {
  readonly kind: ExposureContext;
  readonly categoryId: string;
  readonly startsAt: string;
  readonly plannedDurationMin: number | null;
  readonly title: string | null;
  readonly location: string | null;
  /** Always `null` for a training (only matches have an opponent). */
  readonly opponent: string | null;
  readonly notes: string | null;
}

export type CreateSessionBody = EndpointInput<typeof createTrainingSession>['body'];
export type UpdateSessionBody = EndpointInput<typeof updateTrainingSession>['body'];
type DrillCreate = NonNullable<CreateSessionBody['drills']>[number];

const DEFAULT_START_TIME = '18:00';

export function emptySessionForm(defaults: {
  categoryId: string;
  date: LocalDate;
  kind?: ExposureContext;
}): SessionFormValues {
  return {
    kind: defaults.kind ?? 'training',
    categoryId: defaults.categoryId,
    date: defaults.date,
    time: DEFAULT_START_TIME,
    plannedDurationMin: '',
    title: '',
    location: '',
    opponent: '',
    notes: '',
  };
}

export function sessionFormFrom(session: TrainingSession, timeZone: TimeZone): SessionFormValues {
  const start = toLocalStart(session.startsAt, timeZone);
  return {
    kind: session.kind,
    categoryId: session.categoryId ?? '',
    date: start.date,
    time: start.time,
    plannedDurationMin:
      session.plannedDurationMin === null ? '' : String(session.plannedDurationMin),
    title: session.title ?? '',
    location: session.location ?? '',
    opponent: session.opponent ?? '',
    notes: session.notes ?? '',
  };
}

function text(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** A whole number of minutes from 1 to the most a session lasts, `null` if empty. */
export function parseMinutes(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  const minutes = Number(trimmed);
  return minutes >= 1 && minutes <= MAX_SESSION_DURATION_MIN ? minutes : 'invalid';
}

export function parseSessionForm(
  values: SessionFormValues,
  timeZone: TimeZone,
): { ok: true; session: ParsedSession } | { ok: false; errors: SessionFormErrors } {
  const errors: SessionFormErrors = {};
  if (values.categoryId === '') errors.categoryId = 'required';
  const startsAt = fromLocalStart({ date: values.date, time: values.time }, timeZone);
  if (startsAt === null) {
    if (values.date === '') errors.date = 'required';
    else errors.time = 'start';
  }
  const plannedDurationMin = parseMinutes(values.plannedDurationMin);
  if (plannedDurationMin === 'invalid') errors.plannedDurationMin = 'duration';
  if (startsAt === null || plannedDurationMin === 'invalid' || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    session: {
      kind: values.kind,
      categoryId: values.categoryId,
      startsAt,
      plannedDurationMin,
      title: text(values.title),
      location: text(values.location),
      opponent: values.kind === 'match' ? text(values.opponent) : null,
      notes: text(values.notes),
    },
  };
}

/**
 * The drills of a new session; without contacts in the sport (hockey,
 * B-803) every drill goes as `none`, whatever was picked for another category.
 */
export function parseDrills(
  drills: readonly DrillDraft[],
  contacts = true,
): { ok: true; drills: DrillCreate[] } | { ok: false; errors: DrillErrors } {
  const errors = new Map<string, Partial<Record<DrillField, FieldError>>>();
  const parsed: DrillCreate[] = [];
  for (const draft of drills) {
    const name = text(draft.name);
    const durationMin = parseMinutes(draft.durationMin);
    const rowErrors: Partial<Record<DrillField, FieldError>> = {};
    if (name === null) rowErrors.name = 'required';
    if (durationMin === 'invalid') rowErrors.durationMin = 'duration';
    if (name === null || durationMin === 'invalid') {
      errors.set(draft.key, rowErrors);
      continue;
    }
    parsed.push({
      name,
      contactLevel: contacts ? draft.contactLevel : 'none',
      ...(durationMin === null ? {} : { durationMin }),
    });
  }
  return errors.size > 0 ? { ok: false, errors } : { ok: true, drills: parsed };
}

function optional<K extends string, V>(key: K, value: V | null): Partial<Record<K, V>> {
  return value === null ? {} : ({ [key]: value } as Record<K, V>);
}

export function createBody(
  session: ParsedSession,
  drills: readonly DrillCreate[],
  clientUuid: string,
): CreateSessionBody {
  return {
    clientUuid,
    kind: session.kind,
    categoryId: session.categoryId,
    startsAt: session.startsAt,
    ...optional('plannedDurationMin', session.plannedDurationMin),
    ...optional('title', session.title),
    ...optional('location', session.location),
    ...optional('opponent', session.opponent),
    ...optional('notes', session.notes),
    ...(drills.length === 0 ? {} : { drills: [...drills] }),
  };
}

type Editable = Exclude<keyof ParsedSession, never>;

/**
 * What changed against the session the user read, and whether it corrects
 * a value already submitted: every column that had a value (the kind, the
 * category and the start always have one).
 */
export function editPatch(
  session: ParsedSession,
  current: TrainingSession,
): { changes: Omit<UpdateSessionBody, 'version' | 'changeReason'>; isCorrection: boolean } {
  const changes: Record<string, unknown> = {};
  let isCorrection = false;
  const previous: Record<Editable, string | number | null> = {
    kind: current.kind,
    categoryId: current.categoryId,
    startsAt: current.startsAt,
    plannedDurationMin: current.plannedDurationMin,
    title: current.title,
    location: current.location,
    opponent: current.opponent,
    notes: current.notes,
  };
  for (const field of Object.keys(previous) as Editable[]) {
    const next = session[field];
    const before = previous[field];
    const same =
      field === 'startsAt'
        ? before !== null && Date.parse(String(before)) === Date.parse(String(next))
        : before === next;
    if (same) continue;
    changes[field] = next;
    if (before !== null) isCorrection = true;
  }
  return {
    changes: changes,
    isCorrection,
  };
}

const SESSION_FIELDS: readonly string[] = [
  'kind',
  'categoryId',
  'plannedDurationMin',
  'title',
  'location',
  'opponent',
  'notes',
];

/** Fields a `validation_failed` of the API points at (`body.<field>`). */
export function apiFieldErrors(error: unknown): SessionFormErrors {
  if (!(error instanceof ApiError) || error.code !== 'validation_failed') return {};
  const errors: SessionFormErrors = {};
  for (const issue of error.details) {
    const [part, field] = issue.path;
    if (part !== 'body' || typeof field !== 'string') continue;
    if (field === 'startsAt') errors.time = 'start';
    else if (SESSION_FIELDS.includes(field)) errors[field as SessionField] = 'invalid';
  }
  return errors;
}
