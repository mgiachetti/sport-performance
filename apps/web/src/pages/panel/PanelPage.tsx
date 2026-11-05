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
import {
  alertMessage,
  formatLocalDate,
  formatNumber,
  formatUnit,
  isMessageKey,
  unitLabelEsAr,
} from '@sport-performance/i18n';
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
import {
  Avatar,
  Button,
  Card,
  ErrorNotice,
  KpiTile,
  Loading,
  Notice,
  Page,
  SegmentedControl,
} from '../../ui/components';
import { Icon } from '../../ui/icons';
import { initialsOf } from '../../lib/initials';
import { typographicMinus } from '../../lib/minus';
import { NARROW_QUERY, useMediaQuery } from '../../lib/use-media-query';
import {
  BIO_BAND_SCHEMES,
  isCurrentWeek,
  maturityValue,
  PANEL_GROUPINGS,
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
  const { panel } = props;
  const goToWeek = (week: LocalDate | undefined) => {
    void navigate({ search: (previous) => ({ ...previous, week }) });
  };
  return (
    <div className="sp-panel-controls">
      <SegmentedControl
        label={t('panel.group.label')}
        labelPlacement="inline"
        size="sm"
        options={PANEL_GROUPINGS.map((value) => ({ value, label: t(`panel.group.${value}`) }))}
        value={props.grouping}
        onChange={(value) => {
          void navigate({
            search: (previous) => ({
              ...previous,
              group: value === 'category' ? undefined : value,
            }),
          });
        }}
      />
      <div className="sp-panel-week" role="group" aria-label={t('panel.week.label')}>
        <Button
          variant="secondary"
          size="sm"
          disabled={panel === undefined}
          onClick={() => {
            if (panel !== undefined) goToWeek(addDays(panel.week.from, -7));
          }}
        >
          <Icon name="chevronLeft" />
          <span>{t('panel.week.previous')}</span>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={panel === undefined || isCurrentWeek(panel)}
          onClick={() => {
            if (panel === undefined) return;
            const next = addDays(panel.week.from, 7);
            goToWeek(next > panel.today ? undefined : next);
          }}
        >
          <span>{t('panel.week.next')}</span>
          <Icon name="chevronRight" />
        </Button>
        <Button
          variant="secondary"
          size="sm"
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
  // By category the scope of the top bar already filters: no second category selector here.
  const byMaturity = grouping !== 'category';
  const selected = byMaturity ? groups.find((group) => group.key === selectedKey) : undefined;
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
      {isCurrentWeek(panel) ? null : (
        <Notice level="info">
          <p>{t('panel.week.pastRoster', { date: formatLocalDate(panel.referenceDate) })}</p>
        </Notice>
      )}
      {byMaturity ? (
        <div className="sp-panel-groups" role="group" aria-label={t('panel.group.tabs')}>
          <Button
            variant="secondary"
            size="sm"
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
              size="sm"
              aria-pressed={selected?.key === group.key}
              onClick={() => {
                setSelectedKey(group.key);
              }}
            >
              {t('panel.group.option', { name: groupLabel(group), count: group.players.length })}
            </Button>
          ))}
        </div>
      ) : null}
      {byMaturity ? (
        <p className="sp-panel-note">
          {t('panel.group.maturityNote', { date: formatLocalDate(panel.referenceDate) })}
        </p>
      ) : null}
      <Kpis panel={panel} players={players} />
      <div className="sp-panel-grid">
        <LoadChart panel={panel} players={players} />
        <Attention key={selected?.key ?? ALL_GROUP} players={players} />
      </div>
      <Roster panel={panel} players={players} grouping={grouping} />
    </>
  );
}

