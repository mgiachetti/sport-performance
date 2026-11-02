import { Body, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

/**
 * Shell of every email: neutral product styles (emails are not per club yet;
 * the club name goes in the text). High contrast, system fonts, a single
 * column that reads well on a phone. Texts come already translated.
 */
export interface EmailLayoutProps {
  preview: string;
  footer: string;
  children: ReactNode;
}

export const colors = {
  text: '#141210',
  muted: '#5C544B',
  line: '#E4DED6',
  background: '#F6F3EF',
  panel: '#FFFFFF',
} as const;

export function EmailLayout({ preview, footer, children }: EmailLayoutProps) {
  return (
    <Html lang="es-AR">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: colors.background,
          color: colors.text,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          margin: 0,
          padding: '24px 0',
        }}
      >
        <Container
          style={{
            backgroundColor: colors.panel,
            border: `1px solid ${colors.line}`,
            borderRadius: '8px',
            maxWidth: '480px',
            padding: '32px 28px',
          }}
        >
          <Section>{children}</Section>
          <Hr style={{ borderColor: colors.line, margin: '28px 0 16px' }} />
          <Text style={{ color: colors.muted, fontSize: '12px', lineHeight: '18px', margin: 0 }}>
            {footer}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
