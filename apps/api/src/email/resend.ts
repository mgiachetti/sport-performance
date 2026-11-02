import { Resend } from 'resend';
import { EmailDeliveryError, type EmailMessage, type EmailTransport } from './transport.js';

export interface ResendTransportOptions {
  apiKey: string;
  /** `Name <address@domain>` of a domain verified in Resend (SPF, DKIM). */
  from: string;
  /** Injected in tests; defaults to the Resend SDK client. */
  client?: Pick<Resend, 'emails'>;
  /**
   * Past this the send counts as failed (`503` to the caller) instead of
   * holding the request until the socket times out (ADR 0031). Default 10 s.
   */
  timeoutMs?: number;
}

export const RESEND_TIMEOUT_MS_DEFAULT = 10_000;

/**
 * Sends through Resend (ADR 0010). The message is rendered before reaching
 * here (React Email), so the SDK only gets `html` and `text`. Errors keep the
 * provider's error name and status, never the recipient.
 */
export class ResendEmailTransport implements EmailTransport {
  readonly name = 'resend';
  readonly #client: Pick<Resend, 'emails'>;
  readonly #from: string;
  readonly #timeoutMs: number;

  constructor(options: ResendTransportOptions) {
    this.#client = options.client ?? new Resend(options.apiKey);
    this.#from = options.from;
    this.#timeoutMs = options.timeoutMs ?? RESEND_TIMEOUT_MS_DEFAULT;
  }

  async send(message: EmailMessage): Promise<void> {
    let result: Awaited<ReturnType<Resend['emails']['send']>>;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`no answer in ${String(this.#timeoutMs)} ms`));
      }, this.#timeoutMs);
    });
    try {
      result = await Promise.race([
        this.#client.emails.send({
          from: this.#from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          tags: [{ name: 'kind', value: message.kind }],
        }),
        timeout,
      ]);
    } catch (error) {
      throw new EmailDeliveryError('Resend request failed', { cause: error });
    } finally {
      clearTimeout(timer);
    }
    if (result.error !== null) {
      const status = result.error.statusCode === null ? '' : ` ${String(result.error.statusCode)}`;
      throw new EmailDeliveryError(`Resend rejected the email: ${result.error.name}${status}`);
    }
  }
}
