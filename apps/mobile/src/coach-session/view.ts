import type { SessionRosterEntry, TrainingSession } from '@sport-performance/contracts';
import { participationCarriesLoad, type TimeZone } from '@sport-performance/domain';
import { formatLocalDate, formatTime, type Translator } from '@sport-performance/i18n';
import type { CoachClub, SheetDraft } from './data.ts';
import {
  clockElapsedMs,
  clockRunning,
  initialDraft,
  mergeDraftRow,
  minutesOf,
  playedMsOf,
  rowValues,
  sheetSummary,
  type DraftRow,
  type FieldClock,
  type KnownParticipation,
  type RowError,
  type SheetSummary,
} from './model.ts';

/**
 * What the screens of the coach's session show, from the session, its kept
 * roster, what the phone knows and the draft (B-509). Pure: the routes pass
 * the time.
 */

export function categoryName(club: CoachClub | null, categoryId: string | null): string | null {
  if (categoryId === null) return null;
  return club?.categories.find((category) => category.id === categoryId)?.name ?? null;
}

/** The session's own title, or what it is: "Partido contra Hindú", "Entrenamiento M17". */
export function sessionTitle(
  session: Pick<TrainingSession, 'title' | 'kind' | 'opponent'>,
  category: string | null,
  { t }: Translator,
): string {
  if (session.title !== null) return session.title;
  if (session.kind === 'match' && session.opponent !== null) {
    return t('coachSession.session.matchAgainst', { opponent: session.opponent });
  }
  const name = category ?? t('coachSession.session.noCategory');
  return session.kind === 'match'
    ? t('coachSession.session.untitledMatch', { category: name })
    : t('coachSession.session.untitledTraining', { category: name });
}

/** "Partido · 03/11/2026 18:30", in the club's time zone. */
export function sessionWhen(
  session: Pick<TrainingSession, 'kind' | 'startsAt' | 'localDate'>,
  timeZone: TimeZone,
  { t }: Translator,
): string {
  return t('coachSession.session.when', {
    kind: t(`coachSession.kind.${session.kind}`),
    date: formatLocalDate(session.localDate as Parameters<typeof formatLocalDate>[0]),
    time: formatTime(new Date(session.startsAt), { timeZone }),
  });
}

export interface SessionListItem {
  readonly id: string;
  readonly title: string;
  readonly when: string;
  readonly drafted: boolean;
}

export function sessionListItems(
  sessions: readonly TrainingSession[],
  club: CoachClub | null,
  timeZone: TimeZone,
  drafted: ReadonlySet<string>,
  translator: Translator,
): SessionListItem[] {
  return sessions.map((session) => ({
    id: session.id,
    title: sessionTitle(session, categoryName(club, session.categoryId), translator),
    when: sessionWhen(session, timeZone, translator),
    drafted: drafted.has(session.id),
  }));
}

// ─── Sheet ───────────────────────────────────────────────────────────────────────────

export type ReadOnlyReason = 'noConsent' | 'notAllowed' | 'leftClub';

export interface SheetPlayer {
  readonly id: string;
  /** "Apellido, Nombre", as the roster sorts them. */
  readonly name: string;
  readonly calledUp: boolean;
  readonly availability: SessionRosterEntry['availability'];
  /** `null`: the coach can load this player. */
  readonly readOnly: ReadOnlyReason | null;
  readonly row: DraftRow;
  readonly errors: readonly RowError[];
  /** The coach changed this row and did not save it yet. */
  readonly edited: boolean;
  /** Saved on the phone, not sent to the server yet. */
  readonly unsent: boolean;
  readonly rpe: number | null;
  readonly srpeAu: number | null;
  /** On the clock: `null` without a clock. */
  readonly field: { readonly on: boolean; readonly minutes: number } | null;
  /**
   * The medical staff marked the player unavailable and the sheet has them
   * playing (on the field now, or a status with load): a warning, never a block.
   */
  readonly playsWhileUnavailable: boolean;
}

