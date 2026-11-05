import { USAGE_WEEKS_DEFAULT, type UsageSummary } from '@sport-performance/contracts';
import {
  USAGE_ACTIVITY_RETENTION_DAYS,
  addDays,
  usageRate,
  type LocalDate,
} from '@sport-performance/domain';
import { formatLocalDate, formatNumber } from '@sport-performance/i18n';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { clubQueryKey } from '../api/queries';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { RequirePermission } from '../permissions/permissions';
import { Button, ErrorNotice, KpiTile, Loading, Notice, Page } from '../ui/components';
import { SelectField } from '../ui/fields';

/**
 * Usage metrics of the club (B-707, ADR 0093), for its administration: the
 * adoption by week as tables (counts and shares, never a name). The pilot's
 * review (B-709) reads it here.
 */

const WEEK_OPTIONS = [4, 8, 12, 26] as const;

export function UsagePage() {
  const t = useT();
  const active = useActiveClub();
  return (
    <Page title={t('usage.title')} subtitle={t('usage.subtitle', { clubName: active.club.name })}>
      <RequirePermission kind="usage_metrics" action="read">
        <Usage />
      </RequirePermission>
    </Page>
  );
}

function Usage() {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const [weeks, setWeeks] = useState<number>(USAGE_WEEKS_DEFAULT);
  const query = useQuery({
    queryKey: clubQueryKey(active.selection, 'usageSummary', weeks),
    queryFn: ({ signal }) => api.getUsageSummary({ query: { weeks } }, { signal }),
  });
  return (
    <>
      <p className="sp-page__subtitle">
        {t('usage.privacy', { days: USAGE_ACTIVITY_RETENTION_DAYS })}
      </p>
      <form
        className="sp-filters"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <SelectField
          label={t('usage.weeks.label')}
          name="weeks"
          value={String(weeks)}
          options={WEEK_OPTIONS.map((n) => ({
            value: String(n),
            label: t('usage.weeks.option', { weeks: n }),
          }))}
          onChange={(event) => {
            setWeeks(Number(event.target.value));
          }}
        />
      </form>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorNotice
          error={query.error}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : (
        <UsageTables summary={query.data} />
      )}
    </>
  );
}

/** "3 de 4 (75 %)", or a dash-like text when nothing was expected. */
function Share(props: { part: number; whole: number }) {
  const t = useT();
  const rate = usageRate(props.part, props.whole);
  if (rate === null) return <>{t('usage.share.none')}</>;
  return (
    <>
      {t('usage.share', {
        part: formatNumber(props.part, { decimals: 0 }),
        whole: formatNumber(props.whole, { decimals: 0 }),
        percent: `${formatNumber(rate * 100, { decimals: 0 })} %`,
      })}
    </>
  );
}

