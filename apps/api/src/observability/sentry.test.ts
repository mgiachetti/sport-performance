import { describe, expect, it } from 'vitest';
import { isSafeRequestId } from './request-id.js';
import { scrubBreadcrumb, scrubEvent } from './sentry.js';

describe('scrubEvent', () => {
  it('keeps method, path and user id only', () => {
    const event = scrubEvent({
      request: {
        method: 'POST',
        url: 'https://api.example.com/v1/players?email=a%40b.c',
        query_string: 'email=a%40b.c',
        headers: { authorization: 'Bearer t', cookie: 'session=s' },
        cookies: { session: 's' },
        data: { name: 'Juan Pérez', weightKg: 61 },
      },
      user: { id: 'u-1', email: 'a@b.c', ip_address: '10.0.0.1', username: 'juan' },
      extra: { body: 'secret' },
    });
    expect(event).toEqual({
      request: { method: 'POST', url: 'https://api.example.com/v1/players' },
      user: { id: 'u-1' },
    });
  });

  it('scrubs breadcrumbs too', () => {
    const event = scrubEvent({
      breadcrumbs: [
        {
          category: 'http',
          data: { method: 'GET', url: '/v1/x?token=abc', status_code: 200, body: 'secret' },
        },
        { category: 'log', message: 'started' },
      ],
    });
    expect(event.breadcrumbs).toEqual([
      { category: 'http', data: { method: 'GET', url: '/v1/x', status_code: 200 } },
      { category: 'log', message: 'started' },
    ]);
  });

  it('drops user fields when there is no id', () => {
    expect(scrubEvent({ user: { email: 'a@b.c' } }).user).toEqual({});
  });

  it('leaves breadcrumbs without data untouched', () => {
    const crumb = { message: 'hello' };
    expect(scrubBreadcrumb(crumb)).toBe(crumb);
  });
});

describe('isSafeRequestId', () => {
  it.each(['0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f', 'web-1234abcd', 'job:sync.42_ab'])(
    'accepts %s',
    (id) => {
      expect(isSafeRequestId(id)).toBe(true);
    },
  );

  it.each(['', 'short', 'has space here', 'line\nbreak-abcdef', 'x'.repeat(129), ['a', 'b']])(
    'rejects %j',
    (id) => {
      expect(isSafeRequestId(id)).toBe(false);
    },
  );
});
