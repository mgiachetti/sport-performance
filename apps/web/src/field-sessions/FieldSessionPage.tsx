import '@sport-performance/charts/web/charts.css';
import { BarChart, ChartsProvider } from '@sport-performance/charts/web';
import type { BarChartSpec } from '@sport-performance/charts';
import type { FieldSession, FieldSessionPlayer } from '@sport-performance/contracts';
import type { ParticipationStatus } from '@sport-performance/domain';
import type { StatusLevel } from '@sport-performance/ui-tokens';
import {
  UNIT_DEFAULT_DECIMALS,
  formatLocalDateLong,
  formatNumber,
  formatUnit,
  unitLabelEsAr,
} from '@sport-performance/i18n';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT, useTranslator } from '../i18n/i18n';
import { BackLink as Back } from '../ui/back-link';
import {
  Card,
  EmptyState,
  ErrorNotice,
  KpiTile,
  Loading,
  Notice,
  Page,
  StatusChip,
} from '../ui/components';
import { SelectField } from '../ui/fields';
import './field-sessions.css';
import {
  columnLabel,
  metricLabel,
  playerName,
  positionLabel,
  sessionTitle,
  sourceLabel,
  sourcesLabel,
} from './labels';
import { clubModulesQuery, fieldSessionQuery } from './queries';
import {
  mixedSources,
  playerBars,
  referenceOf,
  sessionKpis,
  sourcesOf,
  splitByLine,
  valueOf,
  viewColumns,
  type Kpi,
  type ViewColumn,
} from './view-model';

const route = getRouteApi('/_authed/_club/field-sessions/$trainingSessionId');

/**
 * Session view (maqueta, screen 4; B-408): summary cards, one metric per
 * player as sorted bars and the whole table per player, from one read
 * (`GET /v1/training-sessions/{id}/field-metrics`). Every value carries its
 * source; two sources of a metric are two columns plus a warning. The coach
 * sees "no disponible", never the cause.
 */
export function FieldSessionPage() {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const { trainingSessionId } = route.useParams();
  const view = useQuery(fieldSessionQuery(api, active.selection, trainingSessionId));
  const modules = useQuery(clubModulesQuery(api, active.selection));

  if (view.isPending) {
    return (
      <Page title={t('fieldSession.nav')}>
        <Loading />
      </Page>
    );
  }
  if (view.isError) {
    return (
      <Page title={t('fieldSession.nav')} back={<BackLink />}>
        <ErrorNotice error={view.error} />
      </Page>
    );
  }
  return <SessionView view={view.data} gpsOff={modules.data?.modules.gps === false} />;
}

function BackLink() {
  const t = useT();
  return <Back to="/field-sessions">{t('fieldSession.back')}</Back>;
}

function SessionView(props: { view: FieldSession; gpsOff: boolean }) {
  const t = useT();
  const active = useActiveClub();
  const { view } = props;
  const { session } = view;
  const columns = useMemo(() => viewColumns(view), [view]);
  const mixed = mixedSources(columns);
  const category = active.categories.find((c) => c.id === session.categoryId)?.name ?? null;
  const date = formatLocalDateLong(session.localDate);
  const duration =
    session.plannedDurationMin === null
      ? t('fieldSession.noDuration')
      : t('fieldSession.duration', { minutes: session.plannedDurationMin });
  const title = sessionTitle(t, session);
  const kind = t(`fieldSession.kind.${session.kind}`);

  return (
    <Page
      title={
        // A session's own title already names the rival ("M15 vs. CASI"); a generic one does not.
        session.title !== null || session.opponent === null
          ? title
          : `${title} ${t('fieldSession.vs', { opponent: session.opponent })}`
      }
      subtitle={`${kind} · ${
        category === null
          ? t('fieldSession.subtitleNoCategory', { date, duration })
          : t('fieldSession.subtitle', { category, date, duration })
      }`}
      back={<BackLink />}
    >
      {props.gpsOff ? (
        <Notice level="info">
          <p>{t('fieldSession.module.off')}</p>
        </Notice>
      ) : null}
      {session.archivedAt === null ? null : (
        <Notice level="info">
          <p>{t('fieldSession.archived')}</p>
        </Notice>
      )}
      {columns.length === 0 ? (
        <Card>
          <div role="status">
            <EmptyState
              icon="field"
              title={
                view.players.length === 0 ? t('fieldSession.noPlayers') : t('fieldSession.empty')
              }
            />
          </div>
        </Card>
      ) : (
        <>
          {mixed === null ? null : (
            <Notice level="warning">
              <p>
                {t('fieldSession.mixedSources', {
                  metrics: mixed.metricCodes.map((code) => metricLabel(t, code)).join(', '),
                  count: mixed.metricCodes.length,
                  sources: sourcesLabel(t, mixed.sources),
                })}
              </p>
            </Notice>
          )}
          <Kpis view={view} columns={columns} />
          <MetricChart view={view} columns={columns} />
        </>
      )}
      {view.players.length === 0 ? null : <PlayerTable view={view} columns={columns} />}
    </Page>
  );
}

function kpiValue(kpi: Kpi): string {
  return formatUnit(kpi.value, kpi.column.unit, {
    decimals: kpi.aggregate === 'max' ? 2 : 0,
  });
}

