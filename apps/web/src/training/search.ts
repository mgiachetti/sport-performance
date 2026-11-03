import { isLocalDate, type ExposureContext, type LocalDate } from '@sport-performance/domain';

/**
 * Filters of the session list in the URL (`?kind=match&from=2026-03-01`), so
 * a filtered list can be shared and reloaded. Sport and category come from
 * the club layout's scope.
 */
export interface SessionsSearch {
  readonly kind?: ExposureContext | undefined;
  readonly from?: LocalDate | undefined;
  readonly to?: LocalDate | undefined;
  readonly archived?: true | undefined;
}

export function parseSessionsSearch(search: Readonly<Record<string, unknown>>): SessionsSearch {
  const kind = search.kind === 'training' || search.kind === 'match' ? search.kind : undefined;
  const from = isLocalDate(search.from) ? search.from : undefined;
  const to = isLocalDate(search.to) ? search.to : undefined;
  const archived = search.archived === true || search.archived === 'true' ? true : undefined;
  return {
    ...(kind === undefined ? {} : { kind }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(archived === undefined ? {} : { archived }),
  };
}
