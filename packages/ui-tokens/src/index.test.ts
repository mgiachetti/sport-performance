import { describe, expect, it } from 'vitest';
import { packageName } from './index.js';

describe('@sport-performance/ui-tokens', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@sport-performance/ui-tokens');
  });
});
