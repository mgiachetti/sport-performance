import { describe, expect, it } from 'vitest';
import { appName, workspaceDependencies } from './index';

describe('mobile', () => {
  it('resolves its internal workspace packages', () => {
    expect(appName).toBe('@sport-performance/mobile');
    expect(workspaceDependencies).toEqual([
      '@sport-performance/contracts',
      '@sport-performance/domain',
      '@sport-performance/i18n',
      '@sport-performance/ui-tokens',
    ]);
  });
});
