import { Button, Heading, Link, Text } from '@react-email/components';
import { colors, EmailLayout } from './layout.js';

export interface NotificationEmailProps {
  preview: string;
  heading: string;
  body: string;
  /**
   * Where to act: a page of the web (the panel, the session) with its button
   * text, or a line that sends to the app for what is answered there only
   * (the player's RPE: the web is for the staff).
   */
  action:
    | { readonly kind: 'web'; readonly url: string; readonly cta: string }
    | { readonly kind: 'app'; readonly text: string };
  /** Where to change what arrives by email. */
  preferences: string;
  footer: string;
}

/**
 * A notification by email (B-328, ADR 0054): the same short text as the push,
 * and a link to the web (or a line to the app), where the details are behind
 * the sign-in. Never health data, metric values or a player's name next to an
 * alert.
 */
export function NotificationEmail(props: NotificationEmailProps) {
  const { action } = props;
  return (
    <EmailLayout preview={props.preview} footer={props.footer}>
      <Heading as="h1" style={{ fontSize: '22px', lineHeight: '28px', margin: '0 0 16px' }}>
        {props.heading}
      </Heading>
      <Text style={{ fontSize: '15px', lineHeight: '22px', margin: '0 0 20px' }}>{props.body}</Text>
      {action.kind === 'web' ? (
        <>
          <Button
            href={action.url}
            style={{
              backgroundColor: colors.text,
              borderRadius: '6px',
              color: colors.panel,
              display: 'inline-block',
              fontSize: '15px',
              fontWeight: 600,
              padding: '12px 20px',
              textDecoration: 'none',
            }}
          >
            {action.cta}
          </Button>
          <Text
            style={{
              color: colors.muted,
              fontSize: '13px',
              lineHeight: '20px',
              margin: '20px 0 0',
            }}
          >
            <Link href={action.url} style={{ color: colors.muted }}>
              {action.url}
            </Link>
          </Text>
        </>
      ) : (
        <Text style={{ fontSize: '15px', lineHeight: '22px', fontWeight: 600, margin: '0' }}>
          {action.text}
        </Text>
      )}
      <Text
        style={{ color: colors.muted, fontSize: '13px', lineHeight: '20px', margin: '12px 0 0' }}
      >
        {props.preferences}
      </Text>
    </EmailLayout>
  );
}
