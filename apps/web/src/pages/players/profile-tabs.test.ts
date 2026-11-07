import { describe, expect, it } from 'vitest';
import {
  alertSeverityByTab,
  currentProfileTab,
  parsePlayerProfileSearch,
  tabOfAlert,
  visibleProfileTabs,
} from './profile-tabs';

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

  it('shows a bar only for two blocks or more', () => {
    const none = { load: false, evolution: false, percentiles: false, gym: false };
    expect(visibleProfileTabs(none)).toEqual({ tabs: [], bar: false });
    expect(visibleProfileTabs({ ...none, evolution: true })).toEqual({
      tabs: ['evolution'],
      bar: false,
    });
    expect(visibleProfileTabs({ ...none, load: true, gym: true })).toEqual({
      tabs: ['load', 'gym'],
      bar: true,
    });
  });

  it('badges each tab with the worst open alert whose data it holds', () => {
    expect(tabOfAlert('wellness_low')).toBe('load');
    expect(tabOfAlert('cmj_drop')).toBe('evolution');
    expect(tabOfAlert('growth_peak')).toBeUndefined();
    expect(
      alertSeverityByTab([
        { kind: 'wellness_low', severity: 'warning', resolvedOn: null },
        { kind: 'acwr_high', severity: 'critical', resolvedOn: null },
        { kind: 'wellness_zscore_low', severity: 'warning', resolvedOn: null },
        { kind: 'cmj_drop', severity: 'warning', resolvedOn: '2026-11-01' },
        { kind: 'growth_peak', severity: 'warning', resolvedOn: null },
      ]),
    ).toEqual({ load: 'critical' });
  });
});
