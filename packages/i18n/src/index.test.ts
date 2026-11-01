import { describe, expect, it } from 'vitest';
import { packageName } from './index.js';

describe('@sport-performance/i18n', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@sport-performance/i18n');
  });
});
