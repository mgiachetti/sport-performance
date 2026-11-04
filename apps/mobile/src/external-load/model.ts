import type { ExternalLoad, SyncOperationRequest } from '@sport-performance/contracts';
import {
  EXTERNAL_LOAD_DETAIL_MAX_LENGTH,
  EXTERNAL_LOAD_MINUTES_MAX,
  EXTERNAL_LOAD_MINUTES_MIN,
  EXTERNAL_LOAD_REPORT_WINDOW_DAYS,
  addDays,
  compareLocalDates,
  externalLoadAu,
  isWithinExternalLoadWindow,
  ruleFor,
  type ExternalLoadActivity,
  type LocalDate,
  type Role,
} from '@sport-performance/domain';
import type { LocalRow, QueuedMutation } from '../offline/local-store.ts';
import { applyOverlay } from '../offline/overlay.ts';

/**
 * External load in the app (B-511, ADR 0084): what the player trained
 * outside the club, written through the offline queue and read from the
 * local database. Pure functions, without React Native.
 */

/**
 * Who reports external load on the phone: whoever the matrix lets
 * `external_load.report` (the player, on themselves; the consent is the
 * server's to check).
 */
export function canReportExternalLoad(role: Role): boolean {
  return ruleFor('external_load', 'report', role).effect === 'allow';
}

/** The operations of the queue this screen writes. */
export const EXTERNAL_LOAD_OPS = [
  'external_load.report',
  'external_load.correct',
  'external_load.archive',
] as const;

/** Minutes offered as one tap; any other value is typed. */
export const MINUTES_PRESETS = [30, 45, 60, 90] as const;

/** The club days the player may report, today first. */
export function reportableDays(today: LocalDate): LocalDate[] {
  return Array.from({ length: EXTERNAL_LOAD_REPORT_WINDOW_DAYS }, (_, i) => addDays(today, -i));
}

/** What the form holds while the player fills it. */
export interface ExternalLoadDraft {
  readonly activity: ExternalLoadActivity | null;
  readonly detail: string;
  readonly day: LocalDate;
  /** As typed (`60`) or chosen from the presets. */
  readonly minutesText: string;
  readonly rpe: number | null;
}

export function emptyDraft(today: LocalDate): ExternalLoadDraft {
  return { activity: null, detail: '', day: today, minutesText: '', rpe: null };
}

/** Whole minutes from what was typed; `null` when it is not a whole number in range. */
export function parseMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const minutes = Number(trimmed);
  return minutes >= EXTERNAL_LOAD_MINUTES_MIN && minutes <= EXTERNAL_LOAD_MINUTES_MAX
    ? minutes
    : null;
}

export type DraftProblem =
  'activity_missing' | 'minutes_invalid' | 'rpe_missing' | 'day_outside' | 'detail_too_long';

/** What is wrong with a draft, by field (empty when it can be saved). */
export function draftProblems(
  draft: ExternalLoadDraft,
  today: LocalDate,
): Partial<Record<'activity' | 'minutes' | 'rpe' | 'day' | 'detail', DraftProblem>> {
  const problems: Partial<Record<'activity' | 'minutes' | 'rpe' | 'day' | 'detail', DraftProblem>> =
    {};
  if (draft.activity === null) problems.activity = 'activity_missing';
  if (parseMinutes(draft.minutesText) === null) problems.minutes = 'minutes_invalid';
  if (draft.rpe === null) problems.rpe = 'rpe_missing';
  if (!isWithinExternalLoadWindow(draft.day, today)) problems.day = 'day_outside';
  if (draft.detail.trim().length > EXTERNAL_LOAD_DETAIL_MAX_LENGTH) {
    problems.detail = 'detail_too_long';
  }
  return problems;
}

/** The load of a draft as it would count (RPE × minutes), or `null` while incomplete. */
export function draftLoadAu(draft: ExternalLoadDraft): number | null {
  const minutes = parseMinutes(draft.minutesText);
  if (minutes === null || draft.rpe === null) return null;
  return externalLoadAu({ minutes, rpe: draft.rpe });
}

function detailOf(draft: ExternalLoadDraft): string | null {
  const detail = draft.detail.trim();
  return detail === '' ? null : detail;
}

/** The queue's create of a complete draft (`draftProblems` empty), with its `clientUuid`. */
export function reportRequest(
  draft: ExternalLoadDraft,
  clientUuid: string,
): SyncOperationRequest<'external_load.report'> {
  const minutes = parseMinutes(draft.minutesText);
  if (draft.activity === null || minutes === null || draft.rpe === null) {
    throw new Error('reportRequest: the draft is not complete');
  }
  const detail = detailOf(draft);
  return {
    body: {
      clientUuid,
      // Always the day the player chose: the queue may sync after midnight.
      localDate: draft.day,
      activity: draft.activity,
      ...(detail !== null && { detail }),
      minutes,
      rpe: draft.rpe,
    },
  };
}

/** Where a row is in its life on this device, always said with icon and text. */
export type ExternalLoadItemState = 'local' | 'pending' | 'synced';

