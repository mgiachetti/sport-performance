import {
  can,
  type ActionOf,
  type PermissionSubject,
  type ResourceKind,
} from '@sport-performance/domain';
import type { MessageKey } from '@sport-performance/i18n';
import { Link, Navigate, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Notice, Page } from '../ui/components';
import { useActiveTabInView } from '../ui/use-active-tab';
import './admin.css';

type AdminPath =
  | '/admin/members'
  | '/admin/invitations'
  | '/admin/assignments'
  | '/admin/club'
  | '/admin/categories'
  | '/admin/seasons'
  | '/admin/roster'
  | '/admin/pods';

interface AdminTab {
  readonly to: AdminPath;
  readonly labelKey: MessageKey;
  /** Every permission the section needs, checked on the whole club (ADR 0025). */
  readonly permissions: readonly ((subject: PermissionSubject) => boolean)[];
}

/**
 * A permission on the club as a whole: no category or player (the
 * administration's scope). A coach who imports Catapult data into their
 * category does not get the roster import.
 */
function permission<K extends ResourceKind>(kind: K, action: ActionOf<K>) {
  return (subject: PermissionSubject) => can(subject, action, { kind, clubId: subject.clubId });
}

/** Sections of the administration, in order, each with what it needs. */
export const ADMIN_TABS: readonly AdminTab[] = [
  {
    to: '/admin/members',
    labelKey: 'admin.tab.members',
    permissions: [permission('membership', 'read')],
  },
  {
    to: '/admin/invitations',
    labelKey: 'admin.tab.invitations',
    permissions: [permission('membership', 'invite')],
  },
  {
    to: '/admin/assignments',
    labelKey: 'admin.tab.assignments',
    permissions: [permission('staff_assignment', 'manage')],
  },
  { to: '/admin/club', labelKey: 'admin.tab.club', permissions: [permission('club', 'update')] },
  {
    to: '/admin/categories',
    labelKey: 'admin.tab.categories',
    permissions: [permission('category', 'manage')],
  },
  {
    to: '/admin/seasons',
    labelKey: 'admin.tab.seasons',
    permissions: [permission('season', 'manage'), permission('category', 'manage')],
  },
  {
    to: '/admin/roster',
    labelKey: 'admin.tab.roster',
    permissions: [permission('data_import', 'run'), permission('player_profile', 'create')],
  },
  // The pod fleet (B-912, ADR 0106): S&C and the administration.
  { to: '/admin/pods', labelKey: 'admin.tab.pods', permissions: [permission('pod', 'manage')] },
];

/** The sections whose every permission the subject holds. */
export function adminTabsFor(subject: PermissionSubject): readonly AdminTab[] {
  return ADMIN_TABS.filter((tab) => tab.permissions.every((allowed) => allowed(subject)));
}

export function useAdminTabs(): readonly AdminTab[] {
  return adminTabsFor(useActiveClub().subject);
}

/** Frame of the administration (B-411): title, its sections as tabs, and the open section. */
export function AdminLayout() {
  const t = useT();
  const { club } = useActiveClub();
  const tabs = useAdminTabs();
  const tabsRef = useActiveTabInView<HTMLElement>();
  return (
    <Page title={t('admin.title')} subtitle={t('admin.subtitle', { clubName: club.name })}>
      {tabs.length === 0 ? (
        <Notice level="warning" role="alert">
          <p>{t('error.forbidden')}</p>
        </Notice>
      ) : (
        <>
          <nav ref={tabsRef} className="sp-tabs" aria-label={t('admin.tabs.label')}>
            <ul>
              {tabs.map((tab) => (
                <li key={tab.to}>
                  <Link
                    to={tab.to}
                    className="sp-tabs__link"
                    activeProps={{ 'aria-current': 'page', className: 'is-active' }}
                  >
                    {t(tab.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <Outlet />
        </>
      )}
    </Page>
  );
}

/** `/admin`: the first section the subject may open. */
export function AdminIndex() {
  const tabs = useAdminTabs();
  const first = tabs[0];
  if (first === undefined) return null;
  return <Navigate to={first.to} replace />;
}

/** Guard of one section: its content, or "No tenés permiso". */
export function AdminGuard(props: { to: AdminPath; children: ReactNode }) {
  const t = useT();
  const tabs = useAdminTabs();
  if (!tabs.some((tab) => tab.to === props.to)) {
    return (
      <Notice level="warning" role="alert">
        <p>{t('error.forbidden')}</p>
      </Notice>
    );
  }
  return <>{props.children}</>;
}
