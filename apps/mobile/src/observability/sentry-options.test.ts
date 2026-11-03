import type { ErrorEvent } from '@sentry/react-native';
import { describe, expect, it } from 'vitest';
import { runtimeConfigFromEnv } from '../config/runtime-config.ts';
import { scrubBreadcrumb, scrubEvent, scrubUrl, sentryOptions } from './sentry-options.ts';

// A link token is 43 base64url characters (256 bits); a fixed fake one.
const TOKEN = 'k'.repeat(43);
const PLAYER_ID = '0b6f4f5e-3a1c-4c2f-8f7a-1d2e3f4a5b6c';

describe('scrubUrl', () => {
  it('drops query strings and fragments', () => {
    expect(scrubUrl('https://api.example.com/v1/players?search=Ana#x')).toBe(
      'https://api.example.com/v1/players',
    );
  });

  it('replaces link tokens, in routes and deep links', () => {
    expect(scrubUrl(`/invite/${TOKEN}`)).toBe('/invite/:token');
    expect(scrubUrl('/player-access/anything')).toBe('/player-access/:token');
    expect(scrubUrl(`sportperformance://invite/${TOKEN}`)).toBe('sportperformance://invite/:token');
    expect(scrubUrl(`https://app.example.com/invite/${TOKEN}?a=1`)).toBe(
      'https://app.example.com/invite/:token',
    );
    expect(scrubUrl(`/somewhere/${TOKEN}`)).toBe('/somewhere/:token');
  });

  it('keeps ids, which are not personal data', () => {
    expect(scrubUrl(`https://api.example.com/v1/players/${PLAYER_ID}`)).toBe(
      `https://api.example.com/v1/players/${PLAYER_ID}`,
    );
  });
});

describe('scrubBreadcrumb', () => {
  it('drops console, touch and UI breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'Ana López 3,2' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'touch', message: 'Ana López' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'ui.input' })).toBeNull();
    expect(scrubBreadcrumb({ message: 'no category' })).toBeNull();
  });

  it('keeps only method, status and scrubbed URLs of requests and navigation', () => {
    expect(
      scrubBreadcrumb({
        category: 'fetch',
        data: {
          method: 'POST',
          url: 'https://api.example.com/v1/invitations/preview?x=1',
          status_code: 200,
          request_body: '{"token":"secret"}',
          response_body_size: 10,
        },
      }),
    ).toEqual({
      category: 'fetch',
      data: {
        method: 'POST',
        url: 'https://api.example.com/v1/invitations/preview',
        status_code: 200,
      },
    });
    expect(
      scrubBreadcrumb({
        category: 'navigation',
        data: { from: '/sign-in', to: `/invite/${TOKEN}`, params: { token: TOKEN } },
      }),
    ).toEqual({ category: 'navigation', data: { from: '/sign-in', to: '/invite/:token' } });
  });
});

describe('scrubEvent', () => {
  it('keeps only the user id and request method and path', () => {
    const event: ErrorEvent = {
      type: undefined,
      user: { id: 'u1', email: 'ana@example.com', username: 'ana', ip_address: '1.2.3.4' },
      request: {
        method: 'GET',
        url: 'https://api.example.com/v1/players?search=Ana',
        headers: { authorization: 'Bearer secret' },
        cookies: { a: 'b' },
        data: '{"x":1}',
      },
      extra: { wellness: 2 },
      contexts: { device: { name: 'iPhone de Ana', model: 'iPhone15,2' } },
      transaction: `/invite/${TOKEN}`,
      breadcrumbs: [
        { category: 'console', message: 'secret' },
        { category: 'navigation', data: { to: `/invite/${TOKEN}` } },
      ],
    };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.user).toEqual({ id: 'u1' });
    expect(scrubbed.request).toEqual({ method: 'GET', url: 'https://api.example.com/v1/players' });
    expect(scrubbed.extra).toBeUndefined();
    expect(scrubbed.contexts?.device).toEqual({ model: 'iPhone15,2' });
    expect(scrubbed.transaction).toBe('/invite/:token');
    expect(scrubbed.breadcrumbs).toEqual([
      { category: 'navigation', data: { to: '/invite/:token' } },
    ]);
  });
});

describe('sentryOptions', () => {
  const build = {
    appId: 'com.sportperformance.app',
    nativeVersion: '1.2.0',
    buildNumber: '42',
    updateId: null,
  };

  it('is null without a DSN: Sentry is not initialized', () => {
    expect(sentryOptions(runtimeConfigFromEnv({}, 's'), build)).toBeNull();
  });

  it('collects nothing personal and names the release and environment', () => {
    const config = runtimeConfigFromEnv(
      {
        APP_VARIANT: 'staging',
        API_BASE_URL: 'https://api.example.com',
        WEB_APP_URL: 'https://app.example.com',
        SENTRY_DSN: 'https://key@o1.ingest.sentry.io/2',
      },
      'sportperformance-staging',
    );
    const options = sentryOptions(config, { ...build, updateId: 'u-1' });
    expect(options).toMatchObject({
      dsn: 'https://key@o1.ingest.sentry.io/2',
      environment: 'staging',
      release: 'com.sportperformance.app@1.2.0+42',
      dist: '42',
      tracesSampleRate: 0,
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      reportAccessibilityIdentifier: false,
      enableCaptureFailedRequests: false,
      initialScope: { tags: { update_id: 'u-1' } },
    });
    expect(options?.beforeBreadcrumb?.({ category: 'console' }, undefined)).toBeNull();
  });
});
