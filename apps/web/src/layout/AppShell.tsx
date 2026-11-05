import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { ConnectionStatus } from '../status/ConnectionStatus';
import { Button, Notice, Stripes } from '../ui/components';
import { Icon } from '../ui/icons';
import { NAV_ITEMS, visibleNavItems, type NavItem } from './navigation';
import { ScopeSelector } from './ScopeSelector';
import { UserMenu } from './UserMenu';

/**
 * Shell of the club (maqueta, ADR 0097): the sidebar carries the club's crest
 * and name with the jersey stripes, the navigation gated by the permission
 * matrix and, in its footer, the connection status and the user menu (theme,
 * club switch, sign out). The top bar keeps the sport/category scope. Under
 * 64rem the sidebar becomes a drawer opened from the top bar.
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
  const drawerId = useId();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Open on the page it was opened on: following a link closes it. So does Escape.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const drawerOpen = openOn === pathname;
  const setDrawerOpen = (open: boolean) => {
    setOpenOn(open ? pathname : null);
  };
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenOn(null);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

  return (
    <div className={`sp-shell${drawerOpen ? ' is-drawer-open' : ''}`}>
      <a className="sp-skip-link" href="#main">
        {t('layout.skipToContent')}
      </a>
      <aside id={drawerId} className="sp-sidebar">
        <div className="sp-sidebar__club">
          <Stripes variant="rail" />
          <ClubMark />
          <div className="sp-sidebar__club-text">
            <p className="sp-sidebar__app-name">
              {t('layout.clubApp', { shortName: active.theme.shortName })}
            </p>
            <p className="sp-sidebar__club-name">{active.club.name}</p>
          </div>
          <button
            type="button"
            className="sp-icon-button sp-sidebar__close"
            aria-label={t('nav.close')}
            onClick={() => {
              setDrawerOpen(false);
            }}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
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
          <UserMenu />
        </div>
      </aside>
      <button
        type="button"
        className="sp-shell__backdrop"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => {
          setDrawerOpen(false);
        }}
      />
      <div className="sp-shell__content">
        {active.selection.kind === 'support' ? (
          <SupportBanner clubName={active.club.name} reason={active.selection.reason} />
        ) : null}
        <header className="sp-topbar">
          <button
            type="button"
            className="sp-icon-button sp-topbar__menu"
            aria-label={t('nav.open')}
            aria-expanded={drawerOpen}
            aria-controls={drawerId}
            onClick={() => {
              setDrawerOpen(true);
            }}
          >
            <Icon name="menu" size={22} />
          </button>
          <div className="sp-topbar__club" aria-hidden="true">
            <ClubMark />
            <span>{t('layout.clubApp', { shortName: active.theme.shortName })}</span>
          </div>
          {props.showScope === false ? null : <ScopeSelector />}
        </header>
        {props.scopeIgnored === true ? (
          <div className="sp-banner">
            <Notice
              level="info"
              role="status"
              action={
                <Button variant="ghost" size="sm" onClick={props.onDismissScopeIgnored}>
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

/** The crest served by the API (white-label theme), or the short name as a monogram. */
function ClubMark() {
  const t = useT();
  const active = useActiveClub();
  return active.theme.logoUrl === null ? (
    <span className="sp-club-mark sp-club-mark--monogram" aria-hidden="true">
      {active.theme.shortName}
    </span>
  ) : (
    <img
      className="sp-club-mark"
      src={active.theme.logoUrl}
      alt={t('club.logoAlt', { clubName: active.club.name })}
      width={44}
      height={44}
    />
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
          <Button variant="secondary" size="sm" onClick={() => void exit()}>
            {t('support.exit')}
          </Button>
        }
      >
        <p>{t('support.banner', { clubName: props.clubName, reason: props.reason })}</p>
      </Notice>
    </div>
  );
}
