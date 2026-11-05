import { ApiError, type AlertDto, type Player } from '@sport-performance/contracts';
import {
  CONSENT_TYPES,
  decimalAgeYears,
  isOfAge,
  localDateInTimeZone,
  parsePlayerId,
  type PlayerFacts,
  type PlayerId,
} from '@sport-performance/domain';
import { formatLocalDate, formatNumber, formatUnit } from '@sport-performance/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useServices } from '../../app/services';
import { useActiveClub } from '../../club/active-club';
import { useT } from '../../i18n/i18n';
import './players.css';
import { useCan } from '../../permissions/permissions';
import { Avatar, buttonClass, ErrorNotice, Loading, Notice, Page } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { initialsOf } from '../../lib/initials';
import { GymSection } from '../../gym/GymSection';
import { positionName } from '../../lib/positions';
import {
  availabilityQuery,
  maturationQuery,
  playerAlertsQuery,
  playerQuery,
  positionsQuery,
} from './queries';
import {
  AlertsSection,
  AvailabilityBadge,
  AvailabilitySection,
  EvolutionSection,
  LoadSection,
  MaturationSection,
  PercentilesSection,
} from './sections';

/**
 * Profile of one player (B-404, pantalla 2): header, availability (never the
 * cause), maturation, evolution by test window, percentiles, load of the last
 * 28 days and the history of alerts. Each block is gated by the permission
 * matrix for this player; the API decides again.
 */
export function PlayerProfilePage(props: { playerId: string }) {
  const t = useT();
  const playerId = parsedPlayerId(props.playerId);
  if (playerId === null) {
    return (
      <Page title={t('player.title')} actions={<BackLink />}>
        <NotFound />
      </Page>
    );
  }
  return <Profile playerId={playerId} />;
}

function parsedPlayerId(value: string): PlayerId | null {
  try {
    return parsePlayerId(value);
  } catch {
    return null;
  }
}

function NotFound() {
  const t = useT();
  return (
    <Notice level="info">
      <p>{t('player.notFound')}</p>
    </Notice>
  );
}

function BackLink() {
  const t = useT();
  return (
    <Link to="/players" activeOptions={{ exact: true }} className={buttonClass('secondary', 'sm')}>
      <Icon name="chevronLeft" />
      <span>{t('player.back')}</span>
    </Link>
  );
}

function Profile(props: { playerId: PlayerId }) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const query = useQuery(playerQuery(api, active.selection, props.playerId));

  if (query.isPending) {
    return (
      <Page title={t('player.title')}>
        <Loading />
      </Page>
    );
  }
  if (query.error !== null) {
    return (
      <Page title={t('player.title')} actions={<BackLink />}>
        {query.error instanceof ApiError && query.error.status === 404 ? (
          <NotFound />
        ) : (
          <ErrorNotice error={query.error} />
        )}
      </Page>
    );
  }
  return <ProfileBody player={query.data} />;
}

