import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Expo Push (ADR 0013, ADR 0054) over plain HTTPS: `send` returns one ticket
 * per message, in order; `receipts` reads what APNs/FCM answered, later.
 * Messages carry the title, the body and ids for the app to route the tap;
 * never health data. Errors keep Expo's error code, never the token.
 */

export const EXPO_PUSH_BASE_URL = 'https://exp.host/--/api/v2/push';
/** Expo accepts up to 100 messages per request and 1000 receipt ids. */
export const EXPO_SEND_CHUNK = 100;
export const EXPO_RECEIPTS_CHUNK = 1000;

export interface PushMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  /** Ids and a path in the app: nothing personal. */
  readonly data: Readonly<Record<string, string>>;
  readonly priority: 'default' | 'high';
}

/**
 * What happened to one message: `ok` and `error` are Expo's tickets; `unsent`
 * means the request that carried it failed (network, 5xx, a body we do not
 * understand), so Expo never took it and it may be sent again.
 */
export type PushTicket =
  | { readonly status: 'ok'; readonly id: string }
  | { readonly status: 'error'; readonly code: string }
  | { readonly status: 'unsent'; readonly code: string };

export type PushReceipt =
  { readonly status: 'ok' } | { readonly status: 'error'; readonly code: string };

/** Where push notifications go: Expo in deployments, a fake in tests. */
export interface PushService {
  /**
   * One ticket per message, in order. A request that fails after earlier ones
   * went through marks its messages (and the rest) `unsent` instead of
   * throwing, so the tickets of what was sent are never lost.
   */
  send(messages: readonly PushMessage[]): Promise<PushTicket[]>;
  /** Receipts that are ready, by ticket id; ids without one yet are absent. */
  receipts(ticketIds: readonly string[]): Promise<Map<string, PushReceipt>>;
}

/** Expo did not answer as documented (network, 5xx, a body we do not understand). */
export class PushDeliveryError extends Error {
  override readonly name = 'PushDeliveryError';
  constructor(
    message: string,
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const errorDetails = z.object({ error: z.string().optional() }).loose().optional();
const ticketSchema = z.union([
  z.object({ status: z.literal('ok'), id: z.string().min(1) }).loose(),
  z
    .object({ status: z.literal('error'), message: z.string().optional(), details: errorDetails })
    .loose(),
]);
const sendResponseSchema = z.object({ data: z.array(ticketSchema) }).loose();
const receiptSchema = z.union([
  z.object({ status: z.literal('ok') }).loose(),
  z
    .object({ status: z.literal('error'), message: z.string().optional(), details: errorDetails })
    .loose(),
]);
const receiptsResponseSchema = z.object({ data: z.record(z.string(), receiptSchema) }).loose();

/** A short code safe to store (`DeviceNotRegistered`, `MessageTooBig`…). */
function codeOf(details: z.infer<typeof errorDetails>): string {
  const code = details?.error ?? 'UnknownError';
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(code) ? code : 'UnknownError';
}

export interface ExpoPushServiceOptions {
  /** Expo access token ("enhanced security for push notifications"); optional. Never logged. */
  readonly accessToken?: string | undefined;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Injected in tests. */
  readonly fetch?: typeof fetch;
}

export class ExpoPushService implements PushService {
  readonly #accessToken: string | undefined;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: ExpoPushServiceOptions = {}) {
    this.#accessToken = options.accessToken;
    this.#baseUrl = (options.baseUrl ?? EXPO_PUSH_BASE_URL).replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#fetch = options.fetch ?? fetch;
  }

  async #post(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(this.#accessToken !== undefined && { authorization: `Bearer ${this.#accessToken}` }),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new PushDeliveryError('Expo push request failed', 'NetworkError', { cause: error });
    }
    if (!response.ok) {
      throw new PushDeliveryError(
        `Expo push answered ${String(response.status)}`,
        `HTTP_${String(response.status)}`,
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw new PushDeliveryError('Expo push answered no JSON', 'InvalidResponse', {
        cause: error,
      });
    }
  }

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    const unsent = (from: number, code: string): PushTicket[] => {
      for (let j = from; j < messages.length; j += 1) tickets.push({ status: 'unsent', code });
      return tickets;
    };
    for (let i = 0; i < messages.length; i += EXPO_SEND_CHUNK) {
      const chunk = messages.slice(i, i + EXPO_SEND_CHUNK);
      let answer: unknown;
      try {
        answer = await this.#post(
          'send',
          chunk.map((m) => ({
            to: m.to,
            title: m.title,
            body: m.body,
            data: m.data,
            priority: m.priority,
            sound: 'default',
          })),
        );
      } catch (error) {
        // This chunk and the following ones were not sent: Expo is not answering.
        return unsent(i, error instanceof PushDeliveryError ? error.code : 'UnknownError');
      }
      const parsed = sendResponseSchema.safeParse(answer);
      if (!parsed.success || parsed.data.data.length !== chunk.length) {
        // Without tickets what Expo took cannot be told apart: unsent, a retry may repeat it.
        return unsent(i, 'InvalidResponse');
      }
      for (const ticket of parsed.data.data) {
        tickets.push(
          ticket.status === 'ok'
            ? { status: 'ok', id: ticket.id }
            : { status: 'error', code: codeOf(ticket.details) },
        );
      }
    }
    return tickets;
  }

  async receipts(ticketIds: readonly string[]): Promise<Map<string, PushReceipt>> {
    const result = new Map<string, PushReceipt>();
    for (let i = 0; i < ticketIds.length; i += EXPO_RECEIPTS_CHUNK) {
      const ids = ticketIds.slice(i, i + EXPO_RECEIPTS_CHUNK);
      const parsed = receiptsResponseSchema.safeParse(await this.#post('getReceipts', { ids }));
      if (!parsed.success) {
        throw new PushDeliveryError('Expo receipts answered an unexpected body', 'InvalidResponse');
      }
      for (const [id, receipt] of Object.entries(parsed.data.data)) {
        result.set(
          id,
          receipt.status === 'ok'
            ? { status: 'ok' }
            : { status: 'error', code: codeOf(receipt.details) },
        );
      }
    }
    return result;
  }
}

/** Expo's code for a token that no longer reaches a device: the token is forgotten. */
export const DEVICE_NOT_REGISTERED = 'DeviceNotRegistered';

/** Records what would have been sent: tests, and development without Expo. */
export class MemoryPushService implements PushService {
  readonly sent: PushMessage[] = [];
  /** Tokens that answer `DeviceNotRegistered` on send. */
  readonly unregistered = new Set<string>();
  /** Receipts to answer, by ticket id. */
  readonly pendingReceipts = new Map<string, PushReceipt>();
  /** Makes the next sends fail as a network error. */
  failing = false;

  send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    if (this.failing)
      return Promise.reject(new PushDeliveryError('memory: failing', 'NetworkError'));
    return Promise.resolve(
      messages.map((message): PushTicket => {
        if (this.unregistered.has(message.to))
          return { status: 'error', code: DEVICE_NOT_REGISTERED };
        this.sent.push(message);
        return { status: 'ok', id: randomUUID() };
      }),
    );
  }

  receipts(ticketIds: readonly string[]): Promise<Map<string, PushReceipt>> {
    const result = new Map<string, PushReceipt>();
    for (const id of ticketIds) {
      const receipt = this.pendingReceipts.get(id);
      if (receipt !== undefined) result.set(id, receipt);
    }
    return Promise.resolve(result);
  }
}