function readOnlyReason(entry: SessionRosterEntry): ReadOnlyReason | null {
  if (entry.player.archivedAt !== null && !entry.canRecord) return 'leftClub';
  if (!entry.hasDataConsent) return 'noConsent';
  if (!entry.canRecord) return 'notAllowed';
  return null;
}

/**
 * The row of each player: the fields the coach touched in the draft over
 * what the phone knows now (with the availability suggestion).
 */
export function effectiveRows(
  entries: readonly SessionRosterEntry[],
  known: ReadonlyMap<string, KnownParticipation>,
  draft: SheetDraft,
): Map<string, DraftRow> {
  return new Map(
    entries.map((entry) => [
      entry.player.id,
      mergeDraftRow(
        initialDraft(entry, known.get(entry.player.id) ?? null),
        draft.rows[entry.player.id],
      ),
    ]),
  );
}

export function sheetPlayers(
  entries: readonly SessionRosterEntry[],
  known: ReadonlyMap<string, KnownParticipation>,
  draft: SheetDraft,
  errors: ReadonlyMap<string, readonly RowError[]>,
  nowMs: number,
): SheetPlayer[] {
  const rows = effectiveRows(entries, known, draft);
  const clock = draft.clock;
  return entries.map((entry) => {
    const id = entry.player.id;
    const current = known.get(id) ?? null;
    const row = rows.get(id) ?? initialDraft(entry, current);
    const onField = clock?.onField.includes(id) ?? false;
    return {
      id,
      name: `${entry.player.lastName}, ${entry.player.firstName}`,
      calledUp: !entry.inCategory,
      availability: entry.availability,
      readOnly: readOnlyReason(entry),
      row,
      errors: errors.get(id) ?? [],
      edited: draft.rows[id] !== undefined,
      unsent: current?.pending ?? false,
      rpe: current?.rpe ?? null,
      srpeAu: current?.srpeAu ?? null,
      field:
        clock === null ? null : { on: onField, minutes: minutesOf(playedMsOf(clock, id, nowMs)) },
      playsWhileUnavailable:
        entry.availability?.status === 'unavailable' &&
        (onField || (row.status !== '' && participationCarriesLoad(row.status))),
    };
  });
}

export type ClockView =
  | { readonly status: 'off' }
  | {
      readonly status: 'running' | 'paused';
      readonly elapsedS: number;
      readonly onField: number;
      /** Periods the pauses closed (a match by period, B-803). */
      readonly periods: number;
    };

export function clockView(clock: FieldClock | null, nowMs: number): ClockView {
  if (clock === null) return { status: 'off' };
  return {
    status: clockRunning(clock) ? 'running' : 'paused',
    elapsedS: Math.floor(clockElapsedMs(clock, nowMs) / 1000),
    onField: clock.onField.length,
    periods: clock.periodEndsMs?.length ?? 0,
  };
}

/** The summary of the sheet as it is now, only over the players that are loaded or loadable. */
export function summaryOf(players: readonly SheetPlayer[]): SheetSummary {
  return sheetSummary(players.map((player) => player.row));
}

/** Players the coach can load whose row does not parse (minutes or contacts out of range). */
export function rowErrors(
  rows: ReadonlyMap<string, DraftRow>,
  editable: ReadonlySet<string>,
): Map<string, RowError[]> {
  const errors = new Map<string, RowError[]>();
  for (const [playerId, row] of rows) {
    if (!editable.has(playerId)) continue;
    const values = rowValues(row);
    if (values !== null && 'errors' in values) errors.set(playerId, values.errors);
  }
  return errors;
}

/** The players the coach can load (the matrix and a current data consent). */
export function editablePlayers(entries: readonly SessionRosterEntry[]): Set<string> {
  return new Set(entries.filter((entry) => entry.canRecord).map((entry) => entry.player.id));
}
