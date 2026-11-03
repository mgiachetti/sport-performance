import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { membershipsQuery } from '../api/queries';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { useSignOut } from '../session/use-sign-out';
import { ConnectionStatus } from '../status/ConnectionStatus';
import { Button, ErrorNotice, Notice, Stripes } from '../ui/components';
import { Icon } from '../ui/icons';
import { NAV_ITEMS, visibleNavItems, type NavItem } from './navigation';
import { ScopeSelector } from './ScopeSelector';
import { ThemeSwitcher } from './ThemeSwitcher';

/**
 * Shell of the club (maqueta: sidebar + content): club identity and jersey
 * stripes, navigation gated by the permission matrix, connection status and
 * user in the sidebar; scope, theme and account in the top bar; the
 * support-mode banner whenever a superadmin is acting in a club.
 */
export function AppShell(props: {
  navItems?: readonly NavItem[];
  /** The sport/category selector; off in the family area (ADR 0065). */
  showScope?: boolean;
  scopeIgnored?: boolean;
  onDismissScopeIgnored?: () => void;
}) {
  const t = useT();
  const active = useActiveClub();
  const items = visibleNavItems(props.navItems ?? NAV_ITEMS, active.subject, active.categories);
  const roleLabel = t(`role.${active.role}`);

  return (
    <div className="sp-shell">
      <a className="sp-skip-link" href="#main">
        {t('layout.skipToContent')}
      </a>
      <aside className="sp-sidebar">
        <div className="sp-sidebar__club">
          {active.theme.logoUrl === null ? (
            <span className="sp-sidebar__monogram" aria-hidden="true">
              {active.theme.shortName}
            </span>
          ) : (
            <img
              className="sp-sidebar__logo"
              src={active.theme.logoUrl}
              alt={t('club.logoAlt', { clubName: active.club.name })}
              width={40}
              height={40}
            />
          )}
          <div>
            <p className="sp-sidebar__club-name">{active.club.name}</p>
            <p className="sp-sidebar__app-name">{t('app.name')}</p>
          </div>
        </div>
        <Stripes size="sm" />
        <nav aria-label={t('nav.label')} className="sp-nav">
          <ul>
            {items.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="sp-nav__link"
                  activeOptions={{ exact: item.to === '/', includeSearch: false }}
                  activeProps={{ 'aria-current': 'page', className: 'is-active' }}
                >
                  <Icon name={item.icon} size={20} />
                  <span>{t(item.labelKey)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sp-sidebar__foot">
          <ConnectionStatus timeZone={active.club.timeZone} />
          <p className="sp-sidebar__user">
            {active.user.name === '' ? active.user.email : active.user.name}
            <br />
            {roleLabel}
          </p>
        </div>
      </aside>
      <div className="sp-shell__content">
        {active.selection.kind === 'support' ? (
          <SupportBanner clubName={active.club.name} reason={active.selection.reason} />
        ) : null}
        <header className="sp-topbar">
          {props.showScope === false ? null : <ScopeSelector />}
          <div className="sp-topbar__actions">
            <ThemeSwitcher />
            <AccountActions />
          </div>
        </header>
        {props.scopeIgnored === true ? (
          <div className="sp-banner">
            <Notice
              level="info"
              role="status"
              action={
                <Button variant="ghost" onClick={props.onDismissScopeIgnored}>
                  {t('common.close')}
                </Button>
              }
            >
              <p>{t('scope.ignored')}</p>
            </Notice>
          </div>
        ) : null}
        <main id="main" tabIndex={-1} className="sp-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SupportBanner(props: { clubName: string; reason: string }) {
  const t = useT();
  const { queryClient, selection } = useServices();
  const navigate = useNavigate();
  const exit = async () => {
    selection.clearSupport();
    queryClient.removeQueries({ queryKey: ['club'] });
    await navigate({ to: '/clubs' });
  };
  return (
    <div className="sp-banner sp-banner--support">
      <Notice
        level="warning"
        role="status"
        action={
          <Button variant="secondary" onClick={() => void exit()}>
            {t('support.exit')}
          </Button>
        }
      >
        <p>{t('support.banner', { clubName: props.clubName, reason: props.reason })}</p>
      </Notice>
    </div>
  );
}

function AccountActions() {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const signOut = useSignOut();
  const memberships = useQuery(membershipsQuery(api));
  const canSwitch = active.user.isSuperadmin || (memberships.data?.items.length ?? 0) > 1;
  return (
    <div className="sp-account" role="group" aria-label={t('account.menu')}>
      {canSwitch ? (
        <Link to="/clubs" className="sp-button sp-button--ghost">
          <Icon name="club" />
          <span>{t('club.switch')}</span>
        </Link>
      ) : null}
      <Button
        variant="ghost"
        onClick={() => {
          signOut.mutate();
        }}
        disabled={signOut.isPending}
      >
        <Icon name="signOut" />
        <span>{t('auth.signOut')}</span>
      </Button>
      {signOut.isError ? <ErrorNotice error={signOut.error} /> : null}
    </div>
  );
}
