import type { TestSession } from '@sport-performance/contracts';
import type { FixtureStatus, Sport, TestSessionStatus } from '@sport-performance/domain';
import { formatLocalDate } from '@sport-performance/i18n';
import type { StatusLevel } from '@sport-performance/ui-tokens';
import { useActiveClub } from '../club/active-club';
import { useScope } from '../club/use-scope';
import { useT } from '../i18n/i18n';
import { StatusLabel } from '../ui/fields';
import { Icon } from '../ui/icons';
import type { DayEvent, WindowEvent } from './model';

/** Status of a test day or a match, as icon + text (never color alone). */
const TEST_SESSION_LEVELS: Readonly<Record<TestSessionStatus, StatusLevel | 'info'>> = {
  scheduled: 'info',
  in_progress: 'info',
  completed: 'ok',
  cancelled: 'critical',
};

const FIXTURE_LEVELS: Readonly<Record<FixtureStatus, StatusLevel | 'info'>> = {
  scheduled: 'info',
  postponed: 'warning',
  cancelled: 'critical',
};

export function TestSessionStatusLabel(props: { status: TestSessionStatus }) {
  const t = useT();
  return (
    <StatusLabel level={TEST_SESSION_LEVELS[props.status]}>
      {t(`calendar.testSession.status.${props.status}`)}
    </StatusLabel>
  );
}

export function FixtureStatusLabel(props: { status: FixtureStatus }) {
  const t = useT();
  return (
    <StatusLabel level={FIXTURE_LEVELS[props.status]}>
      {t(`calendar.fixture.status.${props.status}`)}
    </StatusLabel>
  );
}

/** Name of the category of an event (`Histórico` for an imported test day without one). */
export function useCategoryName(): (categoryId: TestSession['categoryId']) => string {
  const t = useT();
  const { categories } = useActiveClub();
  return (categoryId) =>
    categoryId === null
      ? t('calendar.event.historical')
      : (categories.find((category) => category.id === categoryId)?.name ?? '—');
}

/** Sport of a season of the screen, to name windows when it shows more than one sport. */
export type SportOfSeason = (seasonId: WindowEvent['season']['id']) => Sport | undefined;

/** `V3 · 2027` (plus the sport when the screen shows more than one). */
export function useWindowName(sportOf: SportOfSeason): (event: WindowEvent) => string {
  const t = useT();
  const scope = useScope();
  return (event) => {
    const base = t('calendar.event.windowLabel', {
      label: event.testWindow.label,
      season: event.season.name,
    });
    const sport = scope.sport === null ? sportOf(event.season.id) : undefined;
    return sport === undefined ? base : `${base} · ${t(`sport.${sport}`)}`;
  };
}

/** The window band of a day of the grid: its label as text, not only a tint. */
export function WindowBand(props: { event: WindowEvent }) {
  const t = useT();
  return (
    <p className="sp-cal__window">
      <Icon name="calendar" />
      <span>{t('calendar.day.inWindow', { label: props.event.testWindow.label })}</span>
    </p>
  );
}

/** Full text of a window: `V3 · 2027: del 01/07/2027 al 31/07/2027`. */
export function useWindowSpanText(sportOf: SportOfSeason): (event: WindowEvent) => string {
  const t = useT();
  const windowName = useWindowName(sportOf);
  return (event) =>
    t('calendar.event.windowSpan', {
      name: windowName(event),
      from: formatLocalDate(event.testWindow.startsOn),
      to: formatLocalDate(event.testWindow.endsOn),
    });
}

/**
 * One test day or match: its category (when the screen shows several), its
 * window and its status. `compact` (the grid) shows the status only when it
 * is not the expected one (scheduled); the list shows everything.
 */
export function EventSummary(props: {
  event: DayEvent;
  compact: boolean;
  showCategory: boolean;
  /** Label of the test day's own window (`V2`), `null` without one. */
  windowLabel?: string | null;
}) {
  const t = useT();
  const categoryName = useCategoryName();
  const { event } = props;

  if (event.type === 'test_session') {
    const session = event.testSession;
    const showStatus = !props.compact || session.status !== 'scheduled';
    const parts = [
      t('calendar.event.testSession'),
      props.showCategory ? categoryName(session.categoryId) : null,
      props.windowLabel ?? null,
      props.compact ? null : session.location,
    ].filter((part): part is string => part !== null);
    return (
      <span className="sp-cal__event-text">
        <Icon name="stopwatch" />
        <span className="sp-cal__event-main">{parts.join(' · ')}</span>
        {showStatus ? (
          <>
            {' '}
            <TestSessionStatusLabel status={session.status} />
          </>
        ) : null}
      </span>
    );
  }

  const fixture = event.fixture;
  const showStatus = !props.compact || fixture.status !== 'scheduled';
  const versus = t('calendar.event.vs', { opponent: fixture.opponent });
  const parts = [
    fixture.kickoffTime === null ? versus : `${fixture.kickoffTime} ${versus}`,
    props.showCategory ? categoryName(fixture.categoryId) : null,
    t(`calendar.fixture.venue.${fixture.venue}`),
    props.compact ? null : fixture.competition,
    !props.compact && fixture.kickoffTime === null ? t('calendar.event.noTime') : null,
  ].filter((part): part is string => part !== null);
  return (
    <span className="sp-cal__event-text">
      <Icon name="flag" />
      <span className="sp-cal__event-main">{parts.join(' · ')}</span>
      {showStatus ? (
        <>
          {' '}
          <FixtureStatusLabel status={fixture.status} />
        </>
      ) : null}
    </span>
  );
}
