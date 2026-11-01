import { describe, expect, it } from 'vitest';
import { appName, workspaceDependencies } from './index.js';

describe('api', () => {
  it('resolves its internal workspace packages', () => {
    expect(appName).toBe('@sport-performance/api');
    expect(workspaceDependencies).toEqual([
      '@sport-performance/contracts',
      '@sport-performance/domain',
    ]);
  });
});
