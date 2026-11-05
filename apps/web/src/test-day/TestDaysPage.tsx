import type { TestSession } from '@sport-performance/contracts';
import { addDays, localDateInTimeZone } from '@sport-performance/domain';
import { formatLocalDateLong } from '@sport-performance/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useScope } from '../club/use-scope';
import { useT } from '../i18n/i18n';
import { RequirePermission } from '../permissions/permissions';
import { Button, Card, EmptyState, ErrorNotice, Loading, Page } from '../ui/components';
import { TestDayStatus, useWindowLabels } from './parts';
import { testDaysQuery } from './queries';
import './test-day.css';

/**
 * Test days of what the user sees (B-405): today and the next ones, and the
 * previous ones, of the sport and category picked in the layout. Each opens
 * the sheet of the day. Scheduling days is the calendar's (B-406).
 */
export function TestDaysPage() {
  const t = useT();
  return (
    <Page title={t('testDay.list.title')} subtitle={t('testDay.list.subtitle')}>
      <RequirePermission kind="test_session" action="read">
        <TestDaysSection when="upcoming" />
        <TestDaysSection when="past" />
      </RequirePermission>
    </Page>
  );
}

function TestDaysSection(props: { when: 'upcoming' | 'past' }) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const scope = useScope();
  // The club's day when the list opened (a list left open past midnight keeps its split).
  const [today] = useState(() => localDateInTimeZone(Date.now(), active.club.timeZone));
  const query = useInfiniteQuery(
    testDaysQuery(
      api,
      active.selection,
      { sport: scope.sport, categoryId: scope.category?.id ?? null },
      props.when,
      today,
      addDays(today, -1),
    ),
  );
  const windows = useWindowLabels();
  const days = query.data?.pages.flatMap((page) => page.items) ?? [];
  const categoryName = (session: TestSession) =>
    session.categoryId === null
      ? t('testDay.list.historical')
      : (active.categories.find((c) => c.id === session.categoryId)?.name ?? '—');

  return (
    <Card
      variant="flush"
      title={t(props.when === 'upcoming' ? 'testDay.list.upcoming' : 'testDay.list.past')}
    >
      {query.isPending ? <Loading /> : null}
      {query.error === null ? null : <ErrorNotice error={query.error} />}
      {query.isSuccess && days.length === 0 ? (
        <EmptyState
          icon="stopwatch"
          title={t(
            props.when === 'upcoming' ? 'testDay.list.emptyUpcoming' : 'testDay.list.emptyPast',
          )}
        />
      ) : null}
      {days.length === 0 ? null : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th scope="col">{t('testDay.list.date')}</th>
                <th scope="col">{t('testDay.list.category')}</th>
                <th scope="col">{t('testDay.list.window')}</th>
                <th scope="col">{t('testDay.list.location')}</th>
                <th scope="col">{t('testDay.list.status')}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((session) => (
                <tr key={session.id}>
                  <th scope="row" className="sp-td-date">
                    <Link to="/test-days/$testSessionId" params={{ testSessionId: session.id }}>
                      {formatLocalDateLong(session.scheduledOn)}
                    </Link>
                  </th>
                  <td>{categoryName(session)}</td>
                  <td>
                    {session.testWindowId === null
                      ? t('testDay.window.none')
                      : (windows.get(session.testWindowId) ?? '—')}
                  </td>
                  <td>{session.location ?? '—'}</td>
                  <td>
                    <TestDayStatus status={session.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.hasNextPage ? (
        <div className="sp-card__footer">
          <Button
            variant="secondary"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('testDay.list.more')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
