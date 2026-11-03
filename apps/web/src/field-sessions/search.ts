import { isExposureContext, type ExposureContext } from '@sport-performance/domain';

/** Search params of the list of field sessions (B-408): the kind filter. */
export interface FieldSessionsSearch {
  readonly kind?: ExposureContext | undefined;
}

/** `validateSearch` of `/field-sessions`: drops anything malformed. */
export function parseFieldSessionsSearch(
  search: Readonly<Record<string, unknown>>,
): FieldSessionsSearch {
  return isExposureContext(search.kind) ? { kind: search.kind } : {};
}
