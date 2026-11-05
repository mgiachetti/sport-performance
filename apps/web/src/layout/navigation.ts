import type { Category } from '@sport-performance/contracts';
import type { ActionOf, PermissionSubject, ResourceKind } from '@sport-performance/domain';
import type { MessageKey } from '@sport-performance/i18n';
import type { LinkProps } from '@tanstack/react-router';
import { canOnCategoryPlayers, canSomewhere } from '../permissions/permissions';
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
  readonly permission?: {
    readonly kind: K;
    readonly action: ActionOf<K>;
    /**
     * A player resource checked on the players of the visible categories
     * (`canOnCategoryPlayers`): squad screens like anthropometry.
     */
    readonly onCategoryPlayers?: true;
  };
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
    icon: 'clipboard',
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
  navItem({
    to: '/test-days',
    labelKey: 'testDay.nav',
    icon: 'stopwatch',
    permission: { kind: 'test_session', action: 'read' },
  }),
  // Gym programs and sets (B-607): staff who read the programs of a category.
  navItem({
    to: '/gym',
    labelKey: 'nav.gym',
    icon: 'dumbbell',
    permission: { kind: 'gym_program', action: 'read' },
  }),
  // Menstrual cycle shared with the member (B-806): only the medical and S&C staff; each
  // player decides who of them sees hers (the page lists only those).
  navItem({
    to: '/menstrual-cycle',
    labelKey: 'nav.cycle',
    icon: 'cycle',
    permission: { kind: 'menstrual_cycle', action: 'read' },
  }),
  navItem({
    to: '/anthropometry',
    labelKey: 'anthropometry.nav',
    icon: 'ruler',
    permission: { kind: 'anthropometry', action: 'read', onCategoryPlayers: true },
  }),
  navItem({
    to: '/configuration',
    labelKey: 'configuration.nav',
    icon: 'settings',
    permission: { kind: 'configuration', action: 'read' },
  }),
  navItem({
    to: '/admin',
    labelKey: 'admin.nav',
    icon: 'club',
    permission: { kind: 'membership', action: 'read' },
  }),
  navItem({
    to: '/support-access',
    labelKey: 'supportAccess.nav',
    icon: 'support',
    permission: { kind: 'support_access', action: 'read' },
  }),
  // Usage metrics of the club (B-707): the administration.
  navItem({
    to: '/usage',
    labelKey: 'usage.nav',
    icon: 'activity',
    permission: { kind: 'usage_metrics', action: 'read' },
  }),
  navItem({
    to: '/help',
    labelKey: 'nav.help',
    icon: 'help',
    permission: { kind: 'metric_catalog', action: 'read' },
  }),
];

/**
 * Navigation of the family area (ADR 0065): a guardian's own sections. Their
 * permissions are about one child (`player` targets), so each screen checks
 * the concrete child; the entry itself is the guardian's home.
 */
export const GUARDIAN_NAV_ITEMS: readonly NavItem[] = [
  navItem({ to: '/family', labelKey: 'guardian.nav.children', icon: 'family' }),
];

/** Entries the subject may open somewhere in what it sees. */
export function visibleNavItems(
  items: readonly NavItem[],
  subject: PermissionSubject,
  categories: readonly Pick<Category, 'id' | 'sport'>[],
): NavItem[] {
  return items.filter((item) => {
    const permission = item.permission;
    if (permission === undefined) return true;
    return permission.onCategoryPlayers === true
      ? canOnCategoryPlayers(subject, permission.kind, permission.action, categories)
      : canSomewhere(subject, permission.kind, permission.action, categories);
  });
}
