import type { Page, Player } from '@sport-performance/contracts';
import {
  ift3015MissStreak,
  ift3015PlayerResult,
  ruleFor,
  type Ift3015Cue,
  type Ift3015PlayerMarks,
  type Role,
} from '@sport-performance/domain';
import type { Translator } from '@sport-performance/i18n';
import type { IftResultRow, IftRosterPlayer, IftRunRow } from '../screens/ift-3015.tsx';
import type { IftRunSnapshot } from './run-store.ts';

/** Who runs the test on the phone: whoever records test results (`test_result.record`). */
export function canRunIft3015(role: Role): boolean {
  return ruleFor('test_result', 'record', role).effect === 'allow';
}

/** Page size of the roster reads (the API maximum). */
export const ROSTER_PAGE_LIMIT = 100;

/** Follows `nextCursor` to the end; `maxPages` bounds a runaway cursor. */
export async function fetchAllPages<Item>(
  fetchPage: (cursor: string | undefined) => Promise<Page<Item>>,
  maxPages = 20,
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return items;
}

/** The roster as the screen shows it: first name and last name. */
export function rosterOf(players: readonly Player[]): IftRosterPlayer[] {
  return players.map((player) => ({
    id: player.id,
    name: `${player.firstName} ${player.lastName}`,
  }));
}

/**
 * The player of each mark, by id. A run restored without its roster (no
 * signal, or the player left the category) shows a numbered placeholder,
 * never another player's name.
 */
function playerOf(
  marks: Ift3015PlayerMarks,
  index: number,
  names: ReadonlyMap<string, string>,
  { t }: Translator,
): IftRosterPlayer {
  return {
    id: marks.playerId,
    name: names.get(marks.playerId) ?? t('ift.player.unknown', { number: index + 1 }),
  };
}

export function runRows(
  players: readonly Ift3015PlayerMarks[],
  schedule: readonly Ift3015Cue[],
  elapsedMs: number,
  names: ReadonlyMap<string, string>,
  translator: Translator,
): IftRunRow[] {
  return players.map((marks, index) => ({
    player: playerOf(marks, index, names, translator),
    marks,
    streak: ift3015MissStreak(marks, schedule, elapsedMs),
  }));
}

/**
 * A run ended after the app was killed (`endedBy: 'interrupted'`) flags the
 * players who were still running then: their stage is the one completed at
 * the last moment the signals played, for the staff to check.
 */
export function resultRows(
  run: Pick<IftRunSnapshot, 'players' | 'protocol' | 'endedAtMs' | 'endedBy'>,
  names: ReadonlyMap<string, string>,
  translator: Translator,
): IftResultRow[] {
  const { players, protocol } = run;
  return players.flatMap((marks, index) => {
    const result = ift3015PlayerResult(marks, protocol);
    if (result === null) return [];
    return [
      {
        player: playerOf(marks, index, names, translator),
        result,
        misses: protocol.missesToStop,
        cutShort:
          run.endedBy === 'interrupted' &&
          marks.outcome !== 'missed_lines' &&
          marks.endedAtMs === run.endedAtMs,
      },
    ];
  });
}
