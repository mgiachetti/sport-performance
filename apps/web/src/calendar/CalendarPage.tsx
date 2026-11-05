import type { CalendarEvent, Category, Fixture, TestSession } from '@sport-performance/contracts';
import {
  can,
  compareLocalDates,
  localDateInTimeZone,
  spanContainsDate,
  type LocalDate,
  type TimeZone,
} from '@sport-performance/domain';
import { formatLocalMonth } from '@sport-performance/i18n';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useScope } from '../club/use-scope';
import { useT } from '../i18n/i18n';
import { categoryFacts, RequirePermission, useCan } from '../permissions/permissions';
import { Button, ErrorNotice, Loading, Notice, Page, SegmentedControl } from '../ui/components';
import { Icon } from '../ui/icons';
import { FixtureEditor } from './FixtureEditor';
import {
  addMonths,
  eventsFromLists,
  monthGrid,
  monthKey,
  monthOf,
  monthSpan,
  parseMonth,
  type CalendarView,
  type DayEvent,
} from './model';
import {
  categoryCalendarQuery,
  fixturesInRangeQuery,
  seasonsQuery,
  testSessionsInRangeQuery,
} from './queries';
import { SeasonsSection } from './SeasonsSection';
import { versionKey } from './shared';
import { TestSessionEditor } from './TestSessionEditor';
import { AgendaView, MonthGridView } from './views';
import './calendar.css';

const route = getRouteApi('/_authed/_club/calendar');

type ManagedKind = 'test_session' | 'training_session';

/**
 * The open editor. The day or match is the one read when it was opened; the
 * editor shows its current copy among the fetched events (`freshSession`,
 * `freshFixture`), keyed by its version, so after a `409` the refetch opens
 * it again on what changed and the next save sends the new version
 * (ADR 0032). `reloaded`: it was opened again after a conflict.
 */
type Editor =
  | {
      readonly kind: 'testSession';
      readonly session: TestSession | null;
      readonly reloaded: boolean;
    }
  | { readonly kind: 'fixture'; readonly fixture: Fixture | null; readonly reloaded: boolean };

/**
 * Season calendar (B-406): testing windows, scheduled test days and the
 * fixture of the sport and category picked in the layout, as a month grid
 * or a list, plus the seasons and their windows V1–V4. Who may schedule,
 * add matches or plan windows gets the actions; the API decides again.
 */
export function CalendarPage() {
  const t = useT();
  const scope = useScope();
  const subtitle =
    scope.category !== null
      ? t('calendar.subtitle.category', { category: scope.category.name })
      : scope.sport !== null && scope.sports.length > 1
        ? t('calendar.subtitle.sport', { sport: t(`sport.${scope.sport}`) })
        : t('calendar.subtitle.all');
  return (
    <Page title={t('calendar.title')} subtitle={subtitle}>
      <RequirePermission kind="season" action="read">
        <CalendarScreen />
      </RequirePermission>
    </Page>
  );
}

/** How often the club's day is checked again, so an open screen follows midnight. */
const TODAY_CHECK_MS = 60_000;

