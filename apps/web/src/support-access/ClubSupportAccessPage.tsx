import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { clubQueryKey } from '../api/queries';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { RequirePermission } from '../permissions/permissions';
import { Page } from '../ui/components';
import { PeriodFilterForm, SupportAccessLog, type PeriodFilter } from './SupportAccessLog';

const PAGE_SIZE = 25;

/**
 * Support accesses to the active club (B-414, ADR 0066), for its
 * administration: who of the platform's support entered, when and why.
 */
export function ClubSupportAccessPage() {
  const t = useT();
  const active = useActiveClub();
  return (
    <Page
      title={t('supportAccess.title')}
      subtitle={t('supportAccess.subtitle.club', { clubName: active.club.name })}
    >
      <RequirePermission kind="support_access" action="read">
        <ClubSupportAccess />
      </RequirePermission>
    </Page>
  );
}

function ClubSupportAccess() {
  const { api } = useServices();
  const active = useActiveClub();
  const [period, setPeriod] = useState<PeriodFilter>({});
  const query = useInfiniteQuery({
    queryKey: clubQueryKey(active.selection, 'supportAccess', period),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api.listClubSupportAccess(
        {
          query: {
            limit: PAGE_SIZE,
            ...(period.from === undefined ? {} : { from: period.from }),
            ...(period.to === undefined ? {} : { to: period.to }),
            ...(pageParam === undefined ? {} : { cursor: pageParam }),
          },
        },
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    // Always fresh: a supporting superadmin's own reads are entries too.
    staleTime: 0,
  });
  return (
    <>
      <PeriodFilterForm timeZone={active.club.timeZone} onApply={setPeriod} />
      <SupportAccessLog query={query} showClub={false} timeZone={active.club.timeZone} />
    </>
  );
}
