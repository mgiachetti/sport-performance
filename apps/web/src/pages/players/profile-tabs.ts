/**
 * Tabs of the player profile (ADR 0104): what stays above them (header,
 * availability, maturation with the growth-peak warning, alerts) never moves
 * behind a tab; the long blocks with charts and tables go one at a time.
 */
export const PROFILE_TABS = ['load', 'evolution', 'percentiles', 'gym'] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

/** `?tab=` of `/players/$playerId`; anything malformed is dropped. */
export interface PlayerProfileSearch {
  readonly tab?: ProfileTab | undefined;
}

export function isProfileTab(value: unknown): value is ProfileTab {
  return typeof value === 'string' && (PROFILE_TABS as readonly string[]).includes(value);
}

export function parsePlayerProfileSearch(
  search: Readonly<Record<string, unknown>>,
): PlayerProfileSearch {
  return isProfileTab(search.tab) ? { tab: search.tab } : {};
}

/**
 * The tab to show: the URL's, else the one the user last opened, else the
 * first. Only among the tabs the role may see; `null` when it sees none.
 */
export function currentProfileTab(
  allowed: readonly ProfileTab[],
  fromUrl: ProfileTab | undefined,
  remembered: string | undefined,
): ProfileTab | null {
  if (fromUrl !== undefined && allowed.includes(fromUrl)) return fromUrl;
  if (isProfileTab(remembered) && allowed.includes(remembered)) return remembered;
  return allowed[0] ?? null;
}
