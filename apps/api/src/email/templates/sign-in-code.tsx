import { Heading, Text } from '@react-email/components';
import { colors, EmailLayout } from './layout.js';

export interface SignInCodeEmailProps {
  preview: string;
  heading: string;
  body: string;
  code: string;
  ignore: string;
  footer: string;
}

/** The one-time sign-in code (ADR 0010). The code is large and tabular, easy to copy. */
export function SignInCodeEmail(props: SignInCodeEmailProps) {
  return (
    <EmailLayout preview={props.preview} footer={props.footer}>
      <Heading as="h1" style={{ fontSize: '22px', lineHeight: '28px', margin: '0 0 16px' }}>
        {props.heading}
      </Heading>
      <Text
        style={{
          backgroundColor: colors.background,
          borderRadius: '6px',
          fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
          fontSize: '32px',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 700,
          letterSpacing: '8px',
          margin: '0 0 16px',
          padding: '16px 0',
          textAlign: 'center',
        }}
      >
        {props.code}
      </Text>
      <Text style={{ fontSize: '15px', lineHeight: '22px', margin: '0 0 12px' }}>{props.body}</Text>
      <Text style={{ color: colors.muted, fontSize: '13px', lineHeight: '20px', margin: 0 }}>
        {props.ignore}
      </Text>
    </EmailLayout>
  );
}
