import {
  ApiError,
  MEMBERSHIP_HEADER,
  apiEndpoints,
  createApiClient,
  type ApiClient,
  type CallOptions,
  type EndpointAuth,
  type FetchLike,
  type HeaderMap,
} from '@sport-performance/contracts';
import type { Locale } from '@sport-performance/i18n';
import { appClientHeaders, isAppUpdateRequired, type AppBuildInfo } from '../version/index.ts';

/**
 * What an API failure means for the whole app, beyond the screen that made
 * the call (ADR 0058):
 * - `session_expired`: a call that carried the token got `401`: the session
 *   was closed (expired, signed out elsewhere, revoked from "Sesiones activas").
 * - `club_forbidden`: a club endpoint said `403`. It may be a permission of
 *   that resource (ADR 0032) or a membership that is no longer active (ADR
 *   0028): the session controller re-reads the memberships to tell them apart.
 * - `update_required`: `426`: this binary is no longer served (ADR 0045).
 */
export type ApiFailureEvent =
  | { readonly kind: 'session_expired' }
  | { readonly kind: 'club_forbidden'; readonly membershipId: string }
  | { readonly kind: 'update_required'; readonly error: ApiError };

export type ApiFailureListener = (event: ApiFailureEvent) => void;

export interface MobileApiCredentials {
  getToken(): Promise<string | null>;
  getMembershipId(): Promise<string | null>;
}

export interface MobileApiClientOptions {
  readonly baseUrl: string;
  readonly build: AppBuildInfo;
  readonly locale: Locale;
  readonly credentials: MobileApiCredentials;
  readonly fetch?: FetchLike;
}

export interface MobileApi {
  readonly client: ApiClient;
  /** Subscribes to {@link ApiFailureEvent}s; returns the unsubscribe. */
  onFailure(listener: ApiFailureListener): () => void;
}

interface RequestContext {
  readonly token: string | null;
  readonly membershipId: string | null;
}

/**
 * The typed contracts client as the app uses it: `Authorization: Bearer`
 * with the token of the secure storage, `X-Membership-Id` with the chosen
 * club, the version headers (ADR 0045) and `Accept-Language`. Errors still
 * reach the caller unchanged; the ones that concern the whole app are also
 * published to the {@link MobileApi.onFailure} listeners.
 */
export function createMobileApi(options: MobileApiClientOptions): MobileApi {
  const versionHeaders = appClientHeaders(options.build);
  const listeners = new Set<ApiFailureListener>();

  function emit(event: ApiFailureEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A failing listener must not hide the error from the caller.
      }
    }
  }

  const base = createApiClient({
    baseUrl: options.baseUrl,
    headers: { ...versionHeaders, 'accept-language': options.locale },
    ...(options.fetch !== undefined && { fetch: options.fetch }),
  }) as unknown as Record<string, (input?: unknown, callOptions?: CallOptions) => Promise<unknown>>;

  function contextHeaders(context: RequestContext): HeaderMap {
    return {
      ...(context.token !== null && { authorization: `Bearer ${context.token}` }),
      ...(context.membershipId !== null && { [MEMBERSHIP_HEADER]: context.membershipId }),
    };
  }

  function handle(error: unknown, auth: EndpointAuth, context: RequestContext): void {
    if (!(error instanceof ApiError)) return;
    if (isAppUpdateRequired(error)) {
      emit({ kind: 'update_required', error });
    } else if (error.code === 'unauthenticated' && auth !== 'public' && context.token !== null) {
      emit({ kind: 'session_expired' });
    } else if (error.code === 'forbidden' && auth === 'club' && context.membershipId !== null) {
      emit({ kind: 'club_forbidden', membershipId: context.membershipId });
    }
  }

  const client: Record<string, (input?: unknown, callOptions?: CallOptions) => Promise<unknown>> =
    {};
  for (const [operationId, endpoint] of Object.entries(apiEndpoints)) {
    const call = base[operationId];
    if (call === undefined) continue;
    client[operationId] = async (input, callOptions = {}) => {
      // Read once per call and shared by the headers and the error handler,
      // so both see the same token and membership.
      const context: RequestContext = {
        token: await options.credentials.getToken(),
        membershipId: await options.credentials.getMembershipId(),
      };
      try {
        return await call(input, {
          ...callOptions,
          headers: { ...contextHeaders(context), ...callOptions.headers },
        });
      } catch (error) {
        handle(error, endpoint.auth, context);
        throw error;
      }
    };
  }

  return {
    client: Object.freeze(client) as unknown as ApiClient,
    onFailure(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
