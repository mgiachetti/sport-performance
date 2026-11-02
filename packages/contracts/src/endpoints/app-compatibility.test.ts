import { describe, expect, it } from 'vitest';
import { errorCodeForStatus } from '../primitives/errors.js';
import { CONTRACT_VERSION, RUNTIME_VERSION_PATTERN } from '../versioning.js';
import { appCompatibilitySchema, getAppCompatibility } from './app-compatibility.js';
import { apiEndpoints } from './index.js';

describe('getAppCompatibility', () => {
  it('is public, outside the app version check, and in the catalog', () => {
    expect(getAppCompatibility.auth).toBe('public');
    expect(getAppCompatibility.skipAppVersionCheck).toBe(true);
    expect(apiEndpoints.getHealth.skipAppVersionCheck).toBe(true);
    expect(apiEndpoints.getAppCompatibility).toBe(getAppCompatibility);
  });

  it('takes a platform and a native version, nothing else', () => {
    const query = getAppCompatibility.query;
    expect(query.safeParse({ platform: 'ios', version: '1.4.0' }).success).toBe(true);
    expect(query.safeParse({ platform: 'android', version: '0.1.0' }).success).toBe(true);
    expect(query.safeParse({ platform: 'web', version: '1.4.0' }).success).toBe(false);
    expect(query.safeParse({ platform: 'ios', version: '1.4' }).success).toBe(false);
    expect(query.safeParse({ platform: 'ios', version: '1.4.0-beta' }).success).toBe(false);
    expect(query.safeParse({ platform: 'ios' }).success).toBe(false);
    expect(query.safeParse({ platform: 'ios', version: '1.4.0', extra: '1' }).success).toBe(false);
  });

  it('describes the answer', () => {
    const answer = {
      status: 'update_required',
      platform: 'ios',
      version: '1.0.0',
      minVersion: '1.2.0',
      latestVersion: null,
      storeUrl: 'https://apps.apple.com/app/id0000000000',
      api: { contractVersion: CONTRACT_VERSION, serverVersion: 'a1b2c3d' },
    };
    expect(appCompatibilitySchema.parse(answer)).toEqual(answer);
    expect(
      appCompatibilitySchema.safeParse({ ...answer, storeUrl: 'http://example.com' }).success,
    ).toBe(false);
    expect(appCompatibilitySchema.safeParse({ ...answer, status: 'blocked' }).success).toBe(false);
  });

  it('maps 426 to app_update_required', () => {
    expect(errorCodeForStatus(426)).toBe('app_update_required');
  });

  it('bounds runtime versions', () => {
    expect(RUNTIME_VERSION_PATTERN.test('1.4.0')).toBe(true);
    expect(RUNTIME_VERSION_PATTERN.test('fingerprint-abc123')).toBe(true);
    expect(RUNTIME_VERSION_PATTERN.test('')).toBe(false);
    expect(RUNTIME_VERSION_PATTERN.test('a b')).toBe(false);
    expect(RUNTIME_VERSION_PATTERN.test('x'.repeat(65))).toBe(false);
  });
});