function Kpis(props: { panel: WeeklyPanel; players: readonly PanelPlayer[] }) {
  const t = useT();
  const current = isCurrentWeek(props.panel);
  const summary = panelSummary(props.players, current);
  const ofTotal = t('panel.kpi.ofTotal', { total: formatNumber(summary.players) });
  return (
    <section className="sp-kpis sp-panel-kpis" aria-label={t('panel.kpi.label')}>
      <KpiTile
        label={current ? t('panel.kpi.wellnessToday') : t('panel.kpi.wellnessWeek')}
        value={formatNumber(summary.wellnessResponded)}
        unit={ofTotal}
        caption={current ? t('panel.kpi.wellnessTodayDetail') : t('panel.kpi.wellnessWeekDetail')}
      />
      <KpiTile
        label={t('panel.kpi.wellnessMean')}
        value={formatNumber(summary.wellnessMeanScore, { decimals: 1 })}
        unit={summary.wellnessMeanScore === null ? undefined : t('panel.kpi.ofScore')}
        caption={t('panel.kpi.wellnessMeanDetail', { count: summary.wellnessPlayers })}
      />
      <KpiTile
        label={t('panel.kpi.load')}
        value={formatNumber(summary.loadMeanAu, { decimals: 0 })}
        unit={summary.loadMeanAu === null ? undefined : unitLabelEsAr('au')}
        caption={t('panel.kpi.loadDetail', { count: summary.loadPlayers })}
      />
      <KpiTile
        label={t('panel.kpi.alerts')}
        value={formatNumber(summary.withAlerts)}
        unit={ofTotal}
        caption={t('panel.kpi.alertsDetail', { count: summary.critical })}
        highlighted={summary.critical > 0}
      />
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
  // The current (or chosen) week in full brand color, the earlier ones dimmed.
  const lastHasValue = spec.bars.at(-1)?.value !== null;
  return (
    <div
      className={`sp-card sp-panel-chart${lastHasValue ? ' sp-panel-chart--emphasize-last' : ''}`}
    >
      <BarChart spec={spec} description={t('panel.chart.description')} height={300} />
    </div>
  );
}

function playerName(t: ReturnType<typeof useT>, player: PanelPlayer): string {
  return t('panel.roster.name', { firstName: player.firstName, lastName: player.lastName });
}

/** How many players the attention list shows before "see all" (about the chart's height). */
export const ATTENTION_VISIBLE = 5;

/**
 * The short line of an alert in the attention list ("ACWR bajo 0,15 · umbral 0,80"); the full
 * message when this build has no short text for the kind, a generic line when it has neither.
 */
function attentionLine(t: ReturnType<typeof useT>, alert: PanelPlayer['alerts'][number]): string {
  // The CMJ drop says its threshold when the alert carries it (older rules did not).
  const key =
    alert.kind === 'cmj_drop' && alert.values.thresholdPct !== undefined
      ? 'panel.attention.short.cmj_drop_threshold'
      : `panel.attention.short.${alert.kind}`;
  return typographicMinus(
    alertMessage(t, key, alert.values) ?? alertText(t, alert) ?? t('common.noData'),
  );
}

function Attention(props: { players: readonly PanelPlayer[] }) {
  const t = useT();
  const listId = useId();
  const players = playersNeedingAttention(props.players);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? players : players.slice(0, ATTENTION_VISIBLE);
  const hidden = players.length - ATTENTION_VISIBLE;
  return (
    <Card
      className="sp-panel-attention"
      title={t('panel.attention.title')}
      subtitle={t('panel.attention.subtitle')}
    >
      {players.length === 0 ? (
        <Notice level="ok">
          <p>{t('panel.attention.none')}</p>
        </Notice>
      ) : (
        <>
          {/* Collapsed, the first rows show in full; expanded, the whole list scrolls inside the
              card in a focusable region (a wrapper, so the <ul> keeps its list role). */}
          <div
            id={listId}
            className={`sp-panel-attention__scroll${expanded ? ' is-expanded' : ''}`}
            {...(expanded
              ? {
                  tabIndex: 0,
                  role: 'region',
                  'aria-label': t('panel.attention.listLabel', { count: players.length }),
                }
              : {})}
          >
            <ul className="sp-panel-attention__list">
              {shown.map((player) => {
                const [first, ...rest] = player.alerts;
                if (first === undefined) return null;
                return (
                  <li key={player.playerId} className="sp-panel-attention__item">
                    <Avatar label={initialsOf(`${player.firstName} ${player.lastName}`)} />
                    <div className="sp-panel-attention__body">
                      <p className="sp-panel-attention__head">
                        <span className="sp-panel-attention__name">{playerName(t, player)}</span>
                        {rest.length === 0 ? null : (
                          <span className="sp-panel-attention__more">
                            {t('panel.attention.more', { count: rest.length })}
                          </span>
                        )}
                      </p>
                      {/* One short line (metric and threshold); the full sentence and the
                          suggestion are in the player's alert history. */}
                      <p className="sp-panel-note sp-panel-attention__metric">
                        {attentionLine(t, first)}
                      </p>
                    </div>
                    <StatusBadge level={first.severity} />
                  </li>
                );
              })}
            </ul>
          </div>
          {hidden > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="sp-panel-attention__toggle"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => {
                setExpanded((value) => !value);
              }}
            >
              <span>
                {expanded
                  ? t('panel.attention.showFewer')
                  : t('panel.attention.showAll', { count: players.length })}
              </span>
              <Icon name={expanded ? 'chevronUp' : 'chevronDown'} />
            </Button>
          ) : null}
        </>
      )}
    </Card>
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
  // Available is the usual case: plain text, so the chips stand out where something is limited.
  if (availability.overall === 'available') {
    return <span className="sp-panel-muted">{label('available')}</span>;
  }
  // The detail is visible text (not a tooltip) so screen readers and touch screens get it too.
  // The detail only when training and match differ from the chip (one line under it, so the
  // row stays two lines high); when both say the same, the chip says it all.
  const sameEverywhere =
    availability.training === availability.overall && availability.match === availability.overall;
  return (
    <span className="sp-panel-availability">
      <StatusBadge
        level={AVAILABILITY_LEVELS[availability.overall]}
        label={label(availability.overall)}
      />
      {sameEverywhere ? null : (
        <span className="sp-panel-muted sp-panel-block">
          <span>{t('panel.availability.training', { status: label(availability.training) })}</span>
          {' · '}
          <span>{t('panel.availability.match', { status: label(availability.match) })}</span>
        </span>
      )}
    </span>
  );
}

