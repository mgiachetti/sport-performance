import { describe, expect, it } from 'vitest';
import { packageName } from './index.js';

describe('@sport-performance/domain', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@sport-performance/domain');
  });
});
