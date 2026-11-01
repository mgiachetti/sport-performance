import { describe, expect, it } from 'vitest';
import { appName, workspaceDependencies } from './index.js';

describe('worker', () => {
  it('resolves its internal workspace packages', () => {
    expect(appName).toBe('@sport-performance/worker');
    expect(workspaceDependencies).toEqual(['@sport-performance/domain']);
  });
});