interface MaturityFigures {
  /** Years from PHV, signed ("+3,2", "−0,4"); null without an offset. */
  readonly offset: string | null;
  /** % of predicted adult height ("100,5 %"); null without parents' heights. */
  readonly adultHeight: string | null;
  /** The bio-band of the grouping and the column it belongs under, when grouping by maturity. */
  readonly band: { readonly label: string; readonly column: 'offset' | 'adultHeight' } | null;
  readonly measuredOn: LocalDate;
}

function maturityFigures(
  t: ReturnType<typeof useT>,
  player: PanelPlayer,
  grouping: PanelGrouping,
): MaturityFigures | null {
  const { maturity } = player;
  if (maturity === null) return null;
  const scheme = grouping === 'category' ? null : BIO_BAND_SCHEMES[grouping];
  const value = scheme === null ? null : maturityValue(player, scheme);
  return {
    offset:
      maturity.phvOffsetYearsOnDate === null
        ? null
        : typographicMinus(
            formatNumber(maturity.phvOffsetYearsOnDate, { decimals: 1, sign: 'always' }),
          ),
    adultHeight:
      maturity.adultHeightPct === null
        ? null
        : formatUnit(maturity.adultHeightPct, 'pct', { decimals: 1 }),
    band:
      scheme === null || value === null
        ? null
        : {
            label: bandLabel(t, scheme, value),
            column: grouping === 'phv_offset' ? 'offset' : 'adultHeight',
          },
    measuredOn: maturity.measuredOn,
  };
}

