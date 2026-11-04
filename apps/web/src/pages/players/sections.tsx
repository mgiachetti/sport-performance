import {
  CATEGORY_AVERAGE_MIN_PLAYERS,
  type AlertDto,
  type PlayerFirstTeamReference,
  type PlayerLoadDay,
  type PlayerPercentile,
  type PlayerWellnessDay,
  type TestEvolutionColumn,
  type TestEvolutionMetric,
} from '@sport-performance/contracts';
import { BarChart, LineChart, StatusBadge } from '@sport-performance/charts/web';
import type { AvailabilityStatus, LocalDate, PlayerId, UnitCode } from '@sport-performance/domain';
import {
  formatLocalDate,
  formatLocalDateLong,
  formatNumber,
  formatUnit,
  isMessageKey,
  type MessageKey,
} from '@sport-performance/i18n';
import { useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { useActiveClub } from '../../club/active-club';
import { translate, useT } from '../../i18n/i18n';
import { ErrorNotice, Loading, Notice } from '../../ui/components';
import { useServices } from '../../app/services';
import { AVAILABILITY_LEVEL, alertMessageValues, availabilityLabel, metricLabel } from './format';
import {
  availabilityQuery,
  dailyMonitoringQuery,
  evolutionQuery,
  firstTeamReferencesQuery,
  maturationQuery,
  percentilesQuery,
} from './queries';

/**
 * Blocks of the player profile (B-404). Each one loads its own data and
 * shows its own loading, error and empty states, so a denied or failing
 * block never takes the rest of the profile down. States are always icon +
 * text (`StatusBadge`, `Notice`); charts follow the rules of ADR 0056.
 */

/** A card of the profile, or the reason it is not shown. */
export function Section(props: {
  id: string;
  title: string;
  subtitle?: string;
  allowed: boolean;
  children: ReactNode;
  wide?: boolean;
}) {
  const t = useT();
  return (
    <section
      className={[
        'sp-card',
        'sp-profile__card',
        props.wide === true ? 'sp-profile__card--wide' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby={props.id}
    >
      <header>
        <h2 id={props.id} className="sp-card__title">
          {props.title}
        </h2>
        {props.subtitle === undefined ? null : (
          <p className="sp-profile__subtitle">{props.subtitle}</p>
        )}
      </header>
      {props.allowed ? (
        props.children
      ) : (
        <Notice level="info">
          <p>{t('player.section.unavailable')}</p>
        </Notice>
      )}
    </section>
  );
}

function QueryState(props: { error: unknown; pending: boolean; children: () => ReactNode }) {
  if (props.pending) return <Loading />;
  if (props.error !== null && props.error !== undefined) return <ErrorNotice error={props.error} />;
  return <>{props.children()}</>;
}

function RefreshPending(props: { pending: boolean }) {
  const t = useT();
  if (!props.pending) return null;
  return (
    <Notice level="info" role="status">
      <p>{t('player.refreshPending')}</p>
    </Notice>
  );
}

const shortDate = (date: LocalDate) => formatLocalDate(date).slice(0, 5);

// ─── Availability ────────────────────────────────────────────────────────────────────

export function AvailabilityBadge(props: { status: AvailabilityStatus }) {
  const t = useT();
  return (
    <StatusBadge
      level={AVAILABILITY_LEVEL[props.status]}
      label={availabilityLabel(t, props.status)}
    />
  );
}

export function AvailabilitySection(props: { playerId: PlayerId; allowed: boolean }) {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const query = useQuery({
    ...availabilityQuery(api, selection, props.playerId),
    enabled: props.allowed,
  });
  return (
    <Section
      id="profile-availability"
      title={t('player.availability.title')}
      subtitle={t('player.availability.subtitle')}
      allowed={props.allowed}
    >
      <QueryState error={query.error} pending={query.isPending}>
        {() => {
          const data = query.data;
          if (data === undefined) return null;
          const notAvailable = data.periods.filter((p) => p.overall !== 'available');
          return (
            <>
              <div className="sp-profile__status-row">
                <AvailabilityBadge status={data.current.overall} />
                <span>
                  {t('player.availability.training', {
                    status: availabilityLabel(t, data.current.training),
                  })}
                </span>
                <span>
                  {t('player.availability.match', {
                    status: availabilityLabel(t, data.current.match),
                  })}
                </span>
              </div>
              {data.current.staffNotes.length === 0 ? null : (
                <div>
                  <h3 className="sp-profile__minor-title">{t('player.availability.notes')}</h3>
                  <ul className="sp-profile__notes">
                    {data.current.staffNotes.map((note, index) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
              <h3 className="sp-profile__minor-title">{t('player.availability.history')}</h3>
              {notAvailable.length === 0 ? (
                <p>{t('player.availability.allAvailable')}</p>
              ) : (
                <table className="sp-profile__table">
                  <thead>
                    <tr>
                      <th scope="col">{t('player.availability.table.period')}</th>
                      <th scope="col">{t('player.availability.table.training')}</th>
                      <th scope="col">{t('player.availability.table.match')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...notAvailable].reverse().map((period) => (
                      <tr key={period.from}>
                        <th scope="row">
                          {t('player.availability.period', {
                            from: formatLocalDate(period.from),
                            to: formatLocalDate(period.to),
                          })}
                        </th>
                        <td>
                          <AvailabilityBadge status={period.training} />
                        </td>
                        <td>
                          <AvailabilityBadge status={period.match} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          );
        }}
      </QueryState>
    </Section>
  );
}

// ─── Maturation ──────────────────────────────────────────────────────────────────────

/** Years from PHV drawn on the track: −3 to +3 (outside, pinned to the ends). */
const TRACK_YEARS = 3;

export function MaturationSection(props: {
  playerId: PlayerId;
  allowed: boolean;
  /**
   * An active growth-peak alert of the player, when the caller reads alerts:
   * it sets the severity. The zone itself comes with the maturation.
   */
  peakAlert: AlertDto | null;
}) {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const query = useQuery({
    ...maturationQuery(api, selection, props.playerId),
    enabled: props.allowed,
  });
  return (
    <Section
      id="profile-maturation"
      title={t('player.maturation.title')}
      subtitle={t('player.maturation.subtitle')}
      allowed={props.allowed}
    >
      <QueryState error={query.error} pending={query.isPending}>
        {() => {
          const data = query.data;
          if (data === undefined) return null;
          const latest = data.measurements[0];
          const withOffset = data.measurements.find((m) => m.phvOffsetYears !== null);
          // Each value says the measurement it comes from: the newest with an offset (track)
          // and the newest with a growth velocity need not be the same one.
          const withVelocity = data.measurements.find((m) => m.growthVelocityCmYear !== null);
          return (
            <>
              <RefreshPending pending={data.refreshPending} />
              {data.stage === null ? null : (
                <p>
                  {t(`player.stage.${data.stage.stage}`)} ·{' '}
                  {t(`player.stage.basis.${data.stage.basis}`)}
                </p>
              )}
              {latest === undefined ? (
                <p>{t('player.maturation.empty')}</p>
              ) : withOffset === undefined || withOffset.phvOffsetYears === null ? (
                <Notice level="info">
                  <p>{t('player.maturation.noOffset')}</p>
                </Notice>
              ) : (
                <MaturityTrack
                  offsetYears={withOffset.phvOffsetYears}
                  measuredOn={withOffset.measuredOn}
                  equation={withOffset.maturityOffsetEquation}
                />
              )}
              {withOffset === undefined ? null : withOffset.adultHeightPct === null ||
                withOffset.predictedAdultHeightCm === null ? (
                <p className="sp-profile__muted">{t('player.maturation.adultHeightMissing')}</p>
              ) : (
                <p>
                  {t('player.maturation.adultHeight', {
                    pct: formatUnit(withOffset.adultHeightPct, 'pct', { decimals: 1 }),
                    height: formatUnit(withOffset.predictedAdultHeightCm, 'cm', { decimals: 0 }),
                  })}
                </p>
              )}
              {withVelocity === undefined || withVelocity.growthVelocityCmYear === null ? null : (
                <p>
                  {t('player.maturation.velocity', {
                    velocity: formatUnit(withVelocity.growthVelocityCmYear, 'cm_year', {
                      decimals: 1,
                    }),
                    date: formatLocalDate(withVelocity.measuredOn),
                  })}
                </p>
              )}
              {props.peakAlert === null && data.peakZone?.inZone !== true ? null : (
                <Notice level={props.peakAlert?.currentSeverity ?? 'warning'}>
                  <p>{t('player.maturation.peakZone')}</p>
                </Notice>
              )}
            </>
          );
        }}
      </QueryState>
    </Section>
  );
}

function MaturityTrack(props: {
  offsetYears: number;
  measuredOn: LocalDate;
  equation: string | null;
}) {
  const t = useT();
  const clamped = Math.max(-TRACK_YEARS, Math.min(TRACK_YEARS, props.offsetYears));
  const left = ((clamped + TRACK_YEARS) / (2 * TRACK_YEARS)) * 100;
  const years = formatNumber(props.offsetYears, { decimals: 1 });
  const rounded = Number(props.offsetYears.toFixed(1));
  const offsetText = t('player.maturation.offset', {
    offset: rounded > 0 ? 'positive' : rounded < 0 ? 'negative' : 'zero',
    years,
  });
  const equationKey = `player.maturation.equation.${props.equation ?? ''}`;
  return (
    <div className="sp-maturity">
      <div className="sp-maturity__labels" aria-hidden="true">
        <span>{t('player.maturation.before')}</span>
        <span>{t('player.maturation.peak')}</span>
        <span>{t('player.maturation.after')}</span>
      </div>
      <div
        className="sp-maturity__track"
        role="img"
        aria-label={t('player.maturation.offsetTrack', { value: offsetText })}
      >
        <span className="sp-maturity__pin" style={{ left: `${String(left)}%` }} />
      </div>
      <p className="sp-maturity__value">{offsetText}</p>
      <p className="sp-profile__muted">
        {t('player.maturation.measuredOn', {
          date: formatLocalDate(props.measuredOn),
          equation: isMessageKey(equationKey) ? translate(t, equationKey) : '—',
        })}
      </p>
    </div>
  );
}

// ─── Evolution by window ─────────────────────────────────────────────────────────────

function columnLabel(t: ReturnType<typeof useT>, column: TestEvolutionColumn): string {
  if (column.number === null) return formatLocalDate(column.startsOn);
  return t('player.evolution.window', {
    number: column.number,
    season: column.seasonName ?? column.startsOn.slice(0, 4),
  });
}

const metricKey = (metric: Pick<TestEvolutionMetric, 'metricCode' | 'exercise'>) =>
  `${metric.metricCode}|${metric.exercise ?? ''}`;

export function EvolutionSection(props: {
  playerId: PlayerId;
  playerName: string;
  categoryName: string | null;
  allowed: boolean;
}) {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const selectId = useId();
  const query = useQuery({
    ...evolutionQuery(api, selection, props.playerId),
    enabled: props.allowed,
  });
  const references = useQuery({
    ...firstTeamReferencesQuery(api, selection, props.playerId),
    enabled: props.allowed,
  });
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <Section
      id="profile-evolution"
      title={t('player.evolution.title')}
      subtitle={t('player.evolution.subtitle')}
      allowed={props.allowed}
      wide
    >
      <QueryState error={query.error} pending={query.isPending}>
        {() => {
          const data = query.data;
          if (data === undefined) return null;
          const metric = data.metrics.find((m) => metricKey(m) === chosen) ?? data.metrics[0];
          if (metric === undefined) return <p>{t('player.evolution.empty')}</p>;
          return (
            <>
              <div className="sp-field sp-profile__select">
                <label htmlFor={selectId} className="sp-field__label">
                  {t('player.evolution.metric')}
                </label>
                <select
                  id={selectId}
                  className="sp-field__input"
                  value={metricKey(metric)}
                  onChange={(event) => {
                    setChosen(event.target.value);
                  }}
                >
                  {data.metrics.map((m) => (
                    <option key={metricKey(m)} value={metricKey(m)}>
                      {metricLabel(t, m.metricCode, m.exercise)}
                    </option>
                  ))}
                </select>
              </div>
              <EvolutionChart
                metric={metric}
                columns={data.columns}
                playerName={props.playerName}
                categoryName={props.categoryName}
                // References carry only a metric code: a strength metric (one per
                // exercise) gets none until a first-team reference also names its exercise.
                reference={
                  metric.exercise === null
                    ? references.data?.items.find((r) => r.metricCode === metric.metricCode)
                    : undefined
                }
              />
            </>
          );
        }}
      </QueryState>
    </Section>
  );
}

function EvolutionChart(props: {
  metric: TestEvolutionMetric;
  columns: readonly TestEvolutionColumn[];
  playerName: string;
  categoryName: string | null;
  reference: PlayerFirstTeamReference | undefined;
}) {
  const t = useT();
  const { metric } = props;
  const byKey = new Map(metric.points.map((p) => [p.columnKey, p]));
  const columns = props.columns.filter((c) => byKey.has(c.key));
  const points = columns.map((c) => byKey.get(c.key));
  const groupMixed = points.some((p) => p?.categoryMixedMethods === true);
  const groupMixedProtocols = points.some((p) => p?.categoryMixedProtocolVersions === true);
  return (
    <>
      {metric.warnings.includes('mixed_methods') ? (
        <Notice level="warning">
          <p>{t('player.evolution.mixedMethods')}</p>
        </Notice>
      ) : null}
      {metric.warnings.includes('mixed_protocol_versions') ? (
        <Notice level="warning">
          <p>{t('player.evolution.mixedProtocols')}</p>
        </Notice>
      ) : null}
      {groupMixed ? (
        <Notice level="info">
          <p>{t('player.evolution.mixedGroupMethods')}</p>
        </Notice>
      ) : null}
      {groupMixedProtocols ? (
        <Notice level="info">
          <p>{t('player.evolution.mixedGroupProtocols')}</p>
        </Notice>
      ) : null}
      <LineChart
        description={t('player.evolution.description', {
          direction: metric.direction,
          min: CATEGORY_AVERAGE_MIN_PLAYERS,
        })}
        spec={{
          title: metricLabel(t, metric.metricCode, metric.exercise),
          format: { unit: metric.unit },
          categories: columns.map((c) => ({ key: c.key, label: columnLabel(t, c) })),
          series: [
            {
              id: 'player',
              role: 'player',
              label: props.playerName,
              values: points.map((p) => p?.value ?? null),
            },
            {
              id: 'category',
              role: 'categoryAverage',
              label:
                props.categoryName === null
                  ? t('player.evolution.categoryAverageGeneric')
                  : t('player.evolution.categoryAverage', { category: props.categoryName }),
              values: points.map((p) => p?.categoryAverage ?? null),
            },
          ],
          ...(props.reference === undefined ? {} : { reference: { value: props.reference.value } }),
        }}
      />
    </>
  );
}

// ─── Percentiles ─────────────────────────────────────────────────────────────────────

function groupText(t: ReturnType<typeof useT>, item: PlayerPercentile): string {
  if (item.grouping === null) return '';
  const parts: string[] = item.grouping.dimensions.map((d) =>
    translate(t, `player.percentiles.group.${d}` as MessageKey),
  );
  parts.push(t('player.percentiles.group.seasons', { count: item.grouping.seasonsAccumulated }));
  return parts.join(', ');
}

const valueText = (value: number, unit: UnitCode) => formatUnit(value, unit);

export function PercentilesSection(props: { playerId: PlayerId; allowed: boolean }) {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const query = useQuery({
    ...percentilesQuery(api, selection, props.playerId),
    enabled: props.allowed,
  });
  return (
    <Section
      id="profile-percentiles"
      title={t('player.percentiles.title')}
      subtitle={t('player.percentiles.subtitle')}
      allowed={props.allowed}
    >
      <QueryState error={query.error} pending={query.isPending}>
        {() => {
          const data = query.data;
          if (data === undefined) return null;
          if (data.items.length === 0) return <p>{t('player.percentiles.empty')}</p>;
          return (
            <ul className="sp-percentiles">
              {data.items.map((item) => {
                const label = metricLabel(t, item.metricCode, item.exercise);
                const key = `${item.metricCode}|${item.exercise ?? ''}`;
                if (item.status === 'insufficient_sample' || item.percentile === null) {
                  return (
                    <li key={key} className="sp-percentiles__row">
                      <span className="sp-percentiles__label">{label}</span>
                      <span className="sp-profile__muted">
                        {t('player.percentiles.insufficient', { min: data.minSampleSize })}
                      </span>
                    </li>
                  );
                }
                const percentile = Math.round(item.percentile);
                return (
                  <li key={key} className="sp-percentiles__row">
                    <span className="sp-percentiles__label">{label}</span>
                    <span className="sp-percentiles__track" aria-hidden="true">
                      <span
                        className="sp-percentiles__bar"
                        style={{ width: `${String(percentile)}%` }}
                      />
                      <span className="sp-percentiles__median" />
                    </span>
                    <span className="sp-percentiles__value">
                      {t('player.percentiles.value', { percentile })}
                    </span>
                    <span className="sp-percentiles__detail sp-profile__muted">
                      {t('player.percentiles.detail', {
                        value: valueText(item.value, item.unit),
                        date: formatLocalDate(item.measuredOn),
                        group: groupText(t, item),
                        count: item.sampleSize ?? 0,
                      })}
                      {item.median === null
                        ? null
                        : ` · ${t('player.percentiles.median', {
                            value: valueText(item.median, item.unit),
                          })}`}
                      {item.mixedMethods ? ` · ${t('player.percentiles.mixedMethods')}` : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </QueryState>
    </Section>
  );
}

// ─── Load of the last 28 days ────────────────────────────────────────────────────────

function LoadTiles(props: {
  latest: PlayerLoadDay | undefined;
  wellnessToday: PlayerWellnessDay | undefined;
  acwrAlert: AlertDto | null;
  pendingRpe: number;
}) {
  const t = useT();
  const { latest } = props;
  return (
    <dl className="sp-tiles">
      <div className="sp-tile">
        <dt>{t('player.load.acwrLabel')}</dt>
        <dd>
          {latest === undefined || latest.acwrStatus === 'insufficient_history' ? (
            // Not an alert (CLAUDE.md: no ACWR alert without 28 days): neutral text, no badge.
            <span className="sp-profile__muted">{t('status.insufficientHistory')}</span>
          ) : latest.acwrStatus === 'zero_chronic_load' || latest.acwr === null ? (
            <span>{t('player.load.acwrZeroChronic')}</span>
          ) : (
            <>
              <span className="sp-tile__value">{formatNumber(latest.acwr, { decimals: 2 })}</span>
              {props.acwrAlert === null ? null : (
                <StatusBadge level={props.acwrAlert.currentSeverity} />
              )}
            </>
          )}
        </dd>
      </div>
      <div className="sp-tile">
        <dt>{t('player.load.week')}</dt>
        <dd className="sp-tile__value">
          {formatUnit(latest?.weekLoadAu ?? null, 'au', { decimals: 0 })}
        </dd>
      </div>
      <div className="sp-tile">
        <dt>{t('player.load.monotony')}</dt>
        <dd className="sp-tile__value">
          {formatNumber(latest?.monotony ?? null, { decimals: 2 })}
        </dd>
      </div>
      <div className="sp-tile">
        <dt>{t('player.load.strain')}</dt>
        <dd className="sp-tile__value">
          {formatUnit(latest?.strainAu ?? null, 'au', { decimals: 0 })}
        </dd>
      </div>
      <div className="sp-tile">
        <dt>{t('player.load.wellness')}</dt>
        <dd>
          {props.wellnessToday === undefined ? (
            <span>{t('player.load.wellnessNone')}</span>
          ) : (
            <span className="sp-tile__value">
              {t('player.load.wellnessValue', {
                score: formatNumber(props.wellnessToday.meanScore, { decimals: 1 }),
              })}
            </span>
          )}
        </dd>
      </div>
    </dl>
  );
}

export function LoadSection(props: {
  playerId: PlayerId;
  allowed: boolean;
  acwrAlert: AlertDto | null;
}) {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const query = useQuery({
    ...dailyMonitoringQuery(api, selection, props.playerId),
    enabled: props.allowed,
  });
  return (
    <Section
      id="profile-load"
      title={t('player.load.title')}
      subtitle={t('player.load.subtitle')}
      allowed={props.allowed}
    >
      <QueryState error={query.error} pending={query.isPending}>
        {() => {
          const data = query.data;
          if (data === undefined) return null;
          const latest = data.load.at(-1);
          const pendingRpe = data.load.reduce((sum, d) => sum + d.pendingRpe, 0);
          // Reported by the player outside the club (B-511): part of the daily load, said apart.
          const externalLoadAu = data.load.reduce((sum, d) => sum + d.externalLoadAu, 0);
          const externalActivities = data.load.reduce((sum, d) => sum + d.externalActivities, 0);
          const wellnessToday = data.wellness.find((w) => w.date === data.today);
          return (
            <>
              <RefreshPending pending={data.refreshPending} />
              <LoadTiles
                latest={latest}
                wellnessToday={wellnessToday}
                acwrAlert={props.acwrAlert}
                pendingRpe={pendingRpe}
              />
              {pendingRpe === 0 ? null : (
                <Notice level="info">
                  <p>{t('player.load.pendingRpe', { count: pendingRpe })}</p>
                </Notice>
              )}
              {externalActivities === 0 ? null : (
                <Notice level="info">
                  <p>
                    {t('player.load.external', {
                      load: formatUnit(externalLoadAu, 'au', { decimals: 0 }),
                      count: externalActivities,
                    })}
                  </p>
                </Notice>
              )}
              {data.load.every((d) => !d.hasData) ? (
                <p>{t('player.load.empty')}</p>
              ) : (
                <BarChart
                  spec={{
                    title: t('player.load.daily'),
                    format: { unit: 'au', decimals: 0 },
                    valueLabel: t('player.load.daily'),
                    tones: { brand: t('player.load.daily') },
                    bars: data.load.map((d) => ({
                      key: d.date,
                      label: shortDate(d.date),
                      name: formatLocalDateLong(d.date),
                      value: d.hasData ? d.loadAu : 0,
                      tone: 'brand',
                    })),
                    overlay: {
                      label: t('player.load.chronic'),
                      values: data.load.map((d) => d.chronicEwmaAu),
                    },
                    directLabel: 'none',
                  }}
                />
              )}
            </>
          );
        }}
      </QueryState>
    </Section>
  );
}

// ─── Alerts ──────────────────────────────────────────────────────────────────────────

export function AlertsSection(props: {
  allowed: boolean;
  alerts: { data: readonly AlertDto[] | undefined; error: unknown; pending: boolean };
}) {
  const t = useT();
  return (
    <Section
      id="profile-alerts"
      title={t('player.alerts.title')}
      subtitle={t('player.alerts.subtitle')}
      allowed={props.allowed}
    >
      <QueryState error={props.alerts.error} pending={props.alerts.pending}>
        {() => {
          const alerts = props.alerts.data ?? [];
          if (alerts.length === 0) return <p>{t('player.alerts.empty')}</p>;
          return (
            <ul className="sp-alert-list">
              {alerts.map((alert) => (
                <li key={alert.id} className="sp-alert-list__item">
                  <div className="sp-profile__status-row">
                    <StatusBadge level={alert.severity} />
                    <span>
                      {alert.resolvedOn === null
                        ? t('player.alerts.active')
                        : t('player.alerts.resolvedOn', {
                            date: formatLocalDate(alert.resolvedOn),
                          })}
                    </span>
                    <span className="sp-profile__muted">
                      {t(`player.alerts.review.${alert.status}`)}
                    </span>
                  </div>
                  <p>
                    {isMessageKey(alert.messageKey)
                      ? translate(t, alert.messageKey, alertMessageValues(alert.values))
                      : alert.ruleCode}
                  </p>
                  <p className="sp-profile__muted">
                    {t('player.alerts.raisedOn', { date: formatLocalDate(alert.raisedOn) })}
                  </p>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>
    </Section>
  );
}
