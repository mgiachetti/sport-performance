import type { FetchLike, FetchRequestInit, FetchResponseLike } from '@sport-performance/contracts';

/** A recorded request of the fake API. */
export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface FakeResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

type Handler = (request: RecordedRequest) => FakeResponse | 'network-error';

/**
 * A fetch that answers from a route table (`'POST /v1/auth/email-otp'`),
 * records every request and fails with a network error for unknown routes
 * or when `offline` is set. Used to test the app against the real typed
 * client and contracts, without a server.
 */
export function createFakeApi(baseUrl = 'https://api.test') {
  const routes = new Map<string, Handler>();
  const requests: RecordedRequest[] = [];
  let offline = false;

  const fetch: FetchLike = (url: string, init: FetchRequestInit): Promise<FetchResponseLike> => {
    const [path = '', search = ''] = url.slice(baseUrl.length).split('?', 2);
    const request: RecordedRequest = {
      method: init.method,
      path,
      query: new URLSearchParams(search),
      headers: init.headers,
      body: init.body === undefined ? undefined : (JSON.parse(init.body) as unknown),
    };
    requests.push(request);
    const handler = routes.get(`${init.method} ${path}`);
    if (offline || handler === undefined)
      return Promise.reject(new TypeError('Network request failed'));
    const response = handler(request);
    if (response === 'network-error')
      return Promise.reject(new TypeError('Network request failed'));
    const headers = new Map(
      Object.entries({ 'content-type': 'application/json', ...response.headers }).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    return Promise.resolve({
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      text: () => Promise.resolve(response.body === undefined ? '' : JSON.stringify(response.body)),
    });
  };

  return {
    baseUrl,
    fetch,
    requests,
    on(route: string, handler: Handler | FakeResponse): void {
      routes.set(route, typeof handler === 'function' ? handler : () => handler);
    },
    setOffline(value: boolean): void {
      offline = value;
    },
    last(route: string): RecordedRequest | undefined {
      return requests.filter((r) => `${r.method} ${r.path}` === route).at(-1);
    },
  };
}

export type FakeApi = ReturnType<typeof createFakeApi>;

/** The error envelope of the API (ADR 0020). */
export function apiError(
  status: number,
  code: string,
  headers: Record<string, string> = {},
): FakeResponse {
  return {
    status,
    headers,
    body: { error: { code, message: code, requestId: 'req-1', details: [] } },
  };
}
