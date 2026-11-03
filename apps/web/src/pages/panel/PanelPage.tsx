import {
  ApiError,
  type ApiClient,
  type PanelPlayer,
  type WeeklyPanel,
} from '@sport-performance/contracts';
import { BarChart, StatusBadge } from '@sport-performance/charts/web';
import type { BarChartSpec } from '@sport-performance/charts';
import {
  addDays,
  bioBandFor,
  type AvailabilityStatus,
  type BioBandScheme,
  type CategoryId,
  type LocalDate,
  type Sport,
} from '@sport-performance/domain';
import { formatLocalDate, formatNumber, formatUnit, isMessageKey } from '@sport-performance/i18n';
import type { StatusLevel } from '@sport-performance/ui-tokens';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';
import type { ClubSelection } from '../../api/club-selection';
import { clubQueryKey } from '../../api/queries';
import { useServices } from '../../app/services';
import { ASSIGNED_ROLES, useActiveClub } from '../../club/active-club';
import { useScope } from '../../club/use-scope';
import { translate, useT } from '../../i18n/i18n';
import { alertText } from '../../lib/alert-text';
import { Button, ErrorNotice, Loading, Notice, Page } from '../../ui/components';
import {
  BIO_BAND_SCHEMES,
  isCurrentWeek,
  maturityValue,
  panelGroups,
  panelSummary,
  playersNeedingAttention,
  weeklyLoadSeries,
  worstSeverity,
  type PanelGroup,
  type PanelGrouping,
} from './panel-model';
import './panel.css';

const route = getRouteApi('/_authed/_club/panel');

interface PanelParams {
  readonly weekOf: LocalDate | undefined;
  readonly sport: Sport | undefined;
  readonly categoryId: CategoryId | undefined;
}

/** `GET /v1/panel/weekly` of the scope, keyed by club and parameters. */
export function weeklyPanelQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  params: PanelParams,
) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'panel', 'weekly', params),
    queryFn: ({ signal }) =>
      api.getWeeklyPanel(
        {
          query: {
            ...(params.weekOf === undefined ? {} : { weekOf: params.weekOf }),
            ...(params.sport === undefined ? {} : { sport: params.sport }),
            ...(params.categoryId === undefined ? {} : { categoryId: params.categoryId }),
          },
        },
        { signal },
      ),
  });
}

/**
 * Weekly panel (B-403, screen 1 of the mockup): summary, load of the last
 * weeks, who needs attention and the roster of a group of players. Groups
 * are categories or maturity bands (bio-banding); everything shown was
 * derived by the worker and served by one aggregated read.
 */
export function PanelPage() {
  const t = useT();
  const active = useActiveClub();
  const scope = useScope();
  const search = route.useSearch();
  const { api } = useServices();
  const grouping: PanelGrouping = search.group ?? 'category';
  const params: PanelParams = {
    weekOf: search.week,
    sport: scope.sport ?? undefined,
    categoryId: scope.category?.id,
  };
  const query = useQuery({
    ...weeklyPanelQuery(api, active.selection, params),
    enabled: scope.categoryOptions.length > 0,
    placeholderData: keepPreviousData,
  });

  const title = t('panel.title');
  if (scope.categoryOptions.length === 0) {
    return (
      <Page title={title}>
        <Notice level="info">
          <p>
            {ASSIGNED_ROLES.includes(active.role)
              ? t('panel.empty.noCategories')
              : t('panel.empty.noPlayers')}
          </p>
        </Notice>
      </Page>
    );
  }
  const panel = query.data;
  return (
    <Page
      title={title}
      {...(panel === undefined
        ? {}
        : {
            subtitle: t('panel.week', {
              from: formatLocalDate(panel.week.from),
              to: formatLocalDate(panel.week.to),
            }),
          })}
      actions={<PanelControls panel={panel} grouping={grouping} />}
    >
      {query.isError ? (
        tooManyPlayers(query.error) ? (
          <Notice level="info">
            <p>{t('panel.empty.tooMany')}</p>
          </Notice>
        ) : (
          <ErrorNotice
            error={query.error}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  void query.refetch();
                }}
              >
                {t('common.retry')}
              </Button>
            }
          />
        )
      ) : panel === undefined ? (
        <Loading />
      ) : panel.players.length === 0 ? (
        <Notice level="info">
          <p>{t('panel.empty.noPlayers')}</p>
        </Notice>
      ) : (
        <PanelBody panel={panel} grouping={grouping} />
      )}
    </Page>
  );
}

function tooManyPlayers(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'bad_request' && error.details.length === 0;
}

