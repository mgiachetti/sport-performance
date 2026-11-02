import { Heading, Text } from '@react-email/components';
import { colors, EmailLayout } from './layout.js';

export interface NewSignInEmailProps {
  preview: string;
  heading: string;
  /** Device and time of the sign-in, already formatted. */
  body: string;
  ifYou: string;
  ifNotYou: string;
  footer: string;
}

/**
 * Sign-in from a device the account had not used (B-333, ADR 0033). No link:
 * the person opens the app or the web themselves to review their sessions,
 * so the email cannot be imitated into a phishing link.
 */
export function NewSignInEmail(props: NewSignInEmailProps) {
  return (
    <EmailLayout preview={props.preview} footer={props.footer}>
      <Heading as="h1" style={{ fontSize: '22px', lineHeight: '28px', margin: '0 0 16px' }}>
        {props.heading}
      </Heading>
      <Text style={{ fontSize: '15px', lineHeight: '22px', margin: '0 0 12px' }}>{props.body}</Text>
      <Text style={{ fontSize: '15px', lineHeight: '22px', margin: '0 0 12px' }}>
        {props.ifYou}
      </Text>
      <Text style={{ color: colors.muted, fontSize: '13px', lineHeight: '20px', margin: 0 }}>
        {props.ifNotYou}
      </Text>
    </EmailLayout>
  );
}
