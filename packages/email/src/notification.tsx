import { Button, Heading, Link, Text } from '@react-email/components';
import { colors, EmailLayout } from './layout.js';

export interface NotificationEmailProps {
  preview: string;
  heading: string;
  body: string;
  cta: string;
  /** Page of the web app the notification is about (the panel, the session). */
  url: string;
  /** Where to change what arrives by email. */
  preferences: string;
  footer: string;
}

/**
 * A notification by email (B-328, ADR 0054): the same short text as the push,
 * and a link to the web, where the details are behind the sign-in. Never
 * health data, metric values or a player's name next to an alert.
 */
export function NotificationEmail(props: NotificationEmailProps) {
  return (
    <EmailLayout preview={props.preview} footer={props.footer}>
      <Heading as="h1" style={{ fontSize: '22px', lineHeight: '28px', margin: '0 0 16px' }}>
        {props.heading}
      </Heading>
      <Text style={{ fontSize: '15px', lineHeight: '22px', margin: '0 0 20px' }}>{props.body}</Text>
      <Button
        href={props.url}
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
        {props.cta}
      </Button>
      <Text
        style={{ color: colors.muted, fontSize: '13px', lineHeight: '20px', margin: '20px 0 0' }}
      >
        <Link href={props.url} style={{ color: colors.muted }}>
          {props.url}
        </Link>
      </Text>
      <Text
        style={{ color: colors.muted, fontSize: '13px', lineHeight: '20px', margin: '12px 0 0' }}
      >
        {props.preferences}
      </Text>
    </EmailLayout>
  );
}