/** Week navigation and grouping; both live in the URL. */
function PanelControls(props: { panel: WeeklyPanel | undefined; grouping: PanelGrouping }) {
  const t = useT();
  const navigate = route.useNavigate();
  const groupId = useId();
  const { panel } = props;
  const goToWeek = (week: LocalDate | undefined) => {
    void navigate({ search: (previous) => ({ ...previous, week }) });
  };
  return (
    <div className="sp-panel-controls">
      <div className="sp-scope__field">
        <label htmlFor={groupId}>{t('panel.group.label')}</label>
        <select
          id={groupId}
          value={props.grouping}
          onChange={(event) => {
            const value = event.target.value as PanelGrouping;
            void navigate({
              search: (previous) => ({
                ...previous,
                group: value === 'category' ? undefined : value,
              }),
            });
          }}
        >
          <option value="category">{t('panel.group.category')}</option>
          <option value="phv_offset">{t('panel.group.phv_offset')}</option>
          <option value="pct_adult_height">{t('panel.group.pct_adult_height')}</option>
        </select>
      </div>
      <div className="sp-panel-week" role="group" aria-label={t('panel.week.label')}>
        <Button
          variant="secondary"
          disabled={panel === undefined}
          onClick={() => {
            if (panel !== undefined) goToWeek(addDays(panel.week.from, -7));
          }}
        >
          {t('panel.week.previous')}
        </Button>
        <Button
          variant="secondary"
          disabled={panel === undefined || isCurrentWeek(panel)}
          onClick={() => {
            if (panel === undefined) return;
            const next = addDays(panel.week.from, 7);
            goToWeek(next > panel.today ? undefined : next);
          }}
        >
          {t('panel.week.next')}
        </Button>
        <Button
          variant="ghost"
          disabled={panel === undefined || isCurrentWeek(panel)}
          onClick={() => {
            goToWeek(undefined);
          }}
        >
          {t('panel.week.current')}
        </Button>
      </div>
    </div>
  );
}

const ALL_GROUP = 'all';

function PanelBody(props: { panel: WeeklyPanel; grouping: PanelGrouping }) {
  const t = useT();
  const active = useActiveClub();
  const { panel, grouping } = props;
  const groups = useMemo(
    () => panelGroups(panel.players, grouping, active.categories),
    [panel.players, grouping, active.categories],
  );
  const [selectedKey, setSelectedKey] = useState<string>(ALL_GROUP);
  const selected = groups.find((group) => group.key === selectedKey);
  const players = selected?.players ?? panel.players;
  const groupLabel = (group: PanelGroup) => {
    switch (group.label.kind) {
      case 'category':
        return group.label.name;
      case 'band': {
        const key = `bioBand.${group.label.code}`;
        return isMessageKey(key) ? t(key) : group.label.code;
      }
      case 'unbanded':
        return t('panel.group.unbanded');
    }
  };

  return (
    <>
      <div className="sp-panel-groups" role="group" aria-label={t('panel.group.tabs')}>
        <Button
          variant="secondary"
          aria-pressed={selected === undefined}
          onClick={() => {
            setSelectedKey(ALL_GROUP);
          }}
        >
          {t('panel.group.all', { count: panel.players.length })}
        </Button>
        {groups.map((group) => (
          <Button
            key={group.key}
            variant="secondary"
            aria-pressed={selected?.key === group.key}
            onClick={() => {
              setSelectedKey(group.key);
            }}
          >
            {t('panel.group.option', { name: groupLabel(group), count: group.players.length })}
          </Button>
        ))}
      </div>
      {grouping === 'category' ? null : (
        <p className="sp-panel-note">
          {t('panel.group.maturityNote', { date: formatLocalDate(panel.referenceDate) })}
        </p>
      )}
      <Kpis panel={panel} players={players} />
      <div className="sp-panel-grid">
        <LoadChart panel={panel} players={players} />
        <Attention players={players} />
      </div>
      <Roster panel={panel} players={players} grouping={grouping} />
    </>
  );
}

