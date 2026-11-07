import type { ClubSelection } from '../api/club-selection';

/**
 * Last tab opened on each tabbed screen, per club selection (ADR 0104): a link
 * without `?tab=` (the roster opening another player) reopens the tab the user
 * was on instead of the first one. Lives only in memory, holds only the tab's
 * key, and sign-out forgets it so the next person on the computer starts clean.
 */
const remembered = new Map<string, string>();

function keyOf(selection: ClubSelection, screen: string): string {
  const club =
    selection.kind === 'membership'
      ? `membership:${selection.membershipId}`
      : `support:${selection.clubId}`;
  return `${club}|${screen}`;
}

export function rememberedTab(selection: ClubSelection, screen: string): string | undefined {
  return remembered.get(keyOf(selection, screen));
}

export function rememberTab(selection: ClubSelection, screen: string, tab: string): void {
  remembered.set(keyOf(selection, screen), tab);
}

/** Called on sign-out. */
export function forgetRememberedTabs(): void {
  remembered.clear();
}