function Section(props: {
  title: string;
  help?: string;
  caption: string;
  empty: string;
  columns: readonly string[];
  /** Index of the first numeric column (right-aligned, tabular figures). */
  numericFrom: number;
  rows: readonly { key: string; cells: readonly ReactNode[] }[];
}) {
  return (
    <section className="sp-card" aria-label={props.title}>
      <h2 className="sp-card__title">{props.title}</h2>
      {props.help === undefined ? null : <p className="sp-field__help">{props.help}</p>}
      {props.rows.length === 0 ? (
        <Notice level="info" role="status">
          <p>{props.empty}</p>
        </Notice>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-visually-hidden">{props.caption}</caption>
            <thead>
              <tr>
                {props.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row) => (
                <tr key={row.key}>
                  {row.cells.map((cell, i) => (
                    <td
                      key={props.columns[i]}
                      className={i >= props.numericFrom ? 'sp-table__number' : undefined}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function UsageTables(props: { summary: UsageSummary }) {
  const t = useT();
  const { summary } = props;
  const categories = new Map(summary.categories.map((c) => [c.id, c.name]));
  const category = (id: string | null) =>
    id === null ? t('usage.noCategory') : (categories.get(id as never) ?? t('usage.noCategory'));
  const week = (from: LocalDate) =>
    t('usage.week', { from: formatLocalDate(from), to: formatLocalDate(addDays(from, 6)) });
  const members = new Map(summary.members.map((m) => [`${m.weekStart}:${m.role}`, m.members]));
  const number = (value: number) => formatNumber(value, { decimals: 0 });
  const firstWeek = summary.weeks[0]?.weekStart;

  return (
    <>
      {summary.isDemo ? (
        <Notice level="info" role="status">
          <p>{t('usage.demo')}</p>
        </Notice>
      ) : null}
      {firstWeek !== undefined && firstWeek < summary.usageRetainedFrom ? (
        <Notice level="info">
          <p>{t('usage.retained', { date: formatLocalDate(summary.usageRetainedFrom) })}</p>
        </Notice>
      ) : null}
      <UsageKpis summary={summary} />
      <Section
        title={t('usage.training.title')}
        help={t('usage.training.help')}
        caption={t('usage.training.caption')}
        empty={t('usage.training.empty')}
        numericFrom={2}
        columns={[
          t('usage.column.week'),
          t('usage.column.category'),
          t('usage.column.sessions'),
          t('usage.column.wellness'),
          t('usage.column.rpe'),
          t('usage.column.kiosk'),
        ]}
        rows={summary.training.map((r) => ({
          key: `${r.weekStart}:${r.categoryId ?? '-'}`,
          cells: [
            week(r.weekStart),
            category(r.categoryId),
            number(r.sessions),
            <Share
              key="wellness"
              part={r.attendedPlayerDaysWithWellness}
              whole={r.attendedPlayerDays}
            />,
            <Share key="rpe" part={r.participationsWithRpe} whole={r.attendedParticipations} />,
            number(r.rpeViaKiosk),
          ],
        }))}
      />
      <Section
        title={t('usage.wellness.title')}
        caption={t('usage.wellness.caption')}
        empty={t('usage.wellness.empty')}
        numericFrom={2}
        columns={[
          t('usage.column.week'),
          t('usage.column.category'),
          t('usage.column.roster'),
          t('usage.column.respondents'),
          t('usage.column.responses'),
          t('usage.column.kiosk'),
        ]}
        rows={summary.wellness
          .filter((r) => r.responses > 0 || r.rosterPlayers > 0)
          .map((r) => ({
            key: `${r.weekStart}:${r.categoryId ?? '-'}`,
            cells: [
              week(r.weekStart),
              category(r.categoryId),
              number(r.rosterPlayers),
              <Share key="respondents" part={r.respondents} whole={r.rosterPlayers} />,
              number(r.responses),
              number(r.viaKiosk),
            ],
          }))}
      />
      <Section
        title={t('usage.tests.title')}
        caption={t('usage.tests.caption')}
        empty={t('usage.tests.empty')}
        numericFrom={2}
        columns={[
          t('usage.column.week'),
          t('usage.column.category'),
          t('usage.column.testDays'),
          t('usage.column.results'),
          t('usage.column.playersTested'),
          t('usage.column.imported'),
        ]}
        rows={summary.tests.map((r) => ({
          key: `${r.weekStart}:${r.categoryId ?? '-'}`,
          cells: [
            week(r.weekStart),
            category(r.categoryId),
            number(r.testDays),
            number(r.results),
            number(r.playersTested),
            number(r.importedResults),
          ],
        }))}
      />
      <Section
        title={t('usage.surfaces.title')}
        help={t('usage.surfaces.help')}
        caption={t('usage.surfaces.caption')}
        empty={t('usage.surfaces.empty')}
        numericFrom={4}
        columns={[
          t('usage.column.week'),
          t('usage.column.surface'),
          t('usage.column.role'),
          t('usage.column.client'),
          t('usage.column.activeMembers'),
          t('usage.column.memberDays'),
          t('usage.column.events'),
        ]}
        rows={summary.surfaces.map((r) => ({
          key: `${r.weekStart}:${r.surface}:${r.role}:${r.client}`,
          cells: [
            week(r.weekStart),
            t(`usage.surface.${r.surface}`),
            t(`role.${r.role}`),
            t(`usage.client.${r.client}`),
            <Share
              key="members"
              part={r.activeMembers}
              whole={members.get(`${r.weekStart}:${r.role}`) ?? 0}
            />,
            number(r.memberDays),
            number(r.events),
          ],
        }))}
      />
    </>
  );
}

/** The period at a glance: sessions, how much of it got wellness and RPE, and test results. */
function UsageKpis(props: { summary: UsageSummary }) {
  const t = useT();
  const { training, tests } = props.summary;
  const sum = <R,>(rows: readonly R[], pick: (row: R) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  const number = (value: number) => formatNumber(value, { decimals: 0 });
  const share = (part: number, whole: number) => {
    const rate = usageRate(part, whole);
    return {
      value: rate === null ? t('usage.share.none') : formatNumber(rate * 100, { decimals: 0 }),
      unit: rate === null ? undefined : '%',
      caption:
        rate === null
          ? t('usage.kpi.noneCaption')
          : t('usage.kpi.shareCaption', { part: number(part), whole: number(whole) }),
    };
  };
  const wellness = share(
    sum(training, (r) => r.attendedPlayerDaysWithWellness),
    sum(training, (r) => r.attendedPlayerDays),
  );
  const rpe = share(
    sum(training, (r) => r.participationsWithRpe),
    sum(training, (r) => r.attendedParticipations),
  );
  return (
    <section className="sp-kpis sp-usage__kpis" aria-label={t('usage.kpi.label')}>
      <KpiTile
        label={t('usage.kpi.sessions')}
        value={number(sum(training, (r) => r.sessions))}
        caption={t('usage.kpi.sessionsCaption')}
      />
      <KpiTile label={t('usage.kpi.wellness')} {...wellness} />
      <KpiTile label={t('usage.kpi.rpe')} {...rpe} />
      <KpiTile
        label={t('usage.kpi.results')}
        value={number(sum(tests, (r) => r.results))}
        caption={t('usage.kpi.resultsCaption', {
          imported: number(sum(tests, (r) => r.importedResults)),
        })}
      />
    </section>
  );
}