/**
 * Maturity as two number columns (years from PHV, % of adult height): one figure per cell, so a
 * row stays one line high; the band of the grouping, if any, as a muted line under its figure.
 */
function MaturityCells(props: { player: PanelPlayer; grouping: PanelGrouping }) {
  const t = useT();
  const figures = maturityFigures(t, props.player, props.grouping);
  if (figures === null) {
    return (
      <>
        <td className="is-number">
          <span className="sp-panel-muted">{t('panel.roster.noMaturity')}</span>
        </td>
        <td className="is-number">{formatNumber(null)}</td>
      </>
    );
  }
  const title = t('panel.roster.measuredOn', { date: formatLocalDate(figures.measuredOn) });
  const cell = (column: 'offset' | 'adultHeight', figure: string | null) => (
    <td className="is-number" title={title}>
      {figure ?? formatNumber(null)}
      {figures.band?.column === column ? (
        <span className="sp-panel-muted sp-panel-block">{figures.band.label}</span>
      ) : null}
    </td>
  );
  return (
    <>
      {cell('offset', figures.offset)}
      {cell('adultHeight', figures.adultHeight)}
    </>
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

function Acwr(props: { load: PanelPlayer['load']; referenceDate: LocalDate }) {
  const t = useT();
  const { load } = props;
  const value =
    load.acwrStatus === 'ok' ? (
      <>{formatNumber(load.acwr, { decimals: 2 })}</>
    ) : (
      <span className="sp-panel-muted">{t(`panel.acwr.${load.acwrStatus}`)}</span>
    );
  // The worker's last row can be older than the reference day (no load since, or the worker is
  // behind): say from when the value is, instead of showing it as that day's.
  if (load.asOf === null || load.asOf >= props.referenceDate) return value;
  return (
    <>
      {value}
      <span className="sp-panel-muted sp-panel-block">
        {t('panel.acwr.asOf', { date: formatLocalDate(load.asOf) })}
      </span>
    </>
  );
}

function WellnessCell(props: { player: PanelPlayer }) {
  const t = useT();
  const score = props.player.wellness.weekMeanScore;
  if (score === null) {
    return <span className="sp-panel-muted">{t('panel.roster.noWellness')}</span>;
  }
  return (
    <span className="sp-panel-wellness">
      <span className="sp-panel-wellness__bar" aria-hidden="true">
        <span
          className="sp-panel-wellness__fill"
          style={{ width: `${String((score / 5) * 100)}%` }}
        />
      </span>
      <span className="sp-panel-wellness__value">
        {t('panel.roster.wellnessValue', { value: formatNumber(score, { decimals: 1 }) })}
      </span>
    </span>
  );
}

function StatusCell(props: { player: PanelPlayer }) {
  const t = useT();
  const severity = worstSeverity(props.player);
  return severity === null ? (
    <StatusBadge level="ok" label={t('panel.status.inRange')} />
  ) : (
    <StatusBadge level={severity} />
  );
}

function Roster(props: {
  panel: WeeklyPanel;
  players: readonly PanelPlayer[];
  grouping: PanelGrouping;
}) {
  const t = useT();
  const headingId = useId();
  // Phones get one card per player: a 9-column table would scroll sideways.
  const narrow = useMediaQuery(NARROW_QUERY);
  return (
    <section className="sp-card sp-panel-roster" aria-labelledby={headingId}>
      <div className="sp-card__heading">
        <h2 id={headingId} className="sp-card__title">
          {t('panel.roster.title')}
        </h2>
        <p className="sp-card__subtitle-text">{t('panel.roster.subtitle')}</p>
      </div>
      {props.players.length === 0 ? (
        <p>{t('panel.roster.empty')}</p>
      ) : narrow ? (
        <RosterCards
          panel={props.panel}
          players={props.players}
          grouping={props.grouping}
          labelledBy={headingId}
        />
      ) : (
        <div className="sp-panel-table-scroll">
          <table className="sp-panel-table" aria-labelledby={headingId}>
            <thead>
              <tr>
                <th scope="col">{t('panel.roster.player')}</th>
                <th scope="col">{t('panel.roster.position')}</th>
                <th scope="col" className="is-number">
                  {t('panel.roster.phvOffsetColumn')}
                </th>
                <th scope="col" className="is-number">
                  {t('panel.roster.adultHeightColumn')}
                </th>
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
                return (
                  <tr key={player.playerId}>
                    <th scope="row">
                      <span className="sp-table__cell-player">
                        <Avatar label={initialsOf(`${player.firstName} ${player.lastName}`)} />
                        <span>{playerName(t, player)}</span>
                      </span>
                    </th>
                    <td className="sp-panel-nowrap">{positionName(t, player)}</td>
                    <MaturityCells player={player} grouping={props.grouping} />
                    <td>
                      <WellnessCell player={player} />
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
                      <Acwr load={player.load} referenceDate={props.panel.referenceDate} />
                    </td>
                    <td>
                      <Availability availability={player.availability} />
                    </td>
                    <td>
                      <StatusCell player={player} />
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

/** The roster on a phone: name and status, then the figures of the week, then maturity. */
function RosterCards(props: {
  panel: WeeklyPanel;
  players: readonly PanelPlayer[];
  grouping: PanelGrouping;
  labelledBy: string;
}) {
  const t = useT();
  return (
    <ul className="sp-panel-cards" aria-labelledby={props.labelledBy}>
      {props.players.map((player) => {
        const figures = maturityFigures(t, player, props.grouping);
        const maturity =
          figures === null
            ? t('panel.roster.noMaturity')
            : [
                figures.offset === null
                  ? null
                  : t('panel.roster.phvOffset', { value: figures.offset }),
                figures.adultHeight === null
                  ? null
                  : t('panel.roster.adultHeight', { value: figures.adultHeight }),
                figures.band?.label ?? null,
              ]
                .filter((part): part is string => part !== null)
                .join(' · ') || t('panel.roster.noMaturity');
        return (
          <li key={player.playerId} className="sp-panel-cards__item">
            <div className="sp-panel-cards__head">
              <Avatar label={initialsOf(`${player.firstName} ${player.lastName}`)} />
              <div className="sp-panel-cards__who">
                <p className="sp-panel-cards__name">{playerName(t, player)}</p>
                <p className="sp-panel-muted">{positionName(t, player)}</p>
              </div>
              <StatusCell player={player} />
            </div>
            <p className="sp-panel-cards__figures">
              <span>
                {t('panel.roster.card.wellness', {
                  value:
                    player.wellness.weekMeanScore === null
                      ? t('panel.roster.noWellness')
                      : t('panel.roster.wellnessValue', {
                          value: formatNumber(player.wellness.weekMeanScore, { decimals: 1 }),
                        }),
                })}
              </span>
              <span>
                {t('panel.roster.card.load', {
                  value: formatUnit(player.load.weekLoadAu, 'au', { decimals: 0 }),
                })}
              </span>
              <span>
                {t('panel.roster.card.acwr', {
                  value:
                    player.load.acwrStatus === 'ok'
                      ? formatNumber(player.load.acwr, { decimals: 2 })
                      : t(`panel.acwr.${player.load.acwrStatus}`),
                })}
              </span>
              {player.load.pendingRpeN === 0 ? null : (
                <span className="sp-panel-muted">
                  {t('panel.roster.pendingRpe', { count: player.load.pendingRpeN })}
                </span>
              )}
            </p>
            <p className="sp-panel-muted">{t('panel.roster.card.maturity', { value: maturity })}</p>
            {player.availability === null || player.availability.overall === 'available' ? null : (
              <Availability availability={player.availability} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