/** Today in the club's time zone, updated when the day changes while the screen is open. */
function useClubToday(timeZone: TimeZone): LocalDate {
  const [today, setToday] = useState(() => localDateInTimeZone(Date.now(), timeZone));
  useEffect(() => {
    const check = () => {
      const now = localDateInTimeZone(Date.now(), timeZone);
      setToday((previous) => (previous === now ? previous : now));
    };
    check();
    const timer = window.setInterval(check, TODAY_CHECK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [timeZone]);
  return today;
}

function CalendarScreen() {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const scope = useScope();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  // The club's day (`today` of the grid, default month), kept current past midnight.
  const today = useClubToday(active.club.timeZone);
  const month = parseMonth(search.month) ?? monthOf(today);
  const view: CalendarView = search.view ?? 'month';
  const grid = monthGrid(month);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const canReadTestSessions = useCan('test_session', 'read');
  const canReadFixtures = useCan('training_session', 'read');
  const category = scope.category;

  const seasons = useQuery(seasonsQuery(api, active.selection, scope.sport, 'active'));
  const categoryCalendar = useQuery({
    ...categoryCalendarQuery(
      api,
      active.selection,
      // Disabled without a category; the key still needs a value.
      category?.id ?? ('' as Category['id']),
      grid.range,
    ),
    enabled: category !== null,
  });
  const testSessions = useQuery({
    ...testSessionsInRangeQuery(api, active.selection, scope.sport, grid.range),
    enabled: category === null && canReadTestSessions,
  });
  const fixtures = useQuery({
    ...fixturesInRangeQuery(api, active.selection, scope.sport, grid.range),
    enabled: category === null && canReadFixtures,
  });

  const sources =
    category !== null
      ? [categoryCalendar]
      : [
          seasons,
          ...(canReadTestSessions ? [testSessions] : []),
          ...(canReadFixtures ? [fixtures] : []),
        ];
  const pending = sources.some((query) => query.isPending);
  const error = sources.find((query) => query.isError)?.error;

  const events: CalendarEvent[] =
    category !== null
      ? (categoryCalendar.data ?? [])
      : eventsFromLists({
          seasons: seasons.data ?? [],
          testSessions: testSessions.data ?? [],
          fixtures: fixtures.data ?? [],
          range: grid.range,
        });

  const sportOfSeason = (seasonId: string) =>
    seasons.data?.find((season) => season.id === seasonId)?.sport;

  // Categories of the scope where the user may schedule or add matches (ADR 0025).
  const manageable = (kind: ManagedKind, target: Category) =>
    can(active.subject, 'manage', {
      kind,
      clubId: active.subject.clubId,
      category: categoryFacts(target),
    });
  const inScope = category === null ? scope.categoryOptions : [category];
  const schedulable = inScope.filter((target) => manageable('test_session', target));
  const fixtureCategories = inScope.filter((target) => manageable('training_session', target));
  const canManageCategory = (kind: ManagedKind, categoryId: Category['id'] | null) => {
    const target = active.categories.find((candidate) => candidate.id === categoryId);
    return target !== undefined && manageable(kind, target);
  };

  // New items default to today when it is in the month shown, else to its first day.
  const span = monthSpan(month);
  const defaultDate: LocalDate = spanContainsDate(span, today) ? today : span.startsOn;

  const goTo = (next: { month?: string; view?: CalendarView }) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        month: next.month ?? previous.month,
        view: (next.view ?? previous.view) === 'list' ? 'list' : undefined,
      }),
    });
  };
  const thisMonth = monthOf(today);
  const showingThisMonth = month.year === thisMonth.year && month.month === thisMonth.month;

  const open = (event: DayEvent) => {
    setFlash(null);
    setEditor(
      event.type === 'test_session'
        ? { kind: 'testSession', session: event.testSession, reloaded: false }
        : { kind: 'fixture', fixture: event.fixture, reloaded: false },
    );
  };
  const done = (message: string) => {
    setEditor(null);
    setFlash(message);
  };
  const close = () => {
    setEditor(null);
  };
  const conflicted = () => {
    setEditor((previous) => (previous === null ? null : { ...previous, reloaded: true }));
  };

  // The open day or match as fetched now (it may have changed since it was opened).
  const session =
    editor?.kind === 'testSession' && editor.session !== null
      ? freshSession(events, editor.session)
      : null;
  const fixture =
    editor?.kind === 'fixture' && editor.fixture !== null
      ? freshFixture(events, editor.fixture)
      : null;

  if (scope.categoryOptions.length === 0) {
    return (
      <Notice level="info">
        <p>{t('calendar.noCategories')}</p>
      </Notice>
    );
  }

  const viewProps = {
    month,
    grid,
    events,
    today,
    showCategory: category === null,
    sportOfSeason,
    onOpen: open,
  };
  const hasEvents = events.some(
    (event) =>
      compareLocalDates(event.endDate, span.startsOn) >= 0 &&
      compareLocalDates(event.date, span.endsOn) <= 0,
  );

  return (
    <>
      <div className="sp-cal__toolbar" role="group" aria-label={t('calendar.toolbar.label')}>
        <div className="sp-cal__month-nav">
          <Button
            variant="ghost"
            aria-label={t('calendar.month.previous')}
            onClick={() => {
              goTo({ month: monthKey(addMonths(month, -1)) });
            }}
          >
            <Icon name="chevronLeft" />
          </Button>
          <h2 className="sp-cal__month" aria-live="polite">
            {formatLocalMonth(month.year, month.month)}
          </h2>
          <Button
            variant="ghost"
            aria-label={t('calendar.month.next')}
            onClick={() => {
              goTo({ month: monthKey(addMonths(month, 1)) });
            }}
          >
            <Icon name="chevronRight" />
          </Button>
          {showingThisMonth ? null : (
            <Button
              variant="secondary"
              onClick={() => {
                goTo({ month: monthKey(thisMonth) });
              }}
            >
              {t('calendar.month.current')}
            </Button>
          )}
        </div>
        <SegmentedControl
          label={t('calendar.view.label')}
          hideLabel
          options={(['month', 'list'] as const).map((option) => ({
            value: option,
            label: t(`calendar.view.${option}`),
          }))}
          value={view}
          onChange={(option) => {
            goTo({ view: option });
          }}
        />
        <div className="sp-form__actions">
          {schedulable.length > 0 ? (
            <Button
              variant="secondary"
              onClick={() => {
                setFlash(null);
                setEditor({ kind: 'testSession', session: null, reloaded: false });
              }}
            >
              <Icon name="plus" />
              <span>{t('calendar.action.newTestSession')}</span>
            </Button>
          ) : null}
          {fixtureCategories.length > 0 ? (
            <Button
              variant="secondary"
              onClick={() => {
                setFlash(null);
                setEditor({ kind: 'fixture', fixture: null, reloaded: false });
              }}
            >
              <Icon name="plus" />
              <span>{t('calendar.action.newFixture')}</span>
            </Button>
          ) : null}
        </div>
      </div>

      <ul className="sp-cal__legend" aria-label={t('calendar.legend.label')}>
        <li>
          <Icon name="calendar" />
          <span>{t('calendar.event.window')}</span>
        </li>
        {canReadTestSessions ? (
          <li>
            <Icon name="stopwatch" />
            <span>{t('calendar.event.testSession')}</span>
          </li>
        ) : null}
        {canReadFixtures ? (
          <li>
            <Icon name="flag" />
            <span>{t('calendar.event.fixture')}</span>
          </li>
        ) : null}
      </ul>

      {flash === null ? null : (
        <Notice level="ok" role="status">
          <p>{flash}</p>
        </Notice>
      )}

      {editor?.kind === 'testSession' ? (
        <TestSessionEditor
          key={versionKey(session)}
          session={session}
          categories={schedulable}
          defaultCategoryId={category?.id ?? null}
          defaultDate={defaultDate}
          seasons={seasons.data ?? []}
          canManage={session === null || canManageCategory('test_session', session.categoryId)}
          reloaded={editor.reloaded}
          onConflict={conflicted}
          onDone={done}
          onClose={close}
        />
      ) : null}
      {editor?.kind === 'fixture' ? (
        <FixtureEditor
          key={versionKey(fixture)}
          fixture={fixture}
          categories={fixtureCategories}
          defaultCategoryId={category?.id ?? null}
          defaultDate={defaultDate}
          canManage={fixture === null || canManageCategory('training_session', fixture.categoryId)}
          reloaded={editor.reloaded}
          onConflict={conflicted}
          onDone={done}
          onClose={close}
        />
      ) : null}

      {error === undefined ? null : <ErrorNotice error={error} />}
      {pending && error === undefined ? <Loading /> : null}
      {!pending && error === undefined ? (
        <>
          {hasEvents ? null : (
            <Notice level="info" role="status">
              <p>{t('calendar.empty')}</p>
            </Notice>
          )}
          {view === 'month' ? <MonthGridView {...viewProps} /> : <AgendaView {...viewProps} />}
        </>
      ) : null}

      <SeasonsSection
        today={today}
        onDone={(message) => {
          setFlash(message);
        }}
      />
    </>
  );
}

/** The current copy of a test day among the events, or the one read if it is not in view. */
function freshSession(events: readonly CalendarEvent[], read: TestSession): TestSession {
  for (const event of events) {
    if (event.type === 'test_session' && event.testSession.id === read.id) return event.testSession;
  }
  return read;
}

/** The current copy of a match among the events, or the one read if it is not in view. */
function freshFixture(events: readonly CalendarEvent[], read: Fixture): Fixture {
  for (const event of events) {
    if (event.type === 'fixture' && event.fixture.id === read.id) return event.fixture;
  }
  return read;
}
