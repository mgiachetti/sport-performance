import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { touchDue } from './authenticate.js';
import {
  describeSessionClient,
  deviceCookieName,
  hashDeviceId,
  newDeviceId,
  readDeviceCookie,
} from './device.js';

const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/122.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
  chromeOs:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  rnIos: 'SportPerformance/12 CFNetwork/1568.100.1 Darwin/24.0.0',
  rnAndroid: 'okhttp/4.12.0',
  appIos: 'SportPerformance/1.4.0 (iOS; 18.5)',
} as const;

describe('describeSessionClient', () => {
  it.each([
    [UA.chromeMac, 'macos', 'chrome'],
    [UA.safariMac, 'macos', 'safari'],
    [UA.safariIphone, 'ios', 'safari'],
    [UA.chromeIphone, 'ios', 'chrome'],
    [UA.chromeAndroid, 'android', 'chrome'],
    [UA.samsung, 'android', 'samsung_internet'],
    [UA.edgeWindows, 'windows', 'edge'],
    [UA.operaWindows, 'windows', 'opera'],
    [UA.firefoxLinux, 'linux', 'firefox'],
    [UA.chromeOs, 'chromeos', 'chrome'],
  ] as const)('web: %s', (userAgent, os, browser) => {
    expect(describeSessionClient('cookie', userAgent)).toEqual({
      clientType: 'web',
      deviceOs: os,
      deviceBrowser: browser,
    });
  });

  it.each([
    [UA.appIos, 'ios'],
    [UA.rnIos, 'ios'],
    [UA.rnAndroid, 'android'],
    [undefined, null],
  ] as const)('mobile: %s', (userAgent, os) => {
    expect(describeSessionClient('bearer', userAgent)).toEqual({
      clientType: 'mobile',
      deviceOs: os,
      deviceBrowser: 'app',
    });
  });

  it('says nothing it cannot tell, and ignores the tail of huge user agents', () => {
    expect(describeSessionClient('cookie', undefined)).toEqual({
      clientType: 'web',
      deviceOs: null,
      deviceBrowser: null,
    });
    expect(describeSessionClient('cookie', 'curl/8.7.1')).toMatchObject({
      deviceOs: null,
      deviceBrowser: null,
    });
    expect(describeSessionClient('cookie', `${'x'.repeat(600)} Windows Firefox/1`)).toMatchObject({
      deviceOs: null,
      deviceBrowser: null,
    });
  });
});

describe('device id', () => {
  const request = (cookie?: string) => ({ headers: { cookie } }) as unknown as FastifyRequest;

  it('reads only a well-formed id from its own cookie', () => {
    const id = newDeviceId();
    expect(readDeviceCookie(request(`a=b; sp.device_id=${id}; c=d`), false)).toBe(id);
    expect(readDeviceCookie(request(`sp.device_id=${id.toUpperCase()}`), false)).toBe(id);
    expect(readDeviceCookie(request(`__Secure-sp.device_id=${id}`), true)).toBe(id);
    expect(readDeviceCookie(request(`sp.device_id=${id}`), true)).toBeUndefined();
    expect(readDeviceCookie(request('sp.device_id=nope'), false)).toBeUndefined();
    expect(readDeviceCookie(request(), false)).toBeUndefined();
    expect(deviceCookieName(true)).toBe('__Secure-sp.device_id');
  });

  it('is stored as its SHA-256, case-insensitively', () => {
    const id = newDeviceId();
    expect(hashDeviceId(id)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeviceId(id.toUpperCase())).toBe(hashDeviceId(id));
    expect(hashDeviceId(id)).not.toContain(id);
  });
});

describe('touchDue', () => {
  const now = Date.parse('2026-11-01T12:00:00.000Z');
  it('refreshes the last use only after 5 minutes', () => {
    expect(touchDue(new Date(now - 4 * 60 * 1000), now)).toBe(false);
    expect(touchDue(new Date(now - 5 * 60 * 1000), now)).toBe(true);
    expect(touchDue('2026-11-01T11:00:00.000Z', now)).toBe(true);
    expect(touchDue(undefined, now)).toBe(true);
  });
});