/** An activity of the window, as the screen lists it. */
export interface ExternalLoadItem {
  /** Stable key: the server id, or the `clientUuid` of a create not pulled yet. */
  readonly key: string;
  /** How a correction or an archive names it in the queue. */
  readonly target: { readonly id: string } | { readonly clientUuid: string };
  readonly localDate: LocalDate;
  readonly activity: ExternalLoadActivity;
  readonly detail: string | null;
  readonly minutes: number;
  readonly rpe: number;
  readonly srpeAu: number;
  readonly state: ExternalLoadItemState;
}

/** A draft that starts from an item, to correct it. */
export function draftOf(item: ExternalLoadItem): ExternalLoadDraft {
  return {
    activity: item.activity,
    detail: item.detail ?? '',
    day: item.localDate,
    minutesText: String(item.minutes),
    rpe: item.rpe,
  };
}

/**
 * The queue's correction of an item: only what changed, with the reason
 * (ADR 0030). `null` when nothing changed.
 */
export function correctionRequest(
  item: ExternalLoadItem,
  draft: ExternalLoadDraft,
  changeReason: string,
): SyncOperationRequest<'external_load.correct'> | null {
  const minutes = parseMinutes(draft.minutesText);
  if (draft.activity === null || minutes === null || draft.rpe === null) {
    throw new Error('correctionRequest: the draft is not complete');
  }
  const detail = detailOf(draft);
  const changes = {
    ...(draft.day !== item.localDate && { localDate: draft.day }),
    ...(draft.activity !== item.activity && { activity: draft.activity }),
    ...(detail !== item.detail && { detail }),
    ...(minutes !== item.minutes && { minutes }),
    ...(draft.rpe !== item.rpe && { rpe: draft.rpe }),
  };
  if (Object.keys(changes).length === 0) return null;
  return { target: item.target, body: { changeReason: changeReason.trim(), ...changes } };
}

export function archiveRequest(
  item: ExternalLoadItem,
): SyncOperationRequest<'external_load.archive'> {
  return { target: item.target };
}

function itemOf(
  row: ExternalLoad,
  key: string,
  target: ExternalLoadItem['target'],
  state: ExternalLoadItemState,
): ExternalLoadItem {
  return {
    key,
    target,
    localDate: row.localDate,
    activity: row.activity,
    detail: row.detail,
    minutes: row.minutes,
    rpe: row.rpe,
    srpeAu: row.srpeAu,
    state,
  };
}

function namesClientUuid(mutation: QueuedMutation, clientUuid: string): boolean {
  return mutation.targets.some(
    (target) => target.collection === 'external_load' && target.clientUuid === clientUuid,
  );
}

/**
 * The activities of `from`..`to` (club days, inclusive), newest day first:
 * the rows the server served (with the queued edits laid over by the local
 * store) and the creates of the queue that have not come back in a pull,
 * with the corrections and archives queued for them applied the same way.
 * Archived ones are left out: they no longer count.
 */
export function externalLoadItems(input: {
  readonly synced: readonly LocalRow<'external_load'>[];
  readonly queue: readonly QueuedMutation[];
  readonly from: LocalDate;
  readonly to: LocalDate;
  /** The player's own id, for the rows built from the queue. */
  readonly playerId?: string;
}): ExternalLoadItem[] {
  const items: ExternalLoadItem[] = [];
  const pulled = new Set<string>();
  for (const row of input.synced) {
    if (row.clientUuid !== null) pulled.add(row.clientUuid);
    if (row.data.archivedAt !== null) continue;
    items.push(itemOf(row.data, row.id, { id: row.id }, row.pending ? 'pending' : 'synced'));
  }
  for (const queued of input.queue) {
    if (queued.op !== 'external_load.report') continue;
    const { body } = (queued as QueuedMutation<'external_load.report'>).input;
    const clientUuid = body.clientUuid;
    if (clientUuid === undefined || pulled.has(clientUuid)) continue;
    const created = new Date(queued.createdAt).toISOString();
    const minutes = body.minutes;
    let row: ExternalLoad = {
      id: clientUuid,
      playerId: (input.playerId ?? '') as ExternalLoad['playerId'],
      localDate: body.localDate ?? input.to,
      activity: body.activity,
      detail: body.detail ?? null,
      minutes,
      rpe: body.rpe,
      srpeAu: body.rpe * minutes,
      reportedBy: 'player',
      archivedAt: null,
      createdAt: created,
      updatedAt: created,
      version: '0',
    };
    for (const later of input.queue) {
      if (later.seq <= queued.seq || !namesClientUuid(later, clientUuid)) continue;
      row = applyOverlay(later.op, row, later.input, {
        enqueuedAt: later.createdAt,
      }) as ExternalLoad;
    }
    if (row.archivedAt !== null) continue;
    // Applied by the server but not pulled yet: it is sent.
    const sent = queued.state === 'acked';
    items.push(itemOf(row, clientUuid, { clientUuid }, sent ? 'synced' : 'local'));
  }
  return items
    .filter(
      (item) =>
        compareLocalDates(item.localDate, input.from) >= 0 &&
        compareLocalDates(item.localDate, input.to) <= 0,
    )
    .sort((a, b) => compareLocalDates(b.localDate, a.localDate) || a.key.localeCompare(b.key));
}

/** Count and load of the listed activities. */
export function externalLoadTotal(items: readonly ExternalLoadItem[]): {
  readonly count: number;
  readonly loadAu: number;
} {
  return { count: items.length, loadAu: items.reduce((sum, item) => sum + item.srpeAu, 0) };
}
