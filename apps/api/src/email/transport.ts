import type { FastifyBaseLogger } from 'fastify';

/** A rendered email, ready for any transport. */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  /** Plain-text alternative: clients that block HTML, screen readers, spam filters. */
  readonly text: string;
  /** What the message is, for the provider's analytics and our logs (never personal data). */
  readonly kind: 'sign_in_code' | 'invitation';
}

/**
 * Delivers emails. The API only talks to this interface: Resend in
 * deployments, {@link MemoryEmailTransport} in tests and
 * {@link LogEmailTransport} on a laptop without `RESEND_API_KEY`.
 */
export interface EmailTransport {
  /** Human-readable name for the startup log (`resend`, `log`, `memory`). */
  readonly name: string;
  /** Resolves when the provider accepted the message; rejects with {@link EmailDeliveryError}. */
  send(message: EmailMessage): Promise<void>;
}

/** The provider did not accept the message. The cause never carries the recipient. */
export class EmailDeliveryError extends Error {
  override readonly name = 'EmailDeliveryError';
}

/** Keeps every message in memory: tests read the code or the link that was "sent". */
export class MemoryEmailTransport implements EmailTransport {
  readonly name = 'memory';
  readonly sent: EmailMessage[] = [];
  /** Makes the next sends fail, to test delivery errors. */
  failing = false;

  send(message: EmailMessage): Promise<void> {
    if (this.failing) return Promise.reject(new EmailDeliveryError('memory transport: failing'));
    this.sent.push(message);
    return Promise.resolve();
  }

  /** Last message sent to `to` (case-insensitive), if any. */
  lastTo(to: string): EmailMessage | undefined {
    const wanted = to.toLowerCase();
    return this.sent.findLast((message) => message.to.toLowerCase() === wanted);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/**
 * Development transport: writes the plain-text version to the log instead of
 * sending it, so a sign-in code can be read from the terminal. The
 * configuration refuses it in production (`RESEND_API_KEY` is required there):
 * the log would then carry emails and codes.
 */
export class LogEmailTransport implements EmailTransport {
  readonly name = 'log';

  constructor(private readonly logger: FastifyBaseLogger) {}

  send(message: EmailMessage): Promise<void> {
    this.logger.warn(
      { devEmail: { kind: message.kind, recipient: message.to, subject: message.subject } },
      `email not sent (no RESEND_API_KEY); plain text follows\n${message.text}`,
    );
    return Promise.resolve();
  }
}
