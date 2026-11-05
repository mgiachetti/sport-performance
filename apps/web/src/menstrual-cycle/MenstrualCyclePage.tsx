import type { ApiClient, MenstrualCycleDays } from '@sport-performance/contracts';
import type { PlayerId } from '@sport-performance/domain';
import { formatDate, formatLocalDate } from '@sport-performance/i18n';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ClubSelection } from '../api/club-selection';
import { clubQueryKey } from '../api/queries';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { clubModulesQuery } from '../field-sessions/queries';
import { useT } from '../i18n/i18n';
import { Button, Card, EmptyState, ErrorNotice, Loading, Notice, Page } from '../ui/components';
import { Icon } from '../ui/icons';

/**
 * "Ciclo menstrual compartido con vos" (B-806, ADR 0092): the medical or S&C
 * member a player authorized reads her days, as a table (never a chart of
 * color alone). Nothing is kept: the queries are dropped as soon as the page
 * is left (`gcTime: 0`), and every read is in the medical log. Never shown to
 * the coach, the administration or the guardian (the navigation hides it and
 * the API answers `403`); a member nobody authorized sees an empty list.
 */

export function cycleKey(selection: ClubSelection | null, ...parts: readonly unknown[]) {
  return clubQueryKey(selection, 'menstrual-cycle', ...parts);
}

export function sharedWithMeQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: cycleKey(selection, 'shared-with-me'),
    queryFn: ({ signal }) => api.listMenstrualCycleSharedWithMe(undefined, { signal }),
    gcTime: 0,
  });
}

export function cycleDaysQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  playerId: PlayerId,
) {
  return queryOptions({
    queryKey: cycleKey(selection, 'days', playerId),
    queryFn: ({ signal }) =>
      api.getMenstrualCycleDays({ params: { playerId }, query: {} }, { signal }),
    gcTime: 0,
  });
}

function DaysTable({ days }: { readonly days: MenstrualCycleDays }) {
  const t = useT();
  if (days.days.length === 0) {
    return (
      <EmptyState icon="calendar" title={t('cycle.shared.daysTitle')}>
        <p>{t('cycle.shared.noDays')}</p>
      </EmptyState>
    );
  }
  const { summary } = days;
  return (
    <>
      <dl className="sp-facts">
        {summary.cycleDay === null || summary.lastPeriodStart === null ? (
          <div>
            <dt>{t('cycle.summary.title')}</dt>
            <dd>{t('cycle.shared.noPeriod')}</dd>
          </div>
        ) : (
          <div>
            <dt>{t('cycle.shared.cycleDay', { day: summary.cycleDay })}</dt>
            <dd>
              {t('cycle.summary.lastStart', { date: formatLocalDate(summary.lastPeriodStart) })}
            </dd>
          </div>
        )}
        {summary.cycleLengthsDays.length === 0 ? null : (
          <div>
            <dt>{t('cycle.shared.lengths')}</dt>
            <dd>
              {t('cycle.summary.lengths', {
                count: summary.cycleLengthsDays.length,
                lengths: summary.cycleLengthsDays.join(', '),
              })}
            </dd>
          </div>
        )}
      </dl>
      <p className="sp-notice__meta">{t('cycle.notMedical')}</p>
      <div className="sp-table-wrap">
        <table className="sp-table">
          <caption className="sp-cycle__caption">{t('cycle.shared.daysTitle')}</caption>
          <thead>
            <tr>
              <th scope="col" className="sp-cycle__date">
                {t('cycle.shared.column.date')}
              </th>
              <th scope="col">{t('cycle.shared.column.flow')}</th>
              <th scope="col">{t('cycle.shared.column.symptoms')}</th>
              <th scope="col">{t('cycle.shared.column.note')}</th>
            </tr>
          </thead>
          <tbody>
            {[...days.days].reverse().map((day) => (
              <tr key={day.id}>
                <td className="sp-table__number sp-cycle__date">
                  {formatLocalDate(day.localDate)}
                </td>
                <td>{t(`cycle.flow.${day.flow}`)}</td>
                <td>{day.symptoms.map((s) => t(`cycle.symptom.${s}`)).join(', ') || '—'}</td>
                <td>{day.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PlayerDays({
  playerId,
  name,
  onBack,
}: {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly onBack: () => void;
}) {
  const t = useT();
  const { api, selection } = useServices();
  const days = useQuery(cycleDaysQuery(api, selection.get(), playerId));
  return (
    <Card
      title={name}
      actions={
        <Button variant="secondary" size="sm" onClick={onBack}>
          <Icon name="chevronLeft" />
          <span>{t('cycle.shared.back')}</span>
        </Button>
      }
    >
      {days.isPending ? (
        <Loading />
      ) : days.error !== null ? (
        <ErrorNotice error={days.error} />
      ) : (
        // An empty answer is the same whether she logged nothing or the read was cut (ADR 0092).
        <DaysTable days={days.data} />
      )}
    </Card>
  );
}

export function MenstrualCyclePage() {
  const t = useT();
  const { api, selection } = useServices();
  const active = useActiveClub();
  const modules = useQuery(clubModulesQuery(api, active.selection));
  const shared = useQuery(sharedWithMeQuery(api, selection.get()));
  const [open, setOpen] = useState<{ id: PlayerId; name: string } | null>(null);
  const moduleOff = modules.data?.modules.menstrual_cycle === false;
  const noneShared = shared.data?.items.length === 0;

  return (
    <Page title={t('cycle.shared.title')} subtitle={t('cycle.shared.intro')}>
      {/* With the module off and nobody sharing, the empty state says it alone. */}
      {moduleOff && !noneShared ? (
        <Notice level="info">
          <p>{t('cycle.unavailable.module_off')}</p>
        </Notice>
      ) : null}
      {open !== null ? (
        <PlayerDays
          playerId={open.id}
          name={open.name}
          onBack={() => {
            setOpen(null);
          }}
        />
      ) : shared.isPending ? (
        <Loading />
      ) : shared.error !== null ? (
        <ErrorNotice error={shared.error} />
      ) : shared.data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon="calendar"
            title={moduleOff ? t('cycle.unavailable.module_off') : t('cycle.shared.none')}
          />
        </Card>
      ) : (
        <Card>
          <ul className="sp-plain-list sp-cycle__list">
            {shared.data.items.map((item) => {
              const name = `${item.lastName}, ${item.firstName}`;
              return (
                <li key={item.playerId}>
                  <span className="sp-cycle__who">
                    <span className="sp-cycle__name">{name}</span>
                    <span className="sp-meta">
                      {t('cycle.shared.since', {
                        date: formatDate(new Date(item.authorizedAt), {
                          timeZone: active.club.timeZone,
                        }),
                      })}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setOpen({ id: item.playerId, name });
                    }}
                  >
                    {t('cycle.shared.open', { name })}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </Page>
  );
}
