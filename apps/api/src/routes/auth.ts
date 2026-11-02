import { sendSignInCode, signOut, verifySignInCode } from '@sport-performance/contracts';
import { DEFAULT_CLUB_TIME_ZONE, parseUserId, type UserId } from '@sport-performance/domain';
import { isAPIError } from 'better-auth/api';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { forwardSetCookie, sessionHeaders } from '../auth/authenticate.js';
import {
  generateSignInCode,
  signInWithCode,
  SIGN_IN_CODE_EXPIRES_IN_S,
} from '../auth/better-auth.js';
import {
  describeSessionClient,
  newDeviceId,
  readDeviceCookie,
  setDeviceCookie,
  type SessionClient,
} from '../auth/device.js';
import type { AuthModule } from '../auth/module.js';
import { enforceRateLimits } from '../auth/rate-limit.js';
import { EmailDeliveryError } from '../email/transport.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';

/** Code of a Better Auth `APIError` (`INVALID_OTP`, `OTP_EXPIRED`…), if `error` is one. */
export function betterAuthErrorCode(error: unknown): string | undefined {
  if (!isAPIError(error)) return undefined;
  const body = error.body as { code?: unknown } | undefined;
  return typeof body?.code === 'string' ? body.code : undefined;
}

/** Maps the errors of the email OTP flow to the contract; anything else stays a server error. */
function otpError(error: unknown): unknown {
  if (error instanceof EmailDeliveryError) {
    return new HttpError('service_unavailable', 'The email could not be sent', { cause: error });
  }
  switch (betterAuthErrorCode(error)) {
    case 'INVALID_OTP':
      return new HttpError('unauthenticated', 'Invalid code', { cause: error });
    case 'OTP_EXPIRED':
      return new HttpError('unauthenticated', 'Expired code', { cause: error });
    case 'TOO_MANY_ATTEMPTS':
      // This code is burnt: the fix is requesting a new one, not waiting, so
      // unlike the window limits this 429 carries no `Retry-After` (ADR 0028).
      return new HttpError('rate_limited', 'Too many attempts for this code: request a new one', {
        cause: error,
      });
    case 'INVALID_EMAIL':
      return new HttpError('validation_failed', 'Invalid email', { cause: error });
    default:
      return error;
  }
}

/** Expiry of the session Better Auth just created for `token`, as stored. */
async function createdSessionExpiry(
  betterAuth: AuthModule['betterAuth'],
  token: string,
): Promise<Date> {
  const found = await betterAuth.api.getSession({
    headers: new Headers({ authorization: `Bearer ${token}` }),
    query: { disableRefresh: true },
  });
  if (found === null) throw new Error('Better Auth did not find the session it just created');
  return new Date(found.session.expiresAt);
}

/**
 * After a sign-in: remembers the device and, when the account had not used
 * it (or it has no id), emails a "new sign-in" notice (B-333, ADR 0033). A
 * brand-new account gets no notice: its first device is the one that just
 * created it. Best effort: the session is already open, so a failure here is
 * logged (ids only, ADR 0016) and the sign-in still succeeds.
 */
async function noticeNewDevice(
  auth: AuthModule,
  log: FastifyBaseLogger,
  signedIn: {
    userId: UserId;
    email: string;
    deviceId: string | undefined;
    client: SessionClient;
    userCreated: boolean;
  },
): Promise<void> {
  try {
    const known =
      signedIn.deviceId === undefined
        ? false
        : (await auth.sessions.rememberDevice(signedIn.userId, signedIn.deviceId)).known;
    if (known || signedIn.userCreated) return;
    const memberships = await auth.identity.activeMemberships(signedIn.userId);
    await auth.mailer.sendNewSignIn({
      to: signedIn.email,
      device: { os: signedIn.client.deviceOs, browser: signedIn.client.deviceBrowser },
      at: auth.now(),
      timeZone: memberships[0]?.clubTimeZone ?? DEFAULT_CLUB_TIME_ZONE,
    });
  } catch (error) {
    log.error({ err: error, userId: signedIn.userId }, 'new sign-in notice failed');
  }
}

/**
 * `/v1/auth/*`: sign in with a code by email and sign out (ADR 0010, ADR
 * 0028). They call Better Auth's server API, so answers keep the contract's
 * envelope; the session cookie Better Auth sets is forwarded as is.
 */
export function registerAuthRoutes(app: FastifyInstance, auth: AuthModule): void {
  const { betterAuth, rateLimiter, limits } = auth;

  registerEndpoint(app, sendSignInCode, {
    transaction: false,
    handler: async ({ body }, { request }) => {
      const email = body.email.toLowerCase();
      await enforceRateLimits(rateLimiter, [
        [limits.signInCodeByIp, request.ip],
        [limits.signInCodeByEmail, email],
      ]);
      try {
        const code = await generateSignInCode(betterAuth, email);
        await auth.mailer.sendSignInCode({
          to: email,
          code,
          expiresInS: SIGN_IN_CODE_EXPIRES_IN_S,
        });
      } catch (error) {
        throw otpError(error);
      }
      return { expiresInS: SIGN_IN_CODE_EXPIRES_IN_S };
    },
  });

  registerEndpoint(app, verifySignInCode, {
    transaction: false,
    handler: async ({ body }, { request, reply }) => {
      const email = body.email.toLowerCase();
      await enforceRateLimits(rateLimiter, [
        [limits.verifyByIp, request.ip],
        [limits.verifyByEmail, email],
      ]);
      const client = describeSessionClient(body.transport, request.headers['user-agent']);
      // The web's device id lives in an HttpOnly cookie of ours; the app sends its own.
      const deviceId =
        body.transport === 'cookie'
          ? (readDeviceCookie(request, auth.secureCookies) ?? newDeviceId())
          : body.deviceId;
      let result;
      try {
        result = await signInWithCode(betterAuth, { email, code: body.code, client });
      } catch (error) {
        throw otpError(error);
      }
      const { user, token } = result.response;
      const userId = parseUserId(user.id);
      const expiresAt = await createdSessionExpiry(betterAuth, token);
      if (body.transport === 'cookie') {
        forwardSetCookie(reply, result.headers);
        if (deviceId !== undefined) setDeviceCookie(reply, deviceId, auth.secureCookies);
      }
      await noticeNewDevice(auth, request.log, {
        userId,
        email: user.email,
        deviceId,
        client,
        userCreated: result.userCreated,
      });
      // No caching of a response that may carry a session token.
      void reply.header('cache-control', 'no-store');
      return {
        user: {
          id: userId,
          email: user.email,
          name: user.name,
          isSuperadmin: (user as { isSuperadmin?: unknown }).isSuperadmin === true,
        },
        session: {
          expiresAt: expiresAt.toISOString(),
          token: body.transport === 'bearer' ? token : null,
        },
      };
    },
  });

  registerEndpoint(app, signOut, {
    transaction: false,
    handler: async (_input, { request, reply }) => {
      const result = await betterAuth.api.signOut({
        headers: sessionHeaders(request),
        returnHeaders: true,
      });
      forwardSetCookie(reply, result.headers);
      return undefined;
    },
  });
}
