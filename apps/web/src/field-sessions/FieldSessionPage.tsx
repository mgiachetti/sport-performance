import '@sport-performance/charts/web/charts.css';
import { BarChart, ChartsProvider } from '@sport-performance/charts/web';
import type { BarChartSpec } from '@sport-performance/charts';
import type { FieldSession, FieldSessionPlayer } from '@sport-performance/contracts';
import type { ParticipationStatus } from '@sport-performance/domain';
import {
  UNIT_DEFAULT_DECIMALS,
  formatLocalDateLong,
  formatNumber,
  formatUnit,
  unitLabelEsAr,
} from '@sport-performance/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT, useTranslator } from '../i18n/i18n';
import { ErrorNotice, Loading, Notice, Page } from '../ui/components';
import { Icon, type IconName } from '../ui/icons';
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
      <Page title={t('fieldSession.nav')}>
        <BackLink />
        <ErrorNotice error={view.error} />
      </Page>
    );
  }
  return <SessionView view={view.data} gpsOff={modules.data?.modules.gps === false} />;
}

function BackLink() {
  const t = useT();
  return (
    <Link to="/field-sessions" className="sp-fs-back">
      {t('fieldSession.back')}
    </Link>
  );
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
    >
      <BackLink />
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
        <Notice level="info" role="status">
          <p>{view.players.length === 0 ? t('fieldSession.noPlayers') : t('fieldSession.empty')}</p>
        </Notice>
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
    <section aria-labelledby="fs-kpis" className="sp-card">
      <h2 id="fs-kpis" className="sp-visually-hidden">
        {t('fieldSession.kpi.title')}
      </h2>
      <ul className="sp-fs-kpis">
        {kpis.map((kpi) => (
          <li key={kpi.metricCode} className="sp-fs-kpi">
            <span className="sp-fs-kpi__label">{t(`fieldSession.kpi.${kpi.metricCode}`)}</span>
            <span className="sp-fs-kpi__value">{kpiValue(kpi)}</span>
            <span className="sp-fs-kpi__meta">
              {kpi.leader === null
                ? t('fieldSession.kpi.players', { count: kpi.count })
                : t('fieldSession.kpi.bestOf', { name: playerName(kpi.leader) })}
              {' · '}
              {sourceLabel(t, kpi.column.source)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MetricChart(props: { view: FieldSession; columns: readonly ViewColumn[] }) {
  const t = useT();
  const translator = useTranslator();
  const selectId = useId();
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
    <section className="sp-card" aria-label={spec.title}>
      <div className="sp-fs-toolbar">
        <label htmlFor={selectId}>
          {t('fieldSession.chart.metric')}
          <select
            id={selectId}
            value={column.key}
            onChange={(event) => {
              setSelected(event.target.value);
            }}
          >
            {props.columns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.sharedMetric
                  ? `${metricLabel(t, c.metricCode)} · ${sourceLabel(t, c.source)}`
                  : metricLabel(t, c.metricCode)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ChartsProvider translator={translator}>
        <BarChart
          spec={spec}
          height={300}
          description={t('fieldSession.chart.description', {
            sources: t('fieldSession.sources', { sources: sourceLabel(t, column.source) }),
          })}
        />
      </ChartsProvider>
    </section>
  );
}

const STATUS_ICONS: Readonly<Record<ParticipationStatus, IconName>> = {
  full: 'ok',
  partial: 'warning',
  absent: 'info',
  unavailable: 'critical',
};

function ParticipationCell(props: { participation: FieldSessionPlayer['participation'] }) {
  const t = useT();
  if (props.participation === null) {
    return <span className="sp-fs-muted">{t('fieldSession.table.noParticipation')}</span>;
  }
  const { status } = props.participation;
  return (
    <span className="sp-fs-status">
      <Icon name={STATUS_ICONS[status]} size={16} />
      <span>{t(`fieldSession.status.${status}`)}</span>
    </span>
  );
}

function PlayerTable(props: { view: FieldSession; columns: readonly ViewColumn[] }) {
  const t = useT();
  const sources = sourcesOf(props.columns);
  return (
    <section className="sp-card" aria-labelledby="fs-table">
      <h2 id="fs-table" className="sp-card__title">
        {t('fieldSession.table.title')}
      </h2>
      <p className="sp-fs-muted">{t('fieldSession.table.subtitle')}</p>
      <div className="sp-fs-table-wrap">
        <table className="sp-fs-table">
          {sources.length === 0 ? null : (
            <caption>{t('fieldSession.sources', { sources: sourcesLabel(t, sources) })}</caption>
          )}
          <thead>
            <tr>
              <th scope="col">{t('fieldSession.table.player')}</th>
              <th scope="col">{t('fieldSession.table.position')}</th>
              <th scope="col">{t('fieldSession.table.status')}</th>
              <th scope="col" className="sp-fs-num">
                {t('fieldSession.table.minutes')}
              </th>
              <th scope="col" className="sp-fs-num">
                {t('fieldSession.table.srpe')}
              </th>
              {props.columns.map((column) => (
                <th key={column.key} scope="col" className="sp-fs-num">
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
                <td className="sp-fs-num">{formatNumber(player.participation?.minutes ?? null)}</td>
                <td className="sp-fs-num">{formatNumber(player.participation?.srpeAu ?? null)}</td>
                {player.values.length === 0 && props.columns.length > 0 ? (
                  <td colSpan={props.columns.length} className="sp-fs-muted">
                    {t('fieldSession.table.noData')}
                  </td>
                ) : (
                  props.columns.map((column) => (
                    <td key={column.key} className="sp-fs-num">
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
    </section>
  );
}
