import { describe, expect, it } from 'vitest';
import { DomainValidationError } from '../errors.js';
import {
  assertAppVersionPolicy,
  compareAppVersions,
  evaluateAppCompatibility,
  formatAppVersion,
  isAppCompatibilityStatus,
  isAppPlatform,
  isAppVersion,
  parseAppPlatform,
  parseAppVersion,
} from './index.js';

describe('app versions', () => {
  it('parses MAJOR.MINOR.PATCH', () => {
    expect(parseAppVersion('1.4.0')).toEqual({ major: 1, minor: 4, patch: 0 });
    expect(parseAppVersion('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(formatAppVersion(parseAppVersion('10.20.30'))).toBe('10.20.30');
    expect(isAppVersion('999999.0.1')).toBe(true);
  });

  it.each([
    '',
    '1',
    '1.2',
    '1.2.3.4',
    '01.2.3',
    '1.02.3',
    '1.2.3-beta.1',
    '1.2.3+45',
    ' 1.2.3',
    'v1.2.3',
    '1.2.x',
    '1234567.0.0',
  ])('rejects %j', (value) => {
    expect(isAppVersion(value)).toBe(false);
    expect(() => parseAppVersion(value)).toThrow(DomainValidationError);
  });

  it('rejects non strings', () => {
    expect(isAppVersion(1)).toBe(false);
    expect(() => parseAppVersion(null)).toThrow(DomainValidationError);
  });

  it('compares numerically, not as text', () => {
    expect(compareAppVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareAppVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareAppVersions('1.2.3', '1.2.10')).toBeLessThan(0);
    expect(compareAppVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareAppVersions(parseAppVersion('0.9.0'), '1.0.0')).toBeLessThan(0);
  });

  it('knows the app platforms (not the web)', () => {
    expect(isAppPlatform('ios')).toBe(true);
    expect(isAppPlatform('android')).toBe(true);
    expect(isAppPlatform('web')).toBe(false);
    expect(parseAppPlatform('ios')).toBe('ios');
    expect(() => parseAppPlatform('windows')).toThrow(DomainValidationError);
  });
});

describe('evaluateAppCompatibility', () => {
  const policy = { minVersion: '1.2.0', latestVersion: '1.5.1' };

  it('requires an update below the minimum', () => {
    expect(evaluateAppCompatibility(policy, '1.1.9')).toBe('update_required');
    expect(evaluateAppCompatibility(policy, '0.9.0')).toBe('update_required');
  });

  it('offers an update between the minimum and the latest', () => {
    expect(evaluateAppCompatibility(policy, '1.2.0')).toBe('update_available');
    expect(evaluateAppCompatibility(policy, '1.5.0')).toBe('update_available');
  });

  it('is supported at or above the latest', () => {
    expect(evaluateAppCompatibility(policy, '1.5.1')).toBe('supported');
    // A build newer than the announced latest (in review, internal testing).
    expect(evaluateAppCompatibility(policy, '1.6.0')).toBe('supported');
  });

  it('without a latest version, only the minimum matters', () => {
    const minOnly = { minVersion: '1.0.0', latestVersion: null };
    expect(evaluateAppCompatibility(minOnly, '1.0.0')).toBe('supported');
    expect(evaluateAppCompatibility(minOnly, '0.9.9')).toBe('update_required');
  });

  it('rejects a latest version older than the minimum', () => {
    const broken = { minVersion: '2.0.0', latestVersion: '1.9.0' };
    expect(() => {
      assertAppVersionPolicy(broken);
    }).toThrow(DomainValidationError);
    expect(() => evaluateAppCompatibility(broken, '2.0.0')).toThrow(DomainValidationError);
  });

  it('guards the statuses', () => {
    expect(isAppCompatibilityStatus('update_required')).toBe(true);
    expect(isAppCompatibilityStatus('blocked')).toBe(false);
  });
});
