import {
  ApiContractError,
  ApiError,
  ApiNetworkError,
  CLIENT_PLATFORM_HEADER,
  CLIENT_VERSION_HEADER,
} from '@sport-performance/contracts';
import { createTranslator } from '@sport-performance/i18n';
import { describe, expect, it } from 'vitest';
import { SESSION_TOKEN_KEY } from '../auth/session-store.ts';
import { apiError } from '../test/fake-api.ts';
import { ORC_THEME, SESSION_TOKEN, testServices } from '../test/fixtures.ts';
import type { ApiFailureEvent } from './client.ts';
import { errorMessage } from './error-message.ts';
import { retryDelayMs, shouldRetry } from './query-client.ts';

const translator = createTranslator();
const { t } = translator;

function error(code: string, status = 400, retryAfterS?: number): ApiError {
  return new ApiError({ operationId: 'op', status, code, message: code, retryAfterS });
}

describe('mobile API client', () => {
  it('sends the version headers and the language, and no token while signed out', async () => {
    const { services, api } = testServices();
    api.on('GET /v1/clubs/orc/theme', { status: 200, body: ORC_THEME });
    await services.api.client.getClubTheme({ params: { clubSlug: 'orc' } });
    const request = api.last('GET /v1/clubs/orc/theme');
    expect(request?.headers).toMatchObject({
      [CLIENT_PLATFORM_HEADER]: 'ios',
      [CLIENT_VERSION_HEADER]: '1.0.0',
      'accept-language': 'es-AR',
    });
    expect(request?.headers.authorization).toBeUndefined();
    expect(request?.headers['x-membership-id']).toBeUndefined();
  });

  it('publishes the failures that concern the whole app, and still throws them', async () => {
    const { services, api } = testServices({ secure: { [SESSION_TOKEN_KEY]: SESSION_TOKEN } });
    const events: ApiFailureEvent['kind'][] = [];
    services.api.onFailure((event) => events.push(event.kind));

    api.on('GET /v1/clubs/orc/theme', apiError(404, 'not_found'));
    await expect(
      services.api.client.getClubTheme({ params: { clubSlug: 'orc' } }),
    ).rejects.toThrow();
    // A public endpoint never means "session expired".
    api.on('POST /v1/auth/email-otp/verify', apiError(401, 'unauthenticated'));
    await expect(
      services.api.client.verifySignInCode({
        body: { email: 'a@example.com', code: '123456', transport: 'bearer' },
      }),
    ).rejects.toThrow();
    api.on('GET /v1/me', apiError(401, 'unauthenticated'));
    await expect(services.api.client.getMe()).rejects.toThrow();
    api.on('GET /v1/players', apiError(426, 'app_update_required'));
    await expect(services.api.client.listPlayers()).rejects.toThrow();

    expect(events).toEqual(['session_expired', 'update_required']);
  });

  it('moves the version gate to "update required" on a 426', async () => {
    const { services, api } = testServices();
    api.on('GET /v1/clubs/orc/theme', apiError(426, 'app_update_required'));
    api.on('GET /v1/app/compatibility', {
      status: 200,
      body: {
        status: 'update_required',
        platform: 'ios',
        version: '1.0.0',
        runtimeVersion: null,
        minVersion: '1.2.0',
        latestVersion: '1.3.0',
        storeUrl: 'https://apps.apple.com/app/id1',
        contractVersion: '1.0.0',
      },
    });
    await expect(
      services.api.client.getClubTheme({ params: { clubSlug: 'orc' } }),
    ).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(services.versionGate.getState()).toMatchObject({ kind: 'update_required' });
  });
});

describe('errorMessage', () => {
  it('names a wrong or burnt code on the verification', () => {
    expect(errorMessage(error('unauthenticated', 401), 'verifyCode', translator)).toBe(
      t('auth.otp.invalid'),
    );
    expect(errorMessage(error('rate_limited', 429), 'verifyCode', translator)).toBe(
      t('auth.otp.tooManyAttempts'),
    );
  });

  it('says how long to wait on a window limit', () => {
    expect(errorMessage(error('rate_limited', 429, 600), 'requestCode', translator)).toBe(
      t('auth.rateLimitedFor', { unit: 'minutes', amount: 10 }),
    );
    expect(errorMessage(error('rate_limited', 429, 5), 'requestCode', translator)).toBe(
      t('auth.rateLimitedFor', { unit: 'seconds', amount: 5 }),
    );
  });

  it('explains invitations and guardian codes that no longer work', () => {
    expect(errorMessage(error('conflict', 409), 'invitationAccept', translator)).toBe(
      t('invitation.error.unavailable'),
    );
    expect(errorMessage(error('forbidden', 403), 'invitationAccept', translator)).toBe(
      t('invitation.error.wrongEmail'),
    );
    expect(errorMessage(error('not_found', 404), 'playerAccess', translator)).toBe(
      t('auth.playerAccess.notFound'),
    );
    expect(errorMessage(error('conflict', 409), 'playerAccess', translator)).toBe(
      t('auth.playerAccess.unavailable'),
    );
  });

  it('falls back to generic texts and never shows the server message', () => {
    expect(errorMessage(new ApiNetworkError('op', new Error('x')), 'generic', translator)).toBe(
      t('error.network'),
    );
    expect(errorMessage(error('service_unavailable', 503), 'requestCode', translator)).toBe(
      t('error.code.service_unavailable'),
    );
    expect(errorMessage(error('internal_error', 500), 'generic', translator)).toBe(
      t('error.generic'),
    );
    expect(
      errorMessage(
        new ApiContractError({ operationId: 'op', side: 'response', message: 'drift' }),
        'generic',
        translator,
      ),
    ).toBe(t('error.generic'));
    expect(errorMessage(new Error('boom'), 'generic', translator)).toBe(t('error.generic'));
  });
});

describe('query retries', () => {
  it('retries only what may succeed on its own', () => {
    expect(shouldRetry(0, new ApiNetworkError('op', new Error('offline')))).toBe(true);
    const aborted = new Error('aborted');
    aborted.name = 'AbortError';
    expect(shouldRetry(0, new ApiNetworkError('op', aborted))).toBe(false);
    expect(shouldRetry(0, error('internal_error', 500))).toBe(true);
    expect(shouldRetry(0, error('rate_limited', 429, 3))).toBe(true);
    expect(shouldRetry(0, error('rate_limited', 429))).toBe(false);
    expect(shouldRetry(0, error('not_found', 404))).toBe(false);
    expect(shouldRetry(0, error('app_update_required', 426))).toBe(false);
    expect(shouldRetry(2, error('internal_error', 500))).toBe(false);
  });

  it('backs off exponentially and honours Retry-After', () => {
    expect(retryDelayMs(0, new Error('x'))).toBe(1000);
    expect(retryDelayMs(3, new Error('x'))).toBe(8000);
    expect(retryDelayMs(10, new Error('x'))).toBe(30_000);
    expect(retryDelayMs(0, error('rate_limited', 429, 7))).toBe(7000);
  });
});
