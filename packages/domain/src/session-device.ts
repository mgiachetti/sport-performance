import { memberGuard } from './enum.js';

/**
 * Vocabularies of a sign-in session (B-333, ADR 0033). What the user sees in
 * "Sesiones activas" to recognize a device, without storing the IP or the raw
 * `User-Agent`: the server derives these coarse values once, when the session
 * is created.
 */

/** `web`: the session travels in the `HttpOnly` cookie; `mobile`: as a bearer token (the app). */
export const SESSION_CLIENT_TYPES = ['web', 'mobile'] as const;
export type SessionClientType = (typeof SESSION_CLIENT_TYPES)[number];
export const isSessionClientType = memberGuard(SESSION_CLIENT_TYPES);

/** Operating system of the device, as far as the `User-Agent` tells. */
export const DEVICE_OPERATING_SYSTEMS = [
  'ios',
  'android',
  'macos',
  'windows',
  'linux',
  'chromeos',
] as const;
export type DeviceOperatingSystem = (typeof DEVICE_OPERATING_SYSTEMS)[number];
export const isDeviceOperatingSystem = memberGuard(DEVICE_OPERATING_SYSTEMS);

/** Browser of a web session (`app` for the mobile app itself). */
export const DEVICE_BROWSERS = [
  'chrome',
  'safari',
  'firefox',
  'edge',
  'opera',
  'samsung_internet',
  'app',
] as const;
export type DeviceBrowser = (typeof DEVICE_BROWSERS)[number];
export const isDeviceBrowser = memberGuard(DEVICE_BROWSERS);
