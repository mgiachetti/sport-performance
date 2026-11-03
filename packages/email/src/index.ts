/**
 * @sport-performance/email: what the API and the worker share to send email
 * (ADR 0010, ADR 0054): the transport interface with Resend, memory and log
 * implementations, the React Email layout and the templates both use. Texts
 * come already translated (`packages/i18n`).
 */
import { render } from '@react-email/render';
import type { ReactElement } from 'react';

export {
  EMAIL_KINDS,
  EmailDeliveryError,
  LogEmailTransport,
  MemoryEmailTransport,
  type EmailKind,
  type EmailLogger,
  type EmailMessage,
  type EmailTransport,
} from './transport.js';
export {
  RESEND_TIMEOUT_MS_DEFAULT,
  ResendEmailTransport,
  type ResendTransportOptions,
} from './resend.js';
export { EmailLayout, colors, type EmailLayoutProps } from './layout.js';
export { NotificationEmail, type NotificationEmailProps } from './notification.js';

/** HTML and plain-text versions of an email element. */
export async function renderEmail(element: ReactElement): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}
