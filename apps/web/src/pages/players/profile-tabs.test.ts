import { describe, expect, it } from 'vitest';
import { currentProfileTab, parsePlayerProfileSearch } from './profile-tabs';

describe('profile tabs (ADR 0104)', () => {
  it('takes the URL, then the remembered tab, then the first the role may see', () => {
    const all = ['load', 'evolution', 'percentiles', 'gym'] as const;
    expect(currentProfileTab(all, 'gym', 'evolution')).toBe('gym');
    expect(currentProfileTab(all, undefined, 'evolution')).toBe('evolution');
    expect(currentProfileTab(all, undefined, undefined)).toBe('load');
    expect(currentProfileTab(['evolution', 'gym'], 'load', 'percentiles')).toBe('evolution');
    expect(currentProfileTab([], 'load', 'load')).toBeNull();
  });

  it('drops a malformed tab from the URL', () => {
    expect(parsePlayerProfileSearch({ tab: 'gym' })).toEqual({ tab: 'gym' });
    expect(parsePlayerProfileSearch({ tab: 'medical' })).toEqual({});
  });
});
