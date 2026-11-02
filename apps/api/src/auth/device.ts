import { createHash, randomUUID } from 'node:crypto';
import { SESSION_COOKIE_PREFIX, type SessionTransport } from '@sport-performance/contracts';
import {
  isUuid,
  type DeviceBrowser,
  type DeviceOperatingSystem,
  type SessionClientType,
} from '@sport-performance/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * What a session records about the device it was opened from (ADR 0033):
 * how it travels and a coarse OS and browser. Derived once from the
 * `User-Agent`, which is not stored, like the IP.
 */
export interface SessionClient {
  readonly clientType: SessionClientType;
  readonly deviceOs: DeviceOperatingSystem | null;
  readonly deviceBrowser: DeviceBrowser | null;
}

/** Longer `User-Agent`s are cut before matching: the useful tokens come first. */
const USER_AGENT_MAX_LENGTH = 512;

/**
 * User-Agent of the mobile app (B-501 sets it): `SportPerformance/<version> (<os>; …)`.
 * React Native's default (`okhttp/…` on Android, `<App>/<build> CFNetwork/… Darwin/…`
 * on iOS) is recognized too.
 */
const APP_USER_AGENT = /^SportPerformance\/\S+ \((ios|android)\b/i;

/** Order matters: iPadOS and Android also say "Mac OS X" and "Linux". */
const OPERATING_SYSTEMS: readonly [RegExp, DeviceOperatingSystem][] = [
  [/\b(iPhone|iPad|iPod)\b|\bCFNetwork\/.*\bDarwin\//, 'ios'],
  [/\bAndroid\b|^okhttp\//i, 'android'],
  [/\bCrOS\b/, 'chromeos'],
  [/\bMacintosh\b|\bMac OS X\b/, 'macos'],
  [/\bWindows\b/, 'windows'],
  [/\bLinux\b|\bX11\b/, 'linux'],
];

/** Order matters: Edge, Opera and Samsung Internet also say "Chrome"; Chrome says "Safari". */
const BROWSERS: readonly [RegExp, DeviceBrowser][] = [
  [/\bSamsungBrowser\//, 'samsung_internet'],
  [/\bEdg(e|A|iOS)?\//, 'edge'],
  [/\bOPR\/|\bOpera\b/, 'opera'],
  [/\bFirefox\/|\bFxiOS\//, 'firefox'],
  [/\bChrome\/|\bCriOS\/|\bChromium\//, 'chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'safari'],
];

function firstMatch<T>(rules: readonly [RegExp, T][], value: string): T | null {
  for (const [pattern, result] of rules) if (pattern.test(value)) return result;
  return null;
}

/**
 * The client of a sign-in: `web` for the cookie transport, `mobile` for
 * bearer (the app), and the OS and browser the `User-Agent` tells, or `null`.
 * A mobile session's "browser" is the app itself.
 */
export function describeSessionClient(
  transport: SessionTransport,
  userAgent: string | undefined,
): SessionClient {
  const ua = (userAgent ?? '').slice(0, USER_AGENT_MAX_LENGTH);
  if (transport === 'bearer') {
    const app = APP_USER_AGENT.exec(ua)?.[1]?.toLowerCase();
    const os = app === 'ios' || app === 'android' ? app : firstMatch(OPERATING_SYSTEMS, ua);
    return { clientType: 'mobile', deviceOs: os, deviceBrowser: 'app' };
  }
  return {
    clientType: 'web',
    deviceOs: firstMatch(OPERATING_SYSTEMS, ua),
    deviceBrowser: firstMatch(BROWSERS, ua),
  };
}

/** A device stays known this long without signing in from it (`known_device`). */
export const KNOWN_DEVICE_TTL_DAYS = 400;

/**
 * Cookie with the id of a web device: `HttpOnly`, only sent to `/v1/auth`
 * (the sign-in endpoints), `__Secure-` over https like the session cookie.
 * 400 days is the longest lifetime browsers accept (RFC 6265bis).
 */
export function deviceCookieName(secure: boolean): string {
  return `${secure ? '__Secure-' : ''}${SESSION_COOKIE_PREFIX}.device_id`;
}

const DEVICE_COOKIE_PATH = '/v1/auth';

/** The device id the browser sent, if it is a well-formed one. */
export function readDeviceCookie(request: FastifyRequest, secure: boolean): string | undefined {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return undefined;
  const name = deviceCookieName(secure);
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part
      .slice(separator + 1)
      .trim()
      .toLowerCase();
    return isUuid(value) ? value : undefined;
  }
  return undefined;
}

/** A new random device id (UUID v4, 122 random bits). */
export function newDeviceId(): string {
  return randomUUID();
}

/** Sets (or refreshes) the device cookie, next to the session cookie Better Auth set. */
export function setDeviceCookie(reply: FastifyReply, deviceId: string, secure: boolean): void {
  const attributes = [
    `${deviceCookieName(secure)}=${deviceId}`,
    `Max-Age=${String(KNOWN_DEVICE_TTL_DAYS * 24 * 60 * 60)}`,
    `Path=${DEVICE_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ];
  const current = reply.getHeader('set-cookie');
  const previous =
    current === undefined ? [] : Array.isArray(current) ? current : [String(current)];
  void reply.header('set-cookie', [...previous, attributes.join('; ')]);
}

/** What `known_device` stores: the SHA-256 of the id, never the id itself. */
export function hashDeviceId(deviceId: string): string {
  return createHash('sha256').update(deviceId.toLowerCase()).digest('hex');
}
