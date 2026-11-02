import { Button, Heading, Link, Text } from '@react-email/components';
import { colors, EmailLayout } from './layout.js';

export interface InvitationEmailProps {
  preview: string;
  heading: string;
  body: string;
  cta: string;
  /** Universal link: opens the app when installed, the web otherwise. */
  url: string;
  expires: string;
  fallback: string;
  ignore: string;
  footer: string;
}

/** Invitation to join a club with a role (ADR 0007). */
export function InvitationEmail(props: InvitationEmailProps) {
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
          color: '#FFFFFF',
          display: 'inline-block',
          fontSize: '15px',
          fontWeight: 600,
          padding: '12px 20px',
          textDecoration: 'none',
        }}
      >
        {props.cta}
      </Button>
      <Text style={{ fontSize: '13px', lineHeight: '20px', margin: '20px 0 8px' }}>
        {props.expires}
      </Text>
      <Text
        style={{ color: colors.muted, fontSize: '13px', lineHeight: '20px', margin: '0 0 4px' }}
      >
        {props.fallback}
      </Text>
      <Link
        href={props.url}
        style={{ color: colors.text, fontSize: '13px', wordBreak: 'break-all' }}
      >
        {props.url}
      </Link>
      <Text
        style={{ color: colors.muted, fontSize: '13px', lineHeight: '20px', margin: '16px 0 0' }}
      >
        {props.ignore}
      </Text>
    </EmailLayout>
  );
}
