import { describe, expect, it } from 'vitest';
import { GUARDIAN_NAV_ITEMS, NAV_ITEMS } from './navigation';

describe('side navigation', () => {
  it.each([
    ['staff', NAV_ITEMS],
    ['family', GUARDIAN_NAV_ITEMS],
  ] as const)('gives each %s entry its own icon and route', (_area, items) => {
    const icons = items.map((item) => item.icon);
    expect(new Set(icons).size).toBe(icons.length);
    const routes = items.map((item) => item.to);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('tells training sessions and the calendar apart by their icon', () => {
    const iconOf = (to: string) => NAV_ITEMS.find((item) => item.to === to)?.icon;
    expect(iconOf('/sessions')).toBe('clipboard');
    expect(iconOf('/calendar')).toBe('calendar');
  });
});
