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

/** The club a standalone screen belongs to, when it is known (its crest and name). */
export interface StandaloneClub {
  readonly name: string;
  readonly shortName: string;
  readonly logoUrl: string | null;
}

/**
 * Frame of the screens outside a club (sign-in, club selector, support,
 * errors), like the shell (ADR 0097): on a wide screen a brand panel with the
 * jersey stripes on the left and the content on the right; on a narrow one
 * the stripes on top, the brand and the content below. With a known club it
 * carries its crest and name; otherwise the product's neutral mark (the
 * colors stay the default brand until a club is picked, ADR 0014).
 */
export function StandaloneLayout(props: {
  children: ReactNode;
  club?: StandaloneClub | undefined;
  /** `wide`: a panel for lists and tables (support, the club selector with many clubs). */
  width?: 'narrow' | 'wide';
}) {
  const t = useT();
  const club = props.club;
  return (
    <div className="sp-standalone">
      <aside className="sp-standalone__aside" aria-label={t('standalone.brand')}>
        <Stripes variant="rail" />
        <div className="sp-standalone__identity">
          {club === undefined ? (
            <span
              className="sp-club-mark sp-club-mark--monogram sp-standalone__mark"
              aria-hidden="true"
            >
              {t('standalone.productMark')}
            </span>
          ) : club.logoUrl === null ? (
            <span
              className="sp-club-mark sp-club-mark--monogram sp-standalone__mark"
              aria-hidden="true"
            >
              {club.shortName}
            </span>
          ) : (
            <img
              className="sp-club-mark sp-standalone__mark"
              src={club.logoUrl}
              alt={t('club.logoAlt', { clubName: club.name })}
              width={64}
              height={64}
            />
          )}
          <div className="sp-standalone__names">
            <p className="sp-standalone__app">
              {club === undefined
                ? t('app.name')
                : t('layout.clubApp', { shortName: club.shortName })}
            </p>
            {club === undefined ? null : <p className="sp-standalone__club">{club.name}</p>}
          </div>
        </div>
        <p className="sp-standalone__tagline">{t('standalone.tagline')}</p>
        <ul className="sp-standalone__points">
          <li>{t('standalone.point.metrics')}</li>
          <li>{t('standalone.point.load')}</li>
          <li>{t('standalone.point.privacy')}</li>
        </ul>
        <Stripes size="lg" />
      </aside>
      <main id="main" className="sp-standalone__main">
        <div
          className={`sp-standalone__panel${props.width === 'wide' ? ' sp-standalone__panel--wide' : ''}`}
        >
          {props.children}
        </div>
      </main>
    </div>
  );
}
