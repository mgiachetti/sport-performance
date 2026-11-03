import { Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useT } from '../i18n/i18n';
import { WebUpdateBanner } from '../status/WebUpdateBanner';
import { Stripes } from '../ui/components';

/** Root of every route: the stale-tab banner above whatever the route renders. */
export function RootLayout() {
  return (
    <>
      <WebUpdateBanner />
      <Outlet />
    </>
  );
}

/**
 * Frame of the screens outside a club (sign-in, club selector, support):
 * one centred panel with the jersey stripes. The brand is the default (ORC)
 * until a club is picked.
 */
export function StandaloneLayout(props: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="sp-standalone">
      <Stripes size="md" />
      <main id="main" className="sp-standalone__main">
        <p className="sp-standalone__brand">{t('app.name')}</p>
        <div className="sp-standalone__panel">{props.children}</div>
      </main>
    </div>
  );
}
