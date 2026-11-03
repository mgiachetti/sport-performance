import { describe, expect, it } from 'vitest';
import { ExpoPushService, PushDeliveryError, type PushMessage } from './expo.js';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(answer: (call: Call) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (input: string, init?: RequestInit) => {
    const call = {
      url: input,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(init?.body as string) as unknown,
    };
    calls.push(call);
    return Promise.resolve(answer(call));
  };
  return { fetch: fn as unknown as typeof fetch, calls };
}

const message = (to: string): PushMessage => ({
  to,
  title: 'Título',
  body: 'Cuerpo',
  data: { kind: 'rpe_request', path: '/x' },
  priority: 'default',
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('ExpoPushService', () => {
  it('sends in chunks of 100 and maps the tickets in order', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      const sent = call.body as { to: string }[];
      return json({
        data: sent.map((m, i) =>
          i === 0 && m.to === 'bad'
            ? {
                status: 'error',
                message: 'not registered',
                details: { error: 'DeviceNotRegistered' },
              }
            : { status: 'ok', id: `id-${m.to}` },
        ),
      });
    });
    const service = new ExpoPushService({ fetch, accessToken: 'secret-token-123' });
    const messages = ['bad', ...Array.from({ length: 150 }, (_, i) => `t${String(i)}`)].map(
      message,
    );
    const tickets = await service.send(messages);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://exp.host/--/api/v2/push/send');
    expect(calls[0]?.headers.authorization).toBe('Bearer secret-token-123');
    expect((calls[0]?.body as unknown[]).length).toBe(100);
    expect(calls[0]?.body).toContainEqual({
      to: 't0',
      title: 'Título',
      body: 'Cuerpo',
      data: { kind: 'rpe_request', path: '/x' },
      priority: 'default',
      sound: 'default',
    });
    expect(tickets).toHaveLength(151);
    expect(tickets[0]).toEqual({ status: 'error', code: 'DeviceNotRegistered' });
    expect(tickets[1]).toEqual({ status: 'ok', id: 'id-t0' });
  });

  it('reads receipts and keeps only safe error codes', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        data: {
          a: { status: 'ok' },
          b: { status: 'error', details: { error: 'MessageTooBig' } },
          c: { status: 'error', details: { error: 'a code with spaces <x>' } },
        },
      }),
    );
    const receipts = await new ExpoPushService({ fetch }).receipts(['a', 'b', 'c', 'd']);
    expect(calls[0]?.url).toBe('https://exp.host/--/api/v2/push/getReceipts');
    expect(calls[0]?.headers.authorization).toBeUndefined();
    expect(calls[0]?.body).toEqual({ ids: ['a', 'b', 'c', 'd'] });
    expect([...receipts]).toEqual([
      ['a', { status: 'ok' }],
      ['b', { status: 'error', code: 'MessageTooBig' }],
      ['c', { status: 'error', code: 'UnknownError' }],
    ]);
  });

  it('turns HTTP errors, bodies it does not understand and network errors into a code', async () => {
    const cases: [() => Response | Promise<never>, string][] = [
      [() => json({ errors: [] }, 503), 'HTTP_503'],
      [() => json({ data: [] }), 'InvalidResponse'],
      [() => new Response('<html>', { status: 200 }), 'InvalidResponse'],
      [() => Promise.reject(new Error('ECONNRESET')), 'NetworkError'],
    ];
    for (const [answer, code] of cases) {
      const fetch = (() => {
        const result = answer();
        return result instanceof Response ? Promise.resolve(result) : result;
      }) as typeof globalThis.fetch;
      const error = await new ExpoPushService({ fetch })
        .send([message('t')])
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PushDeliveryError);
      expect((error as PushDeliveryError).code).toBe(code);
      expect((error as Error).message).not.toContain('ExponentPushToken');
    }
  });
});
