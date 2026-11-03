import { DEFAULT_CLUB_TIME_ZONE, isUuid, type ClubId } from '@sport-performance/domain';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';
import { useT } from '../i18n/i18n';
import {
  PeriodFilterForm,
  SupportAccessLog,
  type PeriodFilter,
} from '../support-access/SupportAccessLog';
import { Page } from '../ui/components';
import { useConsole } from './ConsoleLayout';
import { consoleSupportAccessQuery } from './queries';

/** `?clubId=` of the console's support access log: one club, or every one. */
export function parseSupportAccessSearch(search: Record<string, unknown>): { clubId?: ClubId } {
  return isUuid(search.clubId) ? { clubId: search.clubId as ClubId } : {};
}

const route = getRouteApi('/_authed/console/support-access');

/**
 * The whole support access log (B-414, ADR 0066): every request of every
 * superadmin, in the clubs and on the registry, newest first. Days are
 * picked in the product's default zone; each entry shows its club's time.
 */
export function ConsoleSupportAccessPage() {
  const t = useT();
  const { api, reason } = useConsole();
  const search = route.useSearch();
  const [period, setPeriod] = useState<PeriodFilter>({});
  const query = useInfiniteQuery(
    consoleSupportAccessQuery(api, reason, { clubId: search.clubId, ...period }),
  );
  const clubName = query.data?.pages
    .flatMap((page) => page.items)
    .find((entry) => entry.club?.id === search.clubId)?.club?.name;

  return (
    <Page title={t('supportAccess.title')} subtitle={t('supportAccess.subtitle.console')}>
      {search.clubId === undefined ? null : (
        <p className="sp-filters__active">
          {clubName === undefined ? null : (
            <span>{t('supportAccess.filter.club', { clubName })}</span>
          )}
          <Link to="/console/support-access" search={{}}>
            {t('supportAccess.filter.allClubs')}
          </Link>
        </p>
      )}
      <PeriodFilterForm timeZone={DEFAULT_CLUB_TIME_ZONE} onApply={setPeriod} />
      <SupportAccessLog
        query={query}
        showClub={search.clubId === undefined}
        timeZone={DEFAULT_CLUB_TIME_ZONE}
      />
    </Page>
  );
}
