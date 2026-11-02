import { render } from '@react-email/render';
import type { MembershipRole, TimeZone } from '@sport-performance/domain';
import { createTranslator, formatDateTime, type Translator } from '@sport-performance/i18n';
import type { ReactElement } from 'react';
import { InvitationEmail } from './templates/invitation.js';
import { SignInCodeEmail } from './templates/sign-in-code.js';
import type { EmailMessage, EmailTransport } from './transport.js';

export interface SignInCodeEmailInput {
  to: string;
  code: string;
  expiresInS: number;
}

export interface InvitationEmailInput {
  to: string;
  clubName: string;
  role: MembershipRole;
  /** Name of the admin who invites; empty when the account has no name yet. */
  inviterName: string;
  /** Universal link of the invitation. */
  url: string;
  expiresAt: Date;
  /** "The day" of the expiry is shown in the club time zone. */
  timeZone: TimeZone;
}

/** Renders the emails of the identity flows (React Email, es-AR from `packages/i18n`) and sends them. */
export interface Mailer {
  sendSignInCode(input: SignInCodeEmailInput): Promise<void>;
  sendInvitation(input: InvitationEmailInput): Promise<void>;
}

async function renderBoth(element: ReactElement): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}

export function createMailer(
  transport: EmailTransport,
  translator: Translator = createTranslator(),
): Mailer {
  const { t } = translator;
  const appName = t('email.appName');
  const footer = t('email.footer', { appName });

  const send = async (
    to: string,
    kind: EmailMessage['kind'],
    subject: string,
    element: ReactElement,
  ) => {
    const { html, text } = await renderBoth(element);
    await transport.send({ to, kind, subject, html, text });
  };

  return {
    async sendSignInCode({ to, code, expiresInS }) {
      const minutes = Math.max(1, Math.round(expiresInS / 60));
      await send(
        to,
        'sign_in_code',
        t('email.signInCode.subject', { code }),
        <SignInCodeEmail
          preview={t('email.signInCode.preview', { appName })}
          heading={t('email.signInCode.heading')}
          body={t('email.signInCode.body', { minutes })}
          code={code}
          ignore={t('email.signInCode.ignore')}
          footer={footer}
        />,
      );
    },

    async sendInvitation(input) {
      const role = t(`role.${input.role}`);
      const { clubName } = input;
      const inviterName = input.inviterName.trim();
      await send(
        input.to,
        'invitation',
        t('email.invitation.subject', { clubName }),
        <InvitationEmail
          preview={t('email.invitation.preview', { clubName, appName })}
          heading={t('email.invitation.heading', { clubName })}
          body={
            inviterName === ''
              ? t('email.invitation.bodyNoInviter', { clubName, role })
              : t('email.invitation.body', { inviterName, clubName, role })
          }
          cta={t('email.invitation.cta')}
          url={input.url}
          expires={t('email.invitation.expires', {
            date: formatDateTime(input.expiresAt, { timeZone: input.timeZone }),
          })}
          fallback={t('email.invitation.fallback')}
          ignore={t('email.invitation.ignore')}
          footer={footer}
        />,
      );
    },
  };
}
