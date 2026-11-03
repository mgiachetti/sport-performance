import type { Category } from '@sport-performance/contracts';
import type { ActionOf, PermissionSubject, ResourceKind } from '@sport-performance/domain';
import type { MessageKey } from '@sport-performance/i18n';
import type { LinkProps } from '@tanstack/react-router';
import { canSomewhere } from '../permissions/permissions';
import type { IconName } from '../ui/icons';

/**
 * Sections of the side navigation, in order. Each one declares the
 * permission (resource × action of the domain matrix, ADR 0025) that makes
 * it visible: a role that cannot do it anywhere it sees does not get the
 * entry (and the screen still checks the concrete category or player).
 *
 * Screens (#66–#78) add their entry here together with their route.
 */
export interface NavItem<K extends ResourceKind = ResourceKind> {
  readonly to: NonNullable<LinkProps['to']>;
  readonly labelKey: MessageKey;
  readonly icon: IconName;
  readonly permission?: { readonly kind: K; readonly action: ActionOf<K> };
}

/** Typed constructor: the action must be one of the resource's. */
export function navItem<K extends ResourceKind>(item: NavItem<K>): NavItem {
  return item;
}

export const NAV_ITEMS: readonly NavItem[] = [
  navItem({ to: '/', labelKey: 'nav.home', icon: 'home' }),
  // Staff only: the panel needs `load_metrics`, `wellness` and `alert` (the API checks all three).
  navItem({
    to: '/panel',
    labelKey: 'panel.nav',
    icon: 'panel',
    permission: { kind: 'alert', action: 'read' },
  }),
  // The roster and the profiles (B-404): staff who see categories; each block checks the player.
  navItem({
    to: '/players',
    labelKey: 'nav.players',
    icon: 'players',
    permission: { kind: 'category', action: 'read' },
  }),
  navItem({
    to: '/sessions',
    labelKey: 'training.nav',
    icon: 'calendar',
    permission: { kind: 'training_session', action: 'read' },
  }),
  navItem({
    to: '/field-sessions',
    labelKey: 'fieldSession.nav',
    icon: 'field',
    permission: { kind: 'training_session', action: 'read' },
  }),
  navItem({
    to: '/calendar',
    labelKey: 'calendar.nav',
    icon: 'calendar',
    permission: { kind: 'season', action: 'read' },
  }),
];

/** Entries the subject may open somewhere in what it sees. */
export function visibleNavItems(
  items: readonly NavItem[],
  subject: PermissionSubject,
  categories: readonly Pick<Category, 'id' | 'sport'>[],
): NavItem[] {
  return items.filter(
    (item) =>
      item.permission === undefined ||
      canSomewhere(subject, item.permission.kind, item.permission.action, categories),
  );
}
