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
import { Button, ErrorNotice, Loading, Notice, Page } from '../ui/components';

/**
 * "Ciclo menstrual compartido con vos" (B-806, ADR 0087): the medical or S&C
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
      <Notice level="info">
        <p>{t('cycle.shared.noDays')}</p>
      </Notice>
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
          <caption>{t('cycle.shared.daysTitle')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('cycle.shared.column.date')}</th>
              <th scope="col">{t('cycle.shared.column.flow')}</th>
              <th scope="col">{t('cycle.shared.column.symptoms')}</th>
              <th scope="col">{t('cycle.shared.column.note')}</th>
            </tr>
          </thead>
          <tbody>
            {[...days.days].reverse().map((day) => (
              <tr key={day.id}>
                <td>{formatLocalDate(day.localDate)}</td>
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
    <section aria-labelledby="cycle-player">
      <h2 id="cycle-player">{name}</h2>
      <Button variant="secondary" onClick={onBack}>
        {t('cycle.shared.back')}
      </Button>
      {days.isPending ? (
        <Loading />
      ) : days.error !== null ? (
        <ErrorNotice error={days.error} />
      ) : (
        // An empty answer is the same whether she logged nothing or the read was cut (ADR 0087).
        <DaysTable days={days.data} />
      )}
    </section>
  );
}

export function MenstrualCyclePage() {
  const t = useT();
  const { api, selection } = useServices();
  const active = useActiveClub();
  const modules = useQuery(clubModulesQuery(api, active.selection));
  const shared = useQuery(sharedWithMeQuery(api, selection.get()));
  const [open, setOpen] = useState<{ id: PlayerId; name: string } | null>(null);

  return (
    <Page title={t('cycle.shared.title')} subtitle={t('cycle.shared.intro')}>
      {modules.data?.modules.menstrual_cycle === false ? (
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
        <Notice level="info">
          <p>{t('cycle.shared.none')}</p>
        </Notice>
      ) : (
        <ul className="sp-list">
          {shared.data.items.map((item) => {
            const name = `${item.lastName}, ${item.firstName}`;
            return (
              <li key={item.playerId}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setOpen({ id: item.playerId, name });
                  }}
                >
                  {t('cycle.shared.open', { name })}
                </Button>
                <span className="sp-notice__meta">
                  {' '}
                  {t('cycle.shared.since', {
                    date: formatDate(new Date(item.authorizedAt), {
                      timeZone: active.club.timeZone,
                    }),
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
