import { parseTimeZone } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { memoryLogger } from '../testing/support.js';
import { createMailer } from './mailer.js';
import { ResendEmailTransport } from './resend.js';
import { EmailDeliveryError, LogEmailTransport, MemoryEmailTransport } from './transport.js';

describe('mailer (React Email, es-AR)', () => {
  it('renders the sign-in code in HTML and plain text', async () => {
    const transport = new MemoryEmailTransport();
    await createMailer(transport).sendSignInCode({
      to: 'ana@example.com',
      code: '482913',
      expiresInS: 300,
    });
    const [message] = transport.sent;
    expect(message).toMatchObject({
      to: 'ana@example.com',
      kind: 'sign_in_code',
      subject: '482913 es tu código para ingresar',
    });
    expect(message?.html).toMatch(/^<!DOCTYPE html/);
    expect(message?.html).toContain('lang="es-AR"');
    expect(message?.html).toContain('482913');
    expect(message?.text).toContain('482913');
    expect(message?.text).toContain('Vence en 5 minutos y sirve una sola vez.');
    expect(message?.text).toContain('Si no lo pediste, ignorá este correo');
    expect(message?.text).not.toContain('<');
  });

  it('renders the invitation with the inviter, the role and the expiry in the club time zone', async () => {
    const transport = new MemoryEmailTransport();
    const mailer = createMailer(transport);
    const input = {
      to: 'coach@example.com',
      clubName: 'Olivos Rugby Club',
      role: 'sc' as const,
      inviterName: 'Laura Gómez',
      url: 'https://app.example.com/invite/abc',
      expiresAt: new Date('2026-11-08T02:30:00.000Z'),
      timeZone: parseTimeZone('America/Argentina/Buenos_Aires'),
    };
    await mailer.sendInvitation(input);
    await mailer.sendInvitation({ ...input, inviterName: '  ' });
    const [named, anonymous] = transport.sent;
    expect(named?.subject).toBe('Te invitaron a Olivos Rugby Club');
    expect(named?.text).toContain(
      'Laura Gómez te invitó a sumarte a Olivos Rugby Club como Preparador/a físico/a.',
    );
    // 02:30 UTC is 23:30 of the previous day in Buenos Aires.
    expect(named?.text).toContain('El link vence el 07/11/2026 23:30');
    expect(named?.html).toContain('href="https://app.example.com/invite/abc"');
    expect(anonymous?.text).toContain(
      'Te invitaron a sumarte a Olivos Rugby Club como Preparador/a físico/a.',
    );
  });
});

describe('email transports', () => {
  const message = {
    to: 'ana@example.com',
    subject: 'Asunto',
    html: '<p>Hola</p>',
    text: 'Hola',
    kind: 'sign_in_code',
  } as const;

  it('memory: keeps messages and can fail on demand', async () => {
    const transport = new MemoryEmailTransport();
    await transport.send(message);
    expect(transport.lastTo('ANA@example.com')).toEqual(message);
    transport.failing = true;
    await expect(transport.send(message)).rejects.toBeInstanceOf(EmailDeliveryError);
    transport.clear();
    expect(transport.sent).toEqual([]);
  });

  it('log: writes the plain text to the log instead of sending', async () => {
    const logs = memoryLogger();
    await new LogEmailTransport(logs.logger).send(message);
    const line = logs.lines().find((l) => typeof l.msg === 'string' && l.msg.includes('not sent'));
    expect(line?.level).toBe('warn');
    expect(line?.msg).toContain('Hola');
  });

  it('resend: sends html and text with a kind tag', async () => {
    const calls: unknown[] = [];
    const transport = new ResendEmailTransport({
      apiKey: 'unused-placeholder-key',
      from: 'Sport Performance <no-reply@sport.example.com>',
      client: {
        emails: {
          send: (payload: unknown) => {
            calls.push(payload);
            return Promise.resolve({ data: { id: 'email-1' }, error: null, headers: null });
          },
        },
      } as never,
    });
    await transport.send(message);
    expect(calls).toEqual([
      {
        from: 'Sport Performance <no-reply@sport.example.com>',
        to: 'ana@example.com',
        subject: 'Asunto',
        html: '<p>Hola</p>',
        text: 'Hola',
        tags: [{ name: 'kind', value: 'sign_in_code' }],
      },
    ]);
  });

  it('resend: turns provider errors into EmailDeliveryError without the recipient', async () => {
    const failing = (send: () => Promise<unknown>) =>
      new ResendEmailTransport({
        apiKey: 'unused-placeholder-key',
        from: 'x@example.com',
        client: { emails: { send } } as never,
      });
    const rejected = failing(() =>
      Promise.resolve({
        data: null,
        error: { name: 'validation_error', statusCode: 422, message: 'ana@example.com is bad' },
        headers: null,
      }),
    );
    const error = await rejected.send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as Error).message).toBe('Resend rejected the email: validation_error 422');
    const down = failing(() => Promise.reject(new Error('ECONNRESET')));
    await expect(down.send(message)).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});
