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
 * colors stay the default brand until a club is picked, ADR 0014). The brand
 * panel is decorative (crest, name, tagline), not a landmark.
 */
export function StandaloneLayout(props: {
  children: ReactNode;
  club?: StandaloneClub | undefined;
  /**
   * `compact`: only the crest and the name, without the product tagline and
   * its points (error pages, where the user expects the app, not a pitch).
   */
  variant?: 'full' | 'compact';
}) {
  const t = useT();
  const club = props.club;
  const compact = props.variant === 'compact';
  return (
    <div className={`sp-standalone${compact ? ' sp-standalone--compact' : ''}`}>
      <div className="sp-standalone__aside">
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
        {compact ? null : (
          <>
            <p className="sp-standalone__tagline">{t('standalone.tagline')}</p>
            <ul className="sp-standalone__points">
              <li>{t('standalone.point.metrics')}</li>
              <li>{t('standalone.point.load')}</li>
              <li>{t('standalone.point.privacy')}</li>
            </ul>
          </>
        )}
        <Stripes size="lg" />
      </div>
      <main id="main" className="sp-standalone__main">
        <div className="sp-standalone__panel">{props.children}</div>
      </main>
    </div>
  );
}
