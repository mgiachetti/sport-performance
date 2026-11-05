import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
 * 64rem the sidebar becomes a drawer opened from the top bar: opening it
 * moves the focus into it and makes the page behind inert; Escape, the
 * backdrop and its close button return the focus to the menu button.
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
  // Open on the page it was opened on: following a link closes it (the focus goes with the new
  // page). Escape, the backdrop and the close button close it and give the focus back.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const drawerOpen = openOn === pathname;
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const closeDrawer = useCallback(() => {
    setOpenOn(null);
    // Out of inert first: an inert element cannot take the focus.
    content.current?.removeAttribute('inert');
    menuButton.current?.focus();
  }, [setOpenOn]);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    closeButton.current?.focus();
    // The page behind leaves the tab order and the accessibility tree while the drawer is open.
    content.current?.setAttribute('inert', '');
    const onKey = (event: KeyboardEvent) => {
      // An open menu inside the drawer (the user menu) takes its own Escape first.
      if (event.key === 'Escape' && !event.defaultPrevented) closeDrawer();
    };
    // A wide screen shows the sidebar in place: the drawer and its inert page do not apply.
    const wide = typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY) : null;
    const onWide = () => {
      if (wide?.matches === true) setOpenOn(null);
    };
    document.addEventListener('keydown', onKey);
    wide?.addEventListener('change', onWide);
    const page = content.current;
    return () => {
      page?.removeAttribute('inert');
      document.removeEventListener('keydown', onKey);
      wide?.removeEventListener('change', onWide);
    };
  }, [drawerOpen, closeDrawer]);

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
            ref={closeButton}
            aria-label={t('nav.close')}
            onClick={closeDrawer}
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
        onClick={closeDrawer}
      />
      <div ref={content} className="sp-shell__content">
        {active.selection.kind === 'support' ? (
          <SupportBanner clubName={active.club.name} reason={active.selection.reason} />
        ) : null}
        <header className="sp-topbar">
          <button
            type="button"
            ref={menuButton}
            className="sp-icon-button sp-topbar__menu"
            aria-label={t('nav.open')}
            aria-expanded={drawerOpen}
            aria-controls={drawerId}
            onClick={() => {
              setOpenOn(pathname);
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

/** Where the sidebar stops being a drawer (the `64rem` media query of app.css). */
const WIDE_QUERY = '(min-width: 64.0625rem)';

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
