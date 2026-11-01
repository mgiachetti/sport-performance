import { describe, expect, it } from 'vitest';
import { appName, workspaceDependencies } from './index';

describe('web', () => {
  it('resolves its internal workspace packages', () => {
    expect(appName).toBe('@sport-performance/web');
    expect(workspaceDependencies).toEqual([
      '@sport-performance/contracts',
      '@sport-performance/domain',
      '@sport-performance/i18n',
      '@sport-performance/ui-tokens',
    ]);
  });
});
