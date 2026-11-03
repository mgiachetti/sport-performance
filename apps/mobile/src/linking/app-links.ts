import { invitationTokenSchema, playerAccessTokenSchema } from '@sport-performance/contracts';

/**
 * Links that open the app (ADR 0028, ADR 0042), as the API builds them:
 * - `<scheme>://invite/<token>` and `<WEB_APP_URL>/invite/<token>` (Universal
 *   Link / App Link): an invitation to a club.
 * - `<scheme>://player-access/<token>` and `<WEB_APP_URL>/player-access/<token>`:
 *   the sign-in link a guardian shares with a player without email.
 */
export const APP_LINK_KINDS = ['invite', 'player-access'] as const;
export type AppLinkKind = (typeof APP_LINK_KINDS)[number];

export type AppLink =
  | { readonly kind: AppLinkKind; readonly token: string }
  /** Ours (our scheme or web host), but not a link the app knows or with a malformed token. */
  | { readonly kind: 'unknown' };

export interface AppLinkOrigins {
  /** Deep link scheme of this build (`sportperformance`). */
  readonly scheme: string;
  /** Origin (and optional path prefix) of the web; `null` when not configured. */
  readonly webAppUrl: string | null;
}

const TOKEN_SCHEMAS = {
  invite: invitationTokenSchema,
  'player-access': playerAccessTokenSchema,
} as const;

function isAppLinkKind(value: string | undefined): value is AppLinkKind {
  return value !== undefined && (APP_LINK_KINDS as readonly string[]).includes(value);
}

function linkFromSegments(segments: readonly string[]): AppLink {
  const [kind, token, ...rest] = segments;
  if (!isAppLinkKind(kind) || token === undefined || rest.length > 0) return { kind: 'unknown' };
  return TOKEN_SCHEMAS[kind].safeParse(token).success ? { kind, token } : { kind: 'unknown' };
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/').filter((segment) => segment !== '');
}

/**
 * Reads a URL the system handed to the app. `null` when it is not ours
 * (another scheme or host, the development client's own URLs): it is left
 * to the router as is. Query strings and fragments are ignored.
 */
export function parseAppLink(rawUrl: string, origins: AppLinkOrigins): AppLink | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol === `${origins.scheme}:`) {
    // `scheme://invite/<token>`: the first segment parses as the host.
    const host = url.host === '' ? [] : [decodeURIComponent(url.host)];
    return linkFromSegments([...host, ...segmentsOf(url.pathname)]);
  }
  if (origins.webAppUrl === null || url.protocol !== 'https:') return null;
  const web = new URL(origins.webAppUrl);
  if (url.host !== web.host) return null;
  const prefix = segmentsOf(web.pathname);
  const segments = segmentsOf(url.pathname);
  if (prefix.some((segment, index) => segments[index] !== segment)) return null;
  return linkFromSegments(segments.slice(prefix.length));
}

/** Route of the app for a link: what `+native-intent` hands to the router. */
export function routeForAppLink(link: AppLink): string {
  return link.kind === 'unknown' ? '/' : `/${link.kind}/${link.token}`;
}

/**
 * The path the router should open for a system URL: our links mapped to
 * their screen (anything of ours that is not a known link goes home), any
 * other URL unchanged.
 */
export function redirectSystemPath(rawUrl: string, origins: AppLinkOrigins): string {
  const link = parseAppLink(rawUrl, origins);
  return link === null ? rawUrl : routeForAppLink(link);
}
