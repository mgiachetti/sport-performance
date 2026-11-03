import { isLocalDate, type LocalDate } from '@sport-performance/domain';
import { PANEL_GROUPINGS, type PanelGrouping } from './panel-model';

/**
 * Search params of the weekly panel, on top of the layout's `?sport&category`:
 * `?week=` (any day of the week; none is the current one) and `?group=` (how
 * players are grouped; none is by category). Shared links reopen the same view.
 */
export interface PanelSearch {
  readonly week?: LocalDate | undefined;
  readonly group?: Exclude<PanelGrouping, 'category'> | undefined;
}

function isGrouping(value: unknown): value is PanelGrouping {
  return typeof value === 'string' && (PANEL_GROUPINGS as readonly string[]).includes(value);
}

/** `validateSearch` of the panel route: drops anything malformed. */
export function parsePanelSearch(search: Readonly<Record<string, unknown>>): PanelSearch {
  const week = isLocalDate(search.week) ? search.week : undefined;
  const group = isGrouping(search.group) && search.group !== 'category' ? search.group : undefined;
  return {
    ...(week === undefined ? {} : { week }),
    ...(group === undefined ? {} : { group }),
  };
}
