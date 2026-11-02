import { AsyncLocalStorage } from 'node:async_hooks';
import { SESSION_COOKIE_PREFIX, SIGN_IN_CODE_LENGTH } from '@sport-performance/contracts';
import type { Database as DrizzleDatabase } from '@sport-performance/db';
import { authSchema } from '@sport-performance/db/schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, emailOTP } from 'better-auth/plugins';
import type { FastifyBaseLogger } from 'fastify';

/** Lifetime of a sign-in code (ADR 0010). */
export const SIGN_IN_CODE_EXPIRES_IN_S = 5 * 60;
/** Wrong guesses a code survives; then it is burnt and a new one has to be requested. */
export const SIGN_IN_CODE_ALLOWED_ATTEMPTS = 3;
/** A session used after this long gets its expiry pushed back (and the cookie re-set). */
export const SESSION_UPDATE_AGE_S = 24 * 60 * 60;

export interface BetterAuthOptions {
  secret: string;
  /** Public origin of the API. */
  baseUrl: string;
  secureCookies: boolean;
  sessionExpiresInS: number;
  /** Drizzle client over Better Auth's pool, a login of `sport_performance_auth` (ADR 0026). */
  db: DrizzleDatabase;
  logger: FastifyBaseLogger;
}

/** Where Better Auth's `sendVerificationOTP` leaves the code of the current call. */
interface CodeOutbox {
  email?: string;
  code?: string;
}

const outbox = new AsyncLocalStorage<CodeOutbox>();

/**
 * Generates and stores a sign-in code for `email` and returns it, so the
 * caller sends the email itself. Better Auth swallows errors thrown by
 * `sendVerificationOTP` (it logs them and answers success), which would turn
 * a Resend outage into "code sent" without an email; collecting the code
 * here and mailing it from the endpoint surfaces delivery errors as `503`.
 */
export async function generateSignInCode(auth: SportAuth, email: string): Promise<string> {
  const box: CodeOutbox = {};
  await outbox.run(box, () => auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } }));
  if (box.code === undefined || box.email !== email) {
    throw new Error('Better Auth did not hand over the sign-in code');
  }
  return box.code;
}

/**
 * Better Auth inside the API (ADR 0010, ADR 0028), over the identity tables of
 * `packages/db`. Only its server API (`auth.api.*`) is used: the HTTP routes
 * are our own contract endpoints (`/v1/auth/*`), so its router, its CSRF
 * checks and its rate limiter are not mounted (`enforceRateLimits` and the
 * origin guard of the API replace them).
 *
 * - Email OTP: 6 digits, 5 minutes, hashed at rest, 3 attempts per code.
 *   Unknown emails get an account when they verify a code (invitations need it).
 * - Sessions: cookie `sp.session_token` for the web (`HttpOnly`, `SameSite=Lax`,
 *   `Secure` + `__Secure-` over https) and the same token as bearer for mobile.
 * - `isSuperadmin`: additional field, never writable through Better Auth.
 */
export function createBetterAuth(options: BetterAuthOptions) {
  const { logger } = options;
  return betterAuth({
    appName: 'Sport Performance',
    baseURL: options.baseUrl,
    secret: options.secret,
    database: drizzleAdapter(options.db, { provider: 'pg', schema: authSchema }),
    telemetry: { enabled: false },
    // Our endpoints apply their own limits; Better Auth's only covers its router.
    rateLimit: { enabled: false },
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: {
        isSuperadmin: { type: 'boolean', input: false, required: false, defaultValue: false },
      },
    },
    session: {
      expiresIn: options.sessionExpiresInS,
      updateAge: SESSION_UPDATE_AGE_S,
      // Every request reads the session from the database: revoking it is immediate.
      cookieCache: { enabled: false },
    },
    advanced: {
      database: { generateId: 'uuid' },
      cookiePrefix: SESSION_COOKIE_PREFIX,
      useSecureCookies: options.secureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: options.secureCookies },
      // The IP of minors' devices is personal data we do not need to keep with the session.
      ipAddress: { disableIpTracking: true },
    },
    logger: {
      level: 'warn',
      // Messages only: Better Auth's extra arguments may carry emails or tokens.
      log: (level, message) => {
        if (level === 'error') logger.error({ source: 'better-auth' }, message);
        else logger.warn({ source: 'better-auth' }, message);
      },
    },
    plugins: [
      emailOTP({
        otpLength: SIGN_IN_CODE_LENGTH,
        expiresIn: SIGN_IN_CODE_EXPIRES_IN_S,
        allowedAttempts: SIGN_IN_CODE_ALLOWED_ATTEMPTS,
        storeOTP: 'hashed',
        disableSignUp: false,
        // The email is sent by the endpoint (see `generateSignInCode`), not here.
        sendVerificationOTP: ({ email, otp }) => {
          const box = outbox.getStore();
          if (box === undefined) {
            return Promise.reject(
              new Error('sign-in codes are only generated through generateSignInCode'),
            );
          }
          box.email = email;
          box.code = otp;
          return Promise.resolve();
        },
      }),
      bearer(),
    ],
  });
}

export type SportAuth = ReturnType<typeof createBetterAuth>;
