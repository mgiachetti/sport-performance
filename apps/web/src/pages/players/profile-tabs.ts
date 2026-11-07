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
 * The tabs the role may see, in order, and whether they need a bar: one
 * block alone is shown without one (ADR 0104: 2 to 4 segments).
 */
export function visibleProfileTabs(allowed: Readonly<Record<ProfileTab, boolean>>): {
  tabs: readonly ProfileTab[];
  bar: boolean;
} {
  const tabs = PROFILE_TABS.filter((tab) => allowed[tab]);
  return { tabs, bar: tabs.length > 1 };
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

/**
 * The tab where each alert's data lives, so the tab carries its badge and a
 * link from that alert opens there. `growth_peak` has none: it is the
 * maturation card, always in sight.
 */
const TAB_OF_ALERT: Readonly<Partial<Record<string, ProfileTab>>> = {
  acwr_high: 'load',
  acwr_low: 'load',
  wellness_low: 'load',
  wellness_zscore_low: 'load',
  cmj_drop: 'evolution',
};

export function tabOfAlert(kind: string): ProfileTab | undefined {
  return TAB_OF_ALERT[kind];
}

type Severity = 'warning' | 'critical';

/** The worst open alert of each tab (its badge). */
export function alertSeverityByTab(
  alerts: readonly { kind: string; severity: Severity; resolvedOn: unknown }[],
): Partial<Record<ProfileTab, Severity>> {
  const worst: Partial<Record<ProfileTab, Severity>> = {};
  for (const alert of alerts) {
    if (alert.resolvedOn !== null) continue;
    const tab = tabOfAlert(alert.kind);
    if (tab === undefined || worst[tab] === 'critical') continue;
    worst[tab] = alert.severity;
  }
  return worst;
}
