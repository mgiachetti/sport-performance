import type { z } from 'zod';
import type {
  EndpointCatalog,
  EndpointDefinition,
  EndpointInput,
  EndpointOutput,
} from '../endpoint.js';
import { apiEndpoints, type ApiEndpoints } from '../endpoints/index.js';
import {
  errorCodeForStatus,
  errorEnvelopeReadSchema,
  toValidationIssues,
} from '../primitives/errors.js';
import { ApiContractError, ApiError, ApiNetworkError } from './errors.js';

/**
 * The subset of the Fetch API the client uses, so it runs unchanged in the
 * browser, React Native and Node without DOM typings.
 */
export interface FetchResponseLike {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface FetchRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  credentials?: 'include' | 'omit' | 'same-origin';
  signal?: AbortSignal;
}

export type FetchLike = (url: string, init: FetchRequestInit) => Promise<FetchResponseLike>;

export type HeaderMap = Record<string, string>;

export interface ApiClientOptions {
  /** Origin (and optional prefix) of the API, e.g. `https://api.example.com`. */
  baseUrl: string;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Extra headers for every request (auth token, club, locale...). May be async. */
  headers?: HeaderMap | (() => HeaderMap | Promise<HeaderMap>);
  /** Web: `include` to send the session cookie cross-origin. */
  credentials?: FetchRequestInit['credentials'];
  /** Validate successful responses against the contract (default `true`). */
  validateResponses?: boolean;
}

export interface CallOptions {
  signal?: AbortSignal;
  headers?: HeaderMap;
}

type CallArgs<E extends EndpointDefinition> =
  object extends EndpointInput<E>
    ? [input?: EndpointInput<E>, options?: CallOptions]
    : [input: EndpointInput<E>, options?: CallOptions];

/** One async method per endpoint of the catalog, named by operationId. */
export type ApiClient<Catalog extends EndpointCatalog = ApiEndpoints> = {
  readonly [Id in keyof Catalog]: (
    ...args: CallArgs<Catalog[Id]>
  ) => Promise<EndpointOutput<Catalog[Id]>>;
};

interface RawInput {
  params?: unknown;
  query?: unknown;
  body?: unknown;
}

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Creates the typed API client. Inputs are validated before sending (an
 * invalid input throws `ApiContractError` and never hits the network);
 * responses are validated against the contract unless disabled.
 *
 * Errors: `ApiError` (the API answered an error), `ApiNetworkError` (no
 * response), `ApiContractError` (invalid input or off-contract response).
 */
export function createApiClient<Catalog extends EndpointCatalog = ApiEndpoints>(
  options: ApiClientOptions,
  catalog: Catalog = apiEndpoints as unknown as Catalog,
): ApiClient<Catalog> {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const validateResponses = options.validateResponses ?? true;

  async function call(
    operationId: string,
    endpoint: EndpointDefinition,
    input: RawInput = {},
    callOptions: CallOptions = {},
  ): Promise<unknown> {
    const fetchImpl: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    const params = parsePart(operationId, 'params', endpoint.params, input.params);
    const query = parsePart(operationId, 'query', endpoint.query, input.query);
    const body = parsePart(operationId, 'body', endpoint.body, input.body);

    const url = baseUrl + buildPath(endpoint.path, params) + buildQuery(operationId, query);
    const defaults =
      typeof options.headers === 'function' ? await options.headers() : (options.headers ?? {});
    const headers: HeaderMap = { accept: 'application/json', ...defaults, ...callOptions.headers };
    const init: FetchRequestInit = { method: endpoint.method, headers };
    if (endpoint.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    if (options.credentials !== undefined) init.credentials = options.credentials;
    if (callOptions.signal !== undefined) init.signal = callOptions.signal;

    let response: FetchResponseLike;
    let text: string;
    try {
      response = await fetchImpl(url, init);
      text = await response.text();
    } catch (cause) {
      throw new ApiNetworkError(operationId, cause);
    }

    if (!response.ok) throw toApiError(operationId, response, text);

    if (endpoint.response.schema === undefined) return undefined;
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new ApiContractError({
        operationId,
        side: 'response',
        status: response.status,
        message: `${operationId}: response is not JSON`,
      });
    }
    if (!validateResponses) return json;
    const parsed = endpoint.response.schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiContractError({
        operationId,
        side: 'response',
        status: response.status,
        message: `${operationId}: response does not match the contract`,
        issues: toValidationIssues(parsed.error.issues),
      });
    }
    return parsed.data;
  }

  const client: Record<string, (input?: RawInput, callOptions?: CallOptions) => Promise<unknown>> =
    {};
  for (const [operationId, endpoint] of Object.entries(catalog)) {
    client[operationId] = (input, callOptions) => call(operationId, endpoint, input, callOptions);
  }
  return Object.freeze(client) as ApiClient<Catalog>;
}

function parsePart(
  operationId: string,
  part: 'params' | 'query' | 'body',
  schema: z.ZodType | undefined,
  value: unknown,
): unknown {
  if (schema === undefined) return undefined;
  const parsed = schema.safeParse(part === 'query' ? (value ?? {}) : value);
  if (!parsed.success) {
    throw new ApiContractError({
      operationId,
      side: 'request',
      message: `${operationId}: invalid ${part}`,
      issues: toValidationIssues(parsed.error.issues, [part]),
    });
  }
  return parsed.data;
}

function buildPath(path: string, params: unknown): string {
  const values = (params ?? {}) as Record<string, unknown>;
  return path.replace(/\{([^{}]+)\}/g, (_, name: string) =>
    encodeURIComponent(scalarToString(values[name])),
  );
}

function buildQuery(operationId: string, query: unknown): string {
  if (query === undefined) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    const list: unknown[] = Array.isArray(value) ? value : [value];
    for (const item of list) {
      if (!isScalar(item)) {
        throw new ApiContractError({
          operationId,
          side: 'request',
          message: `${operationId}: query param "${key}" must be a scalar or a list of scalars`,
        });
      }
      search.append(key, scalarToString(item));
    }
  }
  const encoded = search.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function scalarToString(value: unknown): string {
  return isScalar(value) ? String(value) : '';
}

/** `Retry-After` in seconds (`429`, `503`); the HTTP-date form is converted from now. */
export function parseRetryAfter(
  value: string | null,
  now: () => number = Date.now,
): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^[0-9]+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now()) / 1000));
}

function toApiError(operationId: string, response: FetchResponseLike, text: string): ApiError {
  const headerRequestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined;
  const retryAfterS = parseRetryAfter(response.headers.get('retry-after'));
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = undefined;
  }
  const envelope = errorEnvelopeReadSchema.safeParse(json);
  if (envelope.success) {
    const { code, message, details, requestId } = envelope.data.error;
    return new ApiError({
      operationId,
      status: response.status,
      code,
      message,
      details,
      requestId: requestId ?? headerRequestId,
      retryAfterS,
    });
  }
  return new ApiError({
    operationId,
    status: response.status,
    code: errorCodeForStatus(response.status),
    message: `${operationId}: HTTP ${String(response.status)} without an error envelope`,
    requestId: headerRequestId,
    retryAfterS,
  });
}
