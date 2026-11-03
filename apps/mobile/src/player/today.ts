import type {
  MyTrainingSession,
  Participation,
  SyncOperationInput,
} from '@sport-performance/contracts';
import {
  addDays,
  compareLocalDates,
  participationCarriesLoad,
  type LocalDate,
  type WellnessItem,
} from '@sport-performance/domain';
import type { LocalRow, QueuedMutation } from '../offline/local-store.ts';

type Scores = Partial<Record<WellnessItem, number | undefined>>;

/** Today's check-in as the phone sees it: synced, or still in the queue. */
export interface TodayWellness {
  readonly scores: Scores;
  /** What a correction targets: the server row, or the queued create by its `clientUuid`. */
  readonly target: { readonly id: string } | { readonly clientUuid: string };
  /** Not answered by the server yet. */
  readonly pending: boolean;
}

/**
 * The check-in of `today` (B-503): the synced row with its queued
 * corrections laid over (the local store does it), or else a queued submit
 * of that day with the corrections that target its `clientUuid`.
 */
export function todayWellness(
  rows: readonly LocalRow<'wellness'>[],
  queue: readonly QueuedMutation[],
  today: LocalDate,
): TodayWellness | null {
  const synced = rows.find((row) => row.data.localDate === today);
  if (synced !== undefined) {
    return { scores: synced.data.scores, target: { id: synced.id }, pending: synced.pending };
  }
  for (const queued of queue) {
    if (queued.op !== 'wellness.submit') continue;
    const { body } = queued.input as SyncOperationInput<'wellness.submit'>;
    if ((body.localDate ?? null) !== today || body.clientUuid === undefined) continue;
    let scores: Scores = { ...body.scores };
    for (const later of queue) {
      if (later.seq <= queued.seq || later.op !== 'wellness.correct') continue;
      const correction = later.input as SyncOperationInput<'wellness.correct'>;
      if ('clientUuid' in correction.target && correction.target.clientUuid === body.clientUuid) {
        scores = { ...scores, ...correction.body.scores };
      }
    }
    return { scores, target: { clientUuid: body.clientUuid }, pending: true };
  }
  return null;
}

/** Club days with a check-in: synced rows and queued submits. */
export function checkInDays(
  rows: readonly LocalRow<'wellness'>[],
  queue: readonly QueuedMutation[],
): LocalDate[] {
  const days = rows.map((row) => row.data.localDate);
  for (const queued of queue) {
    if (queued.op !== 'wellness.submit') continue;
    const { body } = queued.input as SyncOperationInput<'wellness.submit'>;
    if (body.localDate !== undefined) days.push(body.localDate);
  }
  return days;
}

/** One session of today or yesterday the player may rate. */
export interface RpeSession {
  readonly session: MyTrainingSession['session'];
  readonly closesAt: string;
  /** The RPE on the phone: synced, or queued. */
  readonly rpe: number | null;
  readonly minutes: number | null;
  readonly pending: boolean;
  /** The window is open and the player took part (or the staff has not loaded it yet). */
  readonly canSubmit: boolean;
}

export interface RpeSessionsInput {
  /** `GET /v1/me/training-sessions` of yesterday and today, as last fetched. */
  readonly sessions: readonly MyTrainingSession[];
  /** The player's participations of the local database (queued edits laid over). */
  readonly participations: readonly LocalRow<'participation'>[];
  readonly queue: readonly QueuedMutation[];
  readonly nowMs: number;
}

function windowOpen(session: MyTrainingSession, nowMs: number): boolean {
  return (
    Date.parse(session.rpeWindow.opensAt) <= nowMs && nowMs < Date.parse(session.rpeWindow.closesAt)
  );
}

/**
 * The sessions to rate (B-503): those whose RPE window is open now (from the
 * start of the session to the end of the next club day) or that already have
 * an RPE, oldest first. The participation of the local database wins over
 * the one of the cached list (it is newer, with the queue laid over); without
 * one, a queued RPE says what the player sent. Absent or unavailable players
 * rate nothing: the online rule (no participation, no load).
 */
export function rpeSessions(input: RpeSessionsInput): RpeSession[] {
  const items: RpeSession[] = [];
  for (const entry of input.sessions) {
    if (entry.session.archivedAt !== null) continue;
    const local = input.participations.find(
      (row) => row.data.trainingSessionId === entry.session.id,
    );
    const participation: Participation | null = local?.data ?? entry.participation;
    let rpe = participation?.rpe ?? null;
    let pending = local?.pending ?? false;
    if (local === undefined) {
      for (const queued of input.queue) {
        if (queued.op !== 'rpe.submit') continue;
        const { params, body } = queued.input as SyncOperationInput<'rpe.submit'>;
        if (params.trainingSessionId !== entry.session.id) continue;
        rpe = body.rpe;
        pending = true;
      }
    }
    const takesPart = participation === null || participationCarriesLoad(participation.status);
    const open = windowOpen(entry, input.nowMs);
    if (!takesPart || (!open && rpe === null)) continue;
    items.push({
      session: entry.session,
      closesAt: entry.rpeWindow.closesAt,
      rpe,
      minutes: participation?.minutes ?? entry.session.plannedDurationMin,
      pending,
      canSubmit: open,
    });
  }
  return items.sort((a, b) => (a.session.startsAt < b.session.startsAt ? -1 : 1));
}

/** The club days the RPE list covers: yesterday and today. */
export function rpeRange(today: LocalDate): { from: LocalDate; to: LocalDate } {
  return { from: addDays(today, -1), to: today };
}

/** The first upcoming test day on or after today. */
export function nextTestDay<T extends { scheduledOn: LocalDate }>(
  days: readonly T[],
  today: LocalDate,
): T | null {
  return (
    [...days]
      .filter((day) => compareLocalDates(day.scheduledOn, today) >= 0)
      .sort((a, b) => compareLocalDates(a.scheduledOn, b.scheduledOn))[0] ?? null
  );
}