function Kpis(props: { panel: WeeklyPanel; players: readonly PanelPlayer[] }) {
  const t = useT();
  const current = isCurrentWeek(props.panel);
  const summary = panelSummary(props.players, current);
  const outOf = (value: number) =>
    t('panel.kpi.outOf', { value: formatNumber(value), total: formatNumber(summary.players) });
  const cards: { label: string; value: string; detail: string; alert?: boolean }[] = [
    {
      label: current ? t('panel.kpi.wellnessToday') : t('panel.kpi.wellnessWeek'),
      value: outOf(summary.wellnessResponded),
      detail: current ? t('panel.kpi.wellnessTodayDetail') : t('panel.kpi.wellnessWeekDetail'),
    },
    {
      label: t('panel.kpi.wellnessMean'),
      value:
        summary.wellnessMeanScore === null
          ? formatNumber(null)
          : t('panel.roster.wellnessValue', {
              value: formatNumber(summary.wellnessMeanScore, { decimals: 1 }),
            }),
      detail: t('panel.kpi.wellnessMeanDetail', { count: summary.wellnessPlayers }),
    },
    {
      label: t('panel.kpi.load'),
      value: formatUnit(summary.loadMeanAu, 'au', { decimals: 0 }),
      detail: t('panel.kpi.loadDetail', { count: summary.loadPlayers }),
    },
    {
      label: t('panel.kpi.alerts'),
      value: outOf(summary.withAlerts),
      detail: t('panel.kpi.alertsDetail', { count: summary.critical }),
      alert: summary.critical > 0,
    },
  ];
  return (
    <section className="sp-panel-kpis" aria-label={t('panel.kpi.label')}>
      {cards.map((card) => (
        <div key={card.label} className={`sp-card sp-panel-kpi${card.alert ? ' is-alert' : ''}`}>
          <p className="sp-panel-kpi__label">{card.label}</p>
          <p className="sp-panel-kpi__value">{card.value}</p>
          <p className="sp-panel-kpi__detail">{card.detail}</p>
        </div>
      ))}
    </section>
  );
}

function LoadChart(props: { panel: WeeklyPanel; players: readonly PanelPlayer[] }) {
  const t = useT();
  const { panel, players } = props;
  const spec = useMemo((): BarChartSpec => {
    const series = weeklyLoadSeries(panel.weeks, players);
    return {
      title: t('panel.chart.title', { weeks: panel.weeks.length }),
      format: { unit: 'au', decimals: 0 },
      valueLabel: t('panel.chart.bar'),
      bars: series.map((point) => ({
        key: point.from,
        // dd/mm on the axis; the whole date in the tooltip and the table.
        label: formatLocalDate(point.from).slice(0, 5),
        name: t('panel.chart.weekLabel', { date: formatLocalDate(point.from) }),
        value: point.meanLoadAu,
        tone: 'brand',
      })),
      tones: { brand: t('panel.chart.bar') },
      overlay: {
        label: t('panel.chart.chronic'),
        values: series.map((point) => point.meanChronicWeeklyAu),
      },
      directLabel: 'last',
    };
  }, [panel.weeks, players, t]);
  return (
    <div className="sp-card sp-panel-chart">
      <BarChart spec={spec} description={t('panel.chart.description')} height={260} />
    </div>
  );
}

function playerName(t: ReturnType<typeof useT>, player: PanelPlayer): string {
  return t('panel.roster.name', { firstName: player.firstName, lastName: player.lastName });
}

