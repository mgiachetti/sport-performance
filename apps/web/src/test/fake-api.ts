import {
  API_VERSION_HEADER,
  CONTRACT_VERSION,
  apiEndpoints,
  type ApiEndpoints,
  type EndpointOutput,
  type FetchLike,
  type FetchRequestInit,
  type FetchResponseLike,
} from '@sport-performance/contracts';

/**
 * A fake API behind the real typed client (ADR 0057, tests): requests are
 * matched to an `operationId` of the contract catalog, answered by the test's
 * handlers and recorded. Responses still go through the client's contract
 * validation, so fixtures must be valid API payloads.
 */
export type OperationId = keyof ApiEndpoints;

export interface FakeRequest {
  readonly operationId: OperationId;
  readonly method: string;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly credentials: FetchRequestInit['credentials'];
}

export interface FakeReply {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

/** A handler answers a reply, or throws to simulate a network failure. */
export type FakeHandler<K extends OperationId = OperationId> = (
  request: FakeRequest,
) =>
  | FakeReply
  | EndpointOutput<ApiEndpoints[K]>
  | Promise<FakeReply | EndpointOutput<ApiEndpoints[K]>>;

export type FakeHandlers = { [K in OperationId]?: FakeHandler<K> };

const REPLY = Symbol('reply');

/** A reply with an explicit status or headers (plain values answer `200`/`201`/`204`). */
export function reply(
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): FakeReply {
  return Object.assign({ status, body, headers }, { [REPLY]: true });
}

/** An error envelope (ADR 0020). */
export function apiError(
  status: number,
  code: string,
  options: { retryAfterS?: number; requestId?: string } = {},
): FakeReply {
  return reply(
    status,
    {
      error: {
        code,
        message: `fake ${code}`,
        ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      },
    },
    options.retryAfterS === undefined ? {} : { 'retry-after': String(options.retryAfterS) },
  );
}

/** Throw it from a handler: the request gets no response. */
export class FakeNetworkError extends TypeError {
  constructor() {
    super('Failed to fetch');
  }
}

function isReply(value: unknown): value is FakeReply {
  return typeof value === 'object' && value !== null && REPLY in value;
}

interface Route {
  readonly operationId: OperationId;
  readonly method: string;
  readonly pattern: RegExp;
  readonly paramNames: readonly string[];
  readonly successStatus: number;
}

const ROUTES: readonly Route[] = (
  Object.entries(apiEndpoints) as [OperationId, ApiEndpoints[OperationId]][]
).map(([operationId, endpoint]) => {
  const paramNames: string[] = [];
  const source = endpoint.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  return {
    operationId,
    method: endpoint.method,
    pattern: new RegExp(`^${source}$`),
    paramNames,
    successStatus: endpoint.response.status,
  };
});

function respond(
  status: number,
  body: unknown,
  headers: Record<string, string>,
): FetchResponseLike {
  const all: Record<string, string> = { [API_VERSION_HEADER]: CONTRACT_VERSION, ...headers };
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), v]));
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(text),
  };
}

export interface FakeApi {
  readonly fetch: FetchLike;
  readonly handlers: FakeHandlers;
  readonly calls: FakeRequest[];
  /** Requests no handler answered (each also failed with `500`). */
  readonly unhandled: string[];
  /** Calls of one operation. */
  callsTo(operationId: OperationId): FakeRequest[];
  /** Replaces or adds handlers mid-test. */
  use(handlers: FakeHandlers): void;
  /** `X-Api-Version` of every reply from now on. */
  setContractVersion(version: string): void;
}

export function createFakeApi(baseUrl: string, initial: FakeHandlers = {}): FakeApi {
  const handlers: FakeHandlers = { ...initial };
  const calls: FakeRequest[] = [];
  const unhandled: string[] = [];
  let contractVersion = CONTRACT_VERSION;

  const fetch: FetchLike = async (rawUrl, init) => {
    const url = new URL(rawUrl);
    const path = url.pathname.slice(new URL(baseUrl).pathname.replace(/\/$/, '').length);
    const route = ROUTES.find(
      (candidate) => candidate.method === init.method && candidate.pattern.test(path),
    );
    if (route === undefined) {
      unhandled.push(`${init.method} ${path}`);
      return respond(404, { error: { code: 'not_found', message: 'no such route' } }, {});
    }
    const match = route.pattern.exec(path) ?? [];
    const params = Object.fromEntries(
      route.paramNames.map((name, index) => [name, decodeURIComponent(match[index + 1] ?? '')]),
    );
    const request: FakeRequest = {
      operationId: route.operationId,
      method: init.method,
      url,
      params,
      headers: Object.fromEntries(
        Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]),
      ),
      body: init.body === undefined ? undefined : (JSON.parse(init.body) as unknown),
      credentials: init.credentials,
    };
    calls.push(request);
    const handler = handlers[route.operationId] as FakeHandler | undefined;
    if (handler === undefined) {
      unhandled.push(`${init.method} ${path} (${route.operationId})`);
      return respond(500, { error: { code: 'internal_error', message: 'unhandled' } }, {});
    }
    const result = await handler(request);
    const versionHeader = { [API_VERSION_HEADER]: contractVersion };
    if (isReply(result)) {
      return respond(result.status, result.body, { ...versionHeader, ...result.headers });
    }
    return respond(
      route.successStatus,
      route.successStatus === 204 ? undefined : result,
      versionHeader,
    );
  };

  return {
    fetch,
    handlers,
    calls,
    unhandled,
    callsTo: (operationId) => calls.filter((call) => call.operationId === operationId),
    use: (next) => {
      Object.assign(handlers, next);
    },
    setContractVersion: (version) => {
      contractVersion = version;
    },
  };
}
