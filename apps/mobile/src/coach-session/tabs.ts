import type { RowError } from './model.ts';
import type { SheetPlayer } from './view.ts';

/**
 * The tabs of the session sheet by dimension (ADR 0104): attendance, minutes
 * and, only in a sport with contacts, contacts. Each tab shows the roster
 * with that dimension's controls.
 */
export type SheetTab = 'attendance' | 'minutes' | 'contacts';

export function sheetTabs(rules: { readonly contacts: boolean }): readonly SheetTab[] {
  return rules.contacts ? ['attendance', 'minutes', 'contacts'] : ['attendance', 'minutes'];
}

/** The tab where a row error is fixed. */
export function tabOfError(error: RowError): SheetTab {
  return error === 'minutes' ? 'minutes' : 'contacts';
}

export interface SheetTabCounts {
  /** Players the coach can load that have no status yet. */
  readonly noStatus: number;
  /** Players with an invalid value, by the tab where it is fixed. */
  readonly errors: Readonly<Record<SheetTab, number>>;
}

export function sheetTabCounts(players: readonly SheetPlayer[]): SheetTabCounts {
  const errors: Record<SheetTab, number> = { attendance: 0, minutes: 0, contacts: 0 };
  let noStatus = 0;
  for (const player of players) {
    if (player.readOnly === null && player.row.status === '') noStatus += 1;
    for (const tab of new Set(player.errors.map(tabOfError))) errors[tab] += 1;
  }
  return { noStatus, errors };
}

/** The first tab, in the order shown, with an invalid value; `null` when every row parses. */
export function firstTabWithError(
  players: readonly SheetPlayer[],
  tabs: readonly SheetTab[],
): SheetTab | null {
  const { errors } = sheetTabCounts(players);
  return tabs.find((tab) => errors[tab] > 0) ?? null;
}
