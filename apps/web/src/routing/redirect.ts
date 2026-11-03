/**
 * `?redirect=` of the sign-in and club selector: where to go back after.
 * Only paths of this app are accepted (`/…`, not `//host` or `/\host`), so
 * a crafted link cannot send the user to another site after signing in.
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined;
  if (value.startsWith('/login')) return undefined;
  // eslint-disable-next-line no-control-regex -- control characters make a path ambiguous
  if (/[\u0000-\u001f]/.test(value)) return undefined;
  return value;
}

export interface LoginSearch {
  readonly redirect?: string;
  /** The session ended while using the app (not a first visit). */
  readonly expired?: true;
}

export function parseLoginSearch(search: Readonly<Record<string, unknown>>): LoginSearch {
  const redirect = safeRedirect(search.redirect);
  return {
    ...(redirect === undefined ? {} : { redirect }),
    ...(search.expired === true || search.expired === 'true' ? { expired: true } : {}),
  };
}

export interface ClubsSearch {
  readonly redirect?: string;
  /** The remembered club is no longer available to the user. */
  readonly unavailable?: true;
}

export function parseClubsSearch(search: Readonly<Record<string, unknown>>): ClubsSearch {
  const redirect = safeRedirect(search.redirect);
  return {
    ...(redirect === undefined ? {} : { redirect }),
    ...(search.unavailable === true || search.unavailable === 'true' ? { unavailable: true } : {}),
  };
}
