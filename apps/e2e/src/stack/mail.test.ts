import { LogEmailTransport, createMailer } from '@sport-performance/api';
import { DEFAULT_CLUB_TIME_ZONE } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { latestSignInCode, parseMailLogLine, parseMailbox, type MailboxEntry } from './mail.ts';

/**
 * The API's real mailer and development transport, with the line pino would
 * write for it (`isoTime`, `level` label, the object merged, `msg`): the
 * parser reads what the stack's API prints.
 */
async function apiLogLines(send: (mailer: ReturnType<typeof createMailer>) => Promise<void>) {
  const lines: string[] = [];
  const transport = new LogEmailTransport({
    warn(object, message) {
      lines.push(
        JSON.stringify({
          level: 'warn',
          time: '2026-11-04T12:00:00.000Z',
          service: 'api',
          ...object,
          msg: message,
        }),
      );
    },
  });
  await send(createMailer(transport));
  return lines;
}

describe('parseMailLogLine', () => {
  it('reads the sign-in code of the rendered email', async () => {
    const [line] = await apiLogLines((mailer) =>
      mailer.sendSignInCode({ to: 'Demo-E2E.Admin@example.com', code: '042917', expiresInS: 600 }),
    );
    expect(parseMailLogLine(line ?? '')).toEqual({
      to: 'demo-e2e.admin@example.com',
      kind: 'sign_in_code',
      subject: expect.any(String) as string,
      code: '042917',
      links: [],
      at: Date.parse('2026-11-04T12:00:00.000Z'),
    });
  });

  it('keeps the links of an invitation, without a code', async () => {
    const [line] = await apiLogLines((mailer) =>
      mailer.sendInvitation({
        to: 'nuevo@example.com',
        clubName: 'Club Atlético Demo',
        role: 'coach',
        inviterName: 'Carolina Ibarra',
        url: 'http://127.0.0.1:4174/invite/abc123',
        expiresAt: new Date('2026-11-11T12:00:00.000Z'),
        timeZone: DEFAULT_CLUB_TIME_ZONE,
      }),
    );
    const entry = parseMailLogLine(line ?? '');
    expect(entry).toMatchObject({ kind: 'invitation', code: null });
    expect(entry?.links).toContain('http://127.0.0.1:4174/invite/abc123');
  });

  it('ignores every other line', () => {
    expect(parseMailLogLine('')).toBeNull();
    expect(parseMailLogLine('Error: boom\n    at main.js:1')).toBeNull();
    expect(parseMailLogLine('{"level":"info","msg":"api ready"}')).toBeNull();
    expect(parseMailLogLine('{"devEmail":{"kind":1}}')).toBeNull();
    expect(parseMailLogLine('{not json')).toBeNull();
  });
});

describe('mailbox', () => {
  const entry = (to: string, code: string | null, kind = 'sign_in_code'): MailboxEntry => ({
    to,
    kind,
    subject: '',
    code,
    links: [],
    at: 0,
  });

  it('gives the newest code of the recipient, case-insensitively', () => {
    const entries = [
      entry('a@example.com', '111111'),
      entry('b@example.com', '222222'),
      entry('a@example.com', '333333'),
      entry('a@example.com', null, 'new_sign_in'),
    ];
    expect(latestSignInCode(entries, 'A@example.com')).toBe('333333');
    expect(latestSignInCode(entries, 'c@example.com')).toBeNull();
  });

  it('skips a line cut by a crash', () => {
    const content = `${JSON.stringify(entry('a@example.com', '123456'))}\n{"to":"a@exa`;
    expect(parseMailbox(content)).toHaveLength(1);
  });
});