function Attention(props: { players: readonly PanelPlayer[] }) {
  const t = useT();
  const headingId = useId();
  const players = playersNeedingAttention(props.players);
  return (
    <section className="sp-card sp-panel-attention" aria-labelledby={headingId}>
      <div>
        <h2 id={headingId} className="sp-card__title">
          {t('panel.attention.title')}
        </h2>
        <p className="sp-panel-note">{t('panel.attention.subtitle')}</p>
      </div>
      {players.length === 0 ? (
        <Notice level="ok">
          <p>{t('panel.attention.none')}</p>
        </Notice>
      ) : (
        <ul className="sp-panel-attention__list">
          {players.map((player) => {
            const [first, ...rest] = player.alerts;
            if (first === undefined) return null;
            return (
              <li key={player.playerId} className="sp-panel-attention__item">
                <div>
                  <p className="sp-panel-attention__name">{playerName(t, player)}</p>
                  <p className="sp-panel-note">{alertText(t, first) ?? t('common.noData')}</p>
                  {rest.length === 0 ? null : (
                    <p className="sp-panel-note">
                      {t('panel.attention.more', { count: rest.length })}
                    </p>
                  )}
                </div>
                <StatusBadge level={first.severity} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const AVAILABILITY_LEVELS: Record<AvailabilityStatus, StatusLevel> = {
  available: 'ok',
  limited: 'warning',
  unavailable: 'critical',
};

function Availability(props: { availability: PanelPlayer['availability'] }) {
  const t = useT();
  const { availability } = props;
  if (availability === null) {
    return <span className="sp-panel-muted">{t('panel.availability.unknown')}</span>;
  }
  const label = (status: AvailabilityStatus) => t(`panel.availability.${status}`);
  return (
    <span
      title={t('panel.availability.detail', {
        training: label(availability.training),
        match: label(availability.match),
      })}
    >
      <StatusBadge
        level={AVAILABILITY_LEVELS[availability.overall]}
        label={label(availability.overall)}
      />
    </span>
  );
}

function Maturity(props: { player: PanelPlayer; grouping: PanelGrouping }) {
  const t = useT();
  const { maturity } = props.player;
  if (maturity === null) {
    return <span className="sp-panel-muted">{t('panel.roster.noMaturity')}</span>;
  }
  const parts: string[] = [];
  if (maturity.phvOffsetYearsOnDate !== null) {
    parts.push(
      t('panel.roster.phvOffset', {
        value: formatNumber(maturity.phvOffsetYearsOnDate, { decimals: 1, sign: 'always' }),
      }),
    );
  }
  if (maturity.adultHeightPct !== null) {
    parts.push(
      t('panel.roster.adultHeight', {
        value: formatUnit(maturity.adultHeightPct, 'pct', { decimals: 1 }),
      }),
    );
  }
  const scheme = props.grouping === 'category' ? null : BIO_BAND_SCHEMES[props.grouping];
  const value = scheme === null ? null : maturityValue(props.player, scheme);
  return (
    <span title={t('panel.roster.measuredOn', { date: formatLocalDate(maturity.measuredOn) })}>
      {parts.length === 0 ? t('panel.roster.noMaturity') : parts.join(' · ')}
      {scheme === null || value === null ? null : (
        <span className="sp-panel-muted sp-panel-block">{bandLabel(t, scheme, value)}</span>
      )}
    </span>
  );
}

function bandLabel(t: ReturnType<typeof useT>, scheme: BioBandScheme, value: number): string {
  const { code } = bioBandFor(value, scheme);
  const key = `bioBand.${code}`;
  return isMessageKey(key) ? translate(t, key) : code;
}

function positionName(t: ReturnType<typeof useT>, player: PanelPlayer): string {
  const position = player.position;
  if (position === null) return formatNumber(null);
  if (position.label !== null) return position.label;
  const key = `panel.position.${position.code}`;
  return isMessageKey(key) ? translate(t, key) : position.code;
}

function Acwr(props: { load: PanelPlayer['load'] }) {
  const t = useT();
  const { load } = props;
  if (load.acwrStatus === 'ok') return <>{formatNumber(load.acwr, { decimals: 2 })}</>;
  return <span className="sp-panel-muted">{t(`panel.acwr.${load.acwrStatus}`)}</span>;
}

function Roster(props: {
  panel: WeeklyPanel;
  players: readonly PanelPlayer[];
  grouping: PanelGrouping;
}) {
  const t = useT();
  const headingId = useId();
  return (
    <section className="sp-card" aria-labelledby={headingId}>
      <div>
        <h2 id={headingId} className="sp-card__title">
          {t('panel.roster.title')}
        </h2>
        <p className="sp-panel-note">{t('panel.roster.subtitle')}</p>
      </div>
      {props.players.length === 0 ? (
        <p>{t('panel.roster.empty')}</p>
      ) : (
        <div className="sp-panel-table-scroll">
          <table className="sp-panel-table" aria-labelledby={headingId}>
            <thead>
              <tr>
                <th scope="col">{t('panel.roster.player')}</th>
                <th scope="col">{t('panel.roster.position')}</th>
                <th scope="col">{t('panel.roster.maturity')}</th>
                <th scope="col">{t('panel.roster.wellness')}</th>
                <th scope="col" className="is-number">
                  {t('panel.roster.load')}
                </th>
                <th scope="col" className="is-number">
                  {t('panel.roster.acwr')}
                </th>
                <th scope="col">{t('panel.roster.availability')}</th>
                <th scope="col">{t('panel.roster.status')}</th>
              </tr>
            </thead>
            <tbody>
              {props.players.map((player) => {
                const severity = worstSeverity(player);
                return (
                  <tr key={player.playerId}>
                    <th scope="row">{playerName(t, player)}</th>
                    <td>{positionName(t, player)}</td>
                    <td>
                      <Maturity player={player} grouping={props.grouping} />
                    </td>
                    <td>
                      {player.wellness.weekMeanScore === null ? (
                        <span className="sp-panel-muted">{t('panel.roster.noWellness')}</span>
                      ) : (
                        t('panel.roster.wellnessValue', {
                          value: formatNumber(player.wellness.weekMeanScore, { decimals: 1 }),
                        })
                      )}
                    </td>
                    <td className="is-number">
                      {formatUnit(player.load.weekLoadAu, 'au', { decimals: 0 })}
                      {player.load.pendingRpeN === 0 ? null : (
                        <span className="sp-panel-muted sp-panel-block">
                          {t('panel.roster.pendingRpe', { count: player.load.pendingRpeN })}
                        </span>
                      )}
                    </td>
                    <td className="is-number">
                      <Acwr load={player.load} />
                    </td>
                    <td>
                      <Availability availability={player.availability} />
                    </td>
                    <td>
                      {severity === null ? (
                        <StatusBadge level="ok" label={t('panel.status.inRange')} />
                      ) : (
                        <StatusBadge level={severity} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
