import { Resend } from 'resend';
import { EmailDeliveryError, type EmailMessage, type EmailTransport } from './transport.js';

export interface ResendTransportOptions {
  apiKey: string;
  /** `Name <address@domain>` of a domain verified in Resend (SPF, DKIM). */
  from: string;
  /** Injected in tests; defaults to the Resend SDK client. */
  client?: Pick<Resend, 'emails'>;
}

/**
 * Sends through Resend (ADR 0010). The message is rendered before reaching
 * here (React Email), so the SDK only gets `html` and `text`. Errors keep the
 * provider's error name and status, never the recipient.
 */
export class ResendEmailTransport implements EmailTransport {
  readonly name = 'resend';
  readonly #client: Pick<Resend, 'emails'>;
  readonly #from: string;

  constructor(options: ResendTransportOptions) {
    this.#client = options.client ?? new Resend(options.apiKey);
    this.#from = options.from;
  }

  async send(message: EmailMessage): Promise<void> {
    let result: Awaited<ReturnType<Resend['emails']['send']>>;
    try {
      result = await this.#client.emails.send({
        from: this.#from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: [{ name: 'kind', value: message.kind }],
      });
    } catch (error) {
      throw new EmailDeliveryError('Resend request failed', { cause: error });
    }
    if (result.error !== null) {
      const status = result.error.statusCode === null ? '' : ` ${String(result.error.statusCode)}`;
      throw new EmailDeliveryError(`Resend rejected the email: ${result.error.name}${status}`);
    }
  }
}