function Kpis(props: { view: FieldSession; columns: readonly ViewColumn[] }) {
  const t = useT();
  const kpis = sessionKpis(props.view, props.columns);
  if (kpis.length === 0) return null;
  return (
    <section aria-labelledby="fs-kpis" className="sp-fs-kpis-region">
      <h2 id="fs-kpis" className="sp-visually-hidden">
        {t('fieldSession.kpi.title')}
      </h2>
      <ul className="sp-kpis">
        {kpis.map((kpi) => (
          <KpiTile
            key={kpi.metricCode}
            as="li"
            label={t(`fieldSession.kpi.${kpi.metricCode}`)}
            value={kpiValue(kpi)}
            caption={`${
              kpi.leader === null
                ? t('fieldSession.kpi.players', { count: kpi.count })
                : t('fieldSession.kpi.bestOf', { name: playerName(kpi.leader) })
            } · ${sourceLabel(t, kpi.column.source)}`}
          />
        ))}
      </ul>
    </section>
  );
}

function MetricChart(props: { view: FieldSession; columns: readonly ViewColumn[] }) {
  const t = useT();
  const translator = useTranslator();
  const [selected, setSelected] = useState(props.columns[0]?.key ?? '');
  const column = props.columns.find((c) => c.key === selected) ?? props.columns[0];
  const spec = useMemo((): BarChartSpec | null => {
    if (column === undefined) return null;
    const bars = playerBars(props.view, column);
    const byLine = splitByLine(bars);
    const metric = metricLabel(t, column.metricCode);
    const unit = unitLabelEsAr(column.unit);
    const reference = referenceOf(props.view, column.metricCode);
    const name = column.sharedMetric ? `${metric} · ${sourceLabel(t, column.source)}` : metric;
    return {
      title:
        unit === ''
          ? t('fieldSession.chart.title', { metric: name })
          : t('fieldSession.chart.titleWithUnit', { metric: name, unit }),
      format: { unit: column.unit },
      bars: bars.map((bar) => ({
        key: bar.player.playerId,
        label: bar.player.lastName,
        name: playerName(bar.player),
        value: bar.value,
        tone: byLine && bar.line === 'forwards' ? 'neutral' : 'brand',
      })),
      ...(byLine
        ? {
            tones: {
              brand: t('fieldSession.line.backs'),
              neutral: t('fieldSession.line.forwards'),
            },
          }
        : { valueLabel: metric }),
      ...(reference?.unit !== column.unit ? {} : { reference: { value: reference.value } }),
      directLabel: 'max',
    };
  }, [column, props.view, t]);

  if (column === undefined || spec === null) return null;
  return (
    <Card
      className="sp-fs-chart"
      title={t('fieldSession.chart.cardTitle')}
      subtitle={t('fieldSession.chart.cardSubtitle')}
      actions={
        <SelectField
          label={t('fieldSession.chart.metric')}
          value={column.key}
          options={props.columns.map((c) => ({
            value: c.key,
            label: c.sharedMetric
              ? `${metricLabel(t, c.metricCode)} · ${sourceLabel(t, c.source)}`
              : metricLabel(t, c.metricCode),
          }))}
          onChange={(event) => {
            setSelected(event.target.value);
          }}
        />
      }
    >
      <ChartsProvider translator={translator}>
        <BarChart
          spec={spec}
          height={300}
          description={t('fieldSession.chart.description', {
            sources: t('fieldSession.sources', { sources: sourceLabel(t, column.source) }),
          })}
        />
      </ChartsProvider>
    </Card>
  );
}

const STATUS_LEVELS: Readonly<Record<ParticipationStatus, StatusLevel | 'info'>> = {
  full: 'ok',
  partial: 'warning',
  absent: 'info',
  unavailable: 'critical',
};

function ParticipationCell(props: { participation: FieldSessionPlayer['participation'] }) {
  const t = useT();
  if (props.participation === null) {
    return <span className="sp-cell-muted">{t('fieldSession.table.noParticipation')}</span>;
  }
  const { status } = props.participation;
  return (
    <StatusChip level={STATUS_LEVELS[status]}>{t(`fieldSession.status.${status}`)}</StatusChip>
  );
}

function PlayerTable(props: { view: FieldSession; columns: readonly ViewColumn[] }) {
  const t = useT();
  const sources = sourcesOf(props.columns);
  return (
    <Card
      variant="flush"
      title={t('fieldSession.table.title')}
      subtitle={t('fieldSession.table.subtitle')}
    >
      <div className="sp-table-wrap">
        <table className="sp-table sp-fs-table">
          {sources.length === 0 ? null : (
            <caption className="sp-table__caption">
              {t('fieldSession.sources', { sources: sourcesLabel(t, sources) })}
            </caption>
          )}
          <thead>
            <tr>
              <th scope="col">{t('fieldSession.table.player')}</th>
              <th scope="col">{t('fieldSession.table.position')}</th>
              <th scope="col">{t('fieldSession.table.status')}</th>
              <th scope="col" className="sp-table__number">
                {t('fieldSession.table.minutes')}
              </th>
              <th scope="col" className="sp-table__number">
                {t('fieldSession.table.srpe')}
              </th>
              {props.columns.map((column) => (
                <th key={column.key} scope="col" className="sp-table__number">
                  {columnLabel(t, column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.view.players.map((player) => (
              <tr key={player.playerId}>
                <th scope="row">{playerName(player)}</th>
                <td>{positionLabel(t, player.position)}</td>
                <td>
                  <ParticipationCell participation={player.participation} />
                </td>
                <td className="sp-table__number">
                  {formatNumber(player.participation?.minutes ?? null)}
                </td>
                <td className="sp-table__number">
                  {formatNumber(player.participation?.srpeAu ?? null)}
                </td>
                {player.values.length === 0 && props.columns.length > 0 ? (
                  <td colSpan={props.columns.length} className="is-muted">
                    {t('fieldSession.table.noData')}
                  </td>
                ) : (
                  props.columns.map((column) => (
                    <td key={column.key} className="sp-table__number">
                      {formatNumber(valueOf(player, column), {
                        decimals: UNIT_DEFAULT_DECIMALS[column.unit],
                      })}
                    </td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