function ProfileBody(props: { player: Player }) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const { player } = props;
  const today = localDateInTimeZone(new Date(), active.club.timeZone);
  const facts: PlayerFacts = {
    id: player.id,
    sport: player.sport,
    categoryIds: player.currentCategoryIds,
    ofAge: isOfAge(player.birthDate, today),
  };
  const target = { player: facts };
  const readsResults = useCan('test_result', 'read', target);
  const readsGroup = useCan('group_reference', 'read', target);
  const readsLoad = useCan('load_metrics', 'read', target);
  const readsWellness = useCan('wellness', 'read', target);
  const can = {
    availability: useCan('availability', 'read', target),
    maturation: useCan('anthropometry', 'read', target),
    evolution: readsResults && readsGroup,
    percentiles: useCan('percentile', 'read', target),
    load: readsLoad && readsWellness,
    alerts: useCan('alert', 'read', target),
    gym: useCan('gym_set', 'read', target),
    // The consent of each player is the API's to check: here, whether the role logs sets at all.
    logGym: useCan('gym_set', 'log', { player: { ...facts, consents: [...CONSENT_TYPES] } }),
  };

  const alertsQuery = useQuery({
    ...playerAlertsQuery(api, active.selection, player.id),
    enabled: can.alerts,
  });
  const alerts = alertsQuery.data?.items;
  const activeAlert = (kinds: readonly AlertDto['kind'][]): AlertDto | null =>
    alerts?.find((a) => a.resolvedOn === null && kinds.includes(a.kind)) ?? null;
  const maturation = useQuery({
    ...maturationQuery(api, active.selection, player.id),
    enabled: can.maturation,
  });
  const positions = useQuery(positionsQuery(api, active.selection));
  // Same query as the availability block: one request for both.
  const availability = useQuery({
    ...availabilityQuery(api, active.selection, player.id),
    enabled: can.availability,
  });
  const availableNow = availability.data?.current.overall;

  const name = `${player.firstName} ${player.lastName}`;
  const categories = player.currentCategoryIds
    .map((id) => active.categories.find((c) => c.id === id))
    .filter((c) => c !== undefined);
  const categoryName = categories.map((c) => c.name).join(', ');
  const mainPosition = positions.data?.find((p) => p.id === player.positionIds[0]);
  // Height and weight are anthropometry: only who reads it for this player sees them
  // (`anthropometry.read`, not the guardian), so they come from the maturation query.
  const lastMeasure = maturation.data?.measurements.find(
    (m) => m.heightCm !== null || m.weightKg !== null,
  );

  return (
    <Page title={name} subtitle={t('player.subtitle')} actions={<BackLink />}>
      <section className="sp-card sp-profile__hero" aria-label={t('player.title')}>
        <Avatar label={initialsOf(name)} size="lg" />
        <ul className="sp-profile__facts">
          {availableNow === undefined ? null : (
            <li aria-label={t('player.availabilityNow')} className="sp-profile__fact">
              <span className="sp-profile__fact-label" aria-hidden="true">
                {t('player.fact.availability')}
              </span>
              <span className="sp-profile__fact-value">
                <AvailabilityBadge status={availableNow} />
              </span>
            </li>
          )}
          <li className="sp-profile__fact">
            <span className="sp-profile__fact-label">{t('player.fact.category')}</span>
            <span className="sp-profile__fact-value">
              {categoryName === '' ? t('player.noCategory') : categoryName}
            </span>
          </li>
          {mainPosition === undefined ? null : (
            <li className="sp-profile__fact">
              <span className="sp-profile__fact-label">{t('player.fact.position')}</span>
              <span className="sp-profile__fact-value">{positionName(t, mainPosition)}</span>
            </li>
          )}
          <li className="sp-profile__fact">
            <span className="sp-profile__fact-label">{t('player.fact.age')}</span>
            <span className="sp-profile__fact-value">
              {t('player.age', {
                age: formatNumber(decimalAgeYears(player.birthDate, today), { decimals: 1 }),
              })}
            </span>
          </li>
          {lastMeasure === undefined ? null : (
            <li className="sp-profile__fact">
              <span className="sp-profile__fact-label">{t('player.fact.measure')}</span>
              <span className="sp-profile__fact-value">
                {t('player.lastMeasure', {
                  height: formatUnit(lastMeasure.heightCm, 'cm', { decimals: 0 }),
                  weight: formatUnit(lastMeasure.weightKg, 'kg', { decimals: 0 }),
                  date: formatLocalDate(lastMeasure.measuredOn),
                })}
              </span>
            </li>
          )}
          {player.leftOn === null ? null : (
            <li className="sp-profile__fact">
              <span className="sp-profile__fact-value">
                {t('player.left', { date: formatLocalDate(player.leftOn) })}
              </span>
            </li>
          )}
        </ul>
      </section>
      {/* Three short cards side by side (status, maturation, alerts), then the blocks with charts
          and long lists across the whole width. */}
      <div className="sp-profile__grid">
        <AvailabilitySection playerId={player.id} allowed={can.availability} />
        <MaturationSection
          playerId={player.id}
          allowed={can.maturation}
          peakAlert={activeAlert(['growth_peak'])}
        />
        <AlertsSection
          allowed={can.alerts}
          alerts={{ data: alerts, error: alertsQuery.error, pending: alertsQuery.isPending }}
        />
        <LoadSection
          playerId={player.id}
          allowed={can.load}
          acwrAlert={activeAlert(['acwr_high', 'acwr_low'])}
        />
        <EvolutionSection
          playerId={player.id}
          playerName={name}
          categoryName={categories[0]?.name ?? null}
          allowed={can.evolution}
        />
        <PercentilesSection playerId={player.id} allowed={can.percentiles} />
        <GymSection playerId={player.id} playerName={name} allowed={can.gym} canLog={can.logGym} />
      </div>
    </Page>
  );
}
