import type {
  CalendarEvent,
  Fixture,
  Season,
  TestSession,
  TestWindow,
} from '@sport-performance/contracts';
import {
  addDays,
  compareLocalDates,
  defaultTestWindows,
  isLocalDate,
  isoWeekday,
  localDate,
  localDateParts,
  spanContainsDate,
  spanContainsSpan,
  spansOverlap,
  startOfIsoWeek,
  testWindowLabel,
  testWindowProblems,
  type DateSpan,
  type LocalDate,
  type Sport,
  type TestWindowNumber,
  type TestWindowProblem,
} from '@sport-performance/domain';

/**
 * Pure model of the season calendar (B-406): the month of the URL, its grid
 * (Monday-first full weeks), the events of each day, and the rules the forms
 * check before calling the API (the API checks them again). Every date is a
 * day of the club's time zone.
 */

// ─── Month and search ────────────────────────────────────────────────────────────────

export interface CalendarMonth {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
}

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

/** `2026-11` → `{ year: 2026, month: 11 }`; anything else → `undefined`. */
export function parseMonth(value: unknown): CalendarMonth | undefined {
  if (typeof value !== 'string') return undefined;
  const match = MONTH_PATTERN.exec(value);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1900 || year > 2999 || month < 1 || month > 12) return undefined;
  return { year, month };
}

export function monthKey(month: CalendarMonth): string {
  return `${String(month.year).padStart(4, '0')}-${String(month.month).padStart(2, '0')}`;
}

export function monthOf(date: LocalDate): CalendarMonth {
  const { year, month } = localDateParts(date);
  return { year, month };
}

export function addMonths(month: CalendarMonth, count: number): CalendarMonth {
  const index = month.year * 12 + (month.month - 1) + count;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** First to last day of the month. */
export function monthSpan(month: CalendarMonth): DateSpan {
  const startsOn = localDate(month.year, month.month, 1);
  const next = addMonths(month, 1);
  return { startsOn, endsOn: addDays(localDate(next.year, next.month, 1), -1) };
}

export const CALENDAR_VIEWS = ['month', 'list'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** Search params of `/calendar` (besides the layout's `?sport&category`). */
export interface CalendarSearch {
  readonly month?: string | undefined;
  readonly view?: CalendarView | undefined;
}

/** `validateSearch` of the calendar: drops anything malformed. */
export function parseCalendarSearch(search: Readonly<Record<string, unknown>>): CalendarSearch {
  const month = parseMonth(search.month);
  const view = CALENDAR_VIEWS.find((candidate) => candidate === search.view);
  return {
    ...(month === undefined ? {} : { month: monthKey(month) }),
    ...(view === undefined || view === 'month' ? {} : { view }),
  };
}

// ─── Grid ────────────────────────────────────────────────────────────────────────────

export interface MonthGrid {
  /** Weeks of the grid, Monday to Sunday; the first and last may hold days of other months. */
  readonly weeks: readonly (readonly LocalDate[])[];
  /** What the grid shows, both ends included: the range asked to the API. */
  readonly range: DateSpan;
}

export function monthGrid(month: CalendarMonth): MonthGrid {
  const span = monthSpan(month);
  const startsOn = startOfIsoWeek(span.startsOn);
  const endsOn = addDays(span.endsOn, 7 - isoWeekday(span.endsOn));
  const weeks: LocalDate[][] = [];
  for (let day = startsOn; compareLocalDates(day, endsOn) <= 0; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_unused, index) => addDays(day, index)));
  }
  return { weeks, range: { startsOn, endsOn } };
}

// ─── Events ──────────────────────────────────────────────────────────────────────────

export type WindowEvent = Extract<CalendarEvent, { type: 'test_window' }>;
export type TestSessionEvent = Extract<CalendarEvent, { type: 'test_session' }>;
export type FixtureEvent = Extract<CalendarEvent, { type: 'fixture' }>;
export type DayEvent = TestSessionEvent | FixtureEvent;

const TYPE_ORDER: Readonly<Record<CalendarEvent['type'], number>> = {
  test_window: 0,
  test_session: 1,
  fixture: 2,
};

/** By day, then windows, test days and matches, then kick-off (unconfirmed last). */
export function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  const byDate = compareLocalDates(a.date, b.date);
  if (byDate !== 0) return byDate;
  if (a.type !== b.type) return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
  if (a.type === 'fixture' && b.type === 'fixture') {
    const ka = a.fixture.kickoffTime ?? '99:99';
    const kb = b.fixture.kickoffTime ?? '99:99';
    if (ka !== kb) return ka < kb ? -1 : 1;
  }
  return 0;
}

export function windowEvent(season: Pick<Season, 'id' | 'name'>, window: TestWindow): WindowEvent {
  return {
    type: 'test_window',
    date: window.startsOn,
    endDate: window.endsOn,
    season: { id: season.id, name: season.name },
    testWindow: window,
  };
}

export function testSessionEvent(session: TestSession): TestSessionEvent {
  return {
    type: 'test_session',
    date: session.scheduledOn,
    endDate: session.scheduledOn,
    testSession: session,
  };
}

export function fixtureEvent(fixture: Fixture): FixtureEvent {
  return { type: 'fixture', date: fixture.date, endDate: fixture.date, fixture };
}

/** Active windows of the active seasons that cross `range`. */
export function activeWindowsIn(seasons: readonly Season[], range: DateSpan): WindowEvent[] {
  return seasons
    .filter((season) => season.archivedAt === null)
    .flatMap((season) =>
      season.testWindows
        .filter((window) => window.archivedAt === null && spansOverlap(window, range))
        .map((window) => windowEvent(season, window)),
    );
}

/**
 * The events of a sport or of everything the user sees, from the list
 * endpoints, in the shape of `GET /v1/calendar` (which serves one category).
 * Archived matches never come (the query asks for active ones).
 */
export function eventsFromLists(input: {
  readonly seasons: readonly Season[];
  readonly testSessions: readonly TestSession[];
  readonly fixtures: readonly Fixture[];
  readonly range: DateSpan;
}): CalendarEvent[] {
  return [
    ...activeWindowsIn(input.seasons, input.range),
    ...input.testSessions.map(testSessionEvent),
    ...input.fixtures.filter((f) => f.archivedAt === null).map(fixtureEvent),
  ].sort(compareEvents);
}

export interface CalendarDay {
  readonly date: LocalDate;
  readonly inMonth: boolean;
  readonly isToday: boolean;
  /** Windows that contain the day. */
  readonly windows: readonly WindowEvent[];
  /** Test days and matches of the day, in order. */
  readonly items: readonly DayEvent[];
}

/** Each day of `dates` with its windows and events. */
export function calendarDays(
  dates: readonly LocalDate[],
  events: readonly CalendarEvent[],
  month: CalendarMonth,
  today: LocalDate,
): CalendarDay[] {
  const sorted = [...events].sort(compareEvents);
  const windows = sorted.filter((event): event is WindowEvent => event.type === 'test_window');
  const items = sorted.filter((event): event is DayEvent => event.type !== 'test_window');
  return dates.map((date) => {
    const parts = localDateParts(date);
    return {
      date,
      inMonth: parts.year === month.year && parts.month === month.month,
      isToday: date === today,
      windows: windows.filter((event) =>
        spanContainsDate({ startsOn: event.date, endsOn: event.endDate }, date),
      ),
      items: items.filter((event) => event.date === date),
    };
  });
}

// ─── Windows: suggestion, choice and checks ──────────────────────────────────────────

/** Active windows of the active seasons of `sport` that contain `date` (where a test day may go). */
export function windowsForDate(
  seasons: readonly Season[],
  sport: Sport,
  date: LocalDate,
): WindowEvent[] {
  return seasons
    .filter((season) => season.sport === sport && season.archivedAt === null)
    .flatMap((season) =>
      season.testWindows
        .filter((window) => window.archivedAt === null && spanContainsDate(window, date))
        .map((window) => windowEvent(season, window)),
    );
}

/**
 * Label (`V2`) of the window a test day belongs to, from the windows among
 * the events of the screen; `null` without one or when it is not in view.
 */
export function sessionWindowLabel(
  events: readonly CalendarEvent[],
  windowId: TestWindow['id'] | null,
): string | null {
  if (windowId === null) return null;
  for (const event of events) {
    if (event.type === 'test_window' && event.testWindow.id === windowId) {
      return event.testWindow.label;
    }
  }
  return null;
}

/** `V3 · 2027` of a window id among the seasons, or `null` if none of them has it. */
export function windowLabel(
  seasons: readonly Season[],
  windowId: TestWindow['id'] | null,
): string | null {
  if (windowId === null) return null;
  for (const season of seasons) {
    const window = season.testWindows.find((candidate) => candidate.id === windowId);
    if (window !== undefined) return `${window.label} · ${season.name}`;
  }
  return null;
}

/**
 * Dates to suggest for window `number` of `season`: the month of the
 * reference calendar (V1 February, V2 April, V3 July, V4 November) of a year
 * the season covers, cut to the season. `null` when that month falls outside
 * the season or the result breaks the plan of the other active windows.
 */
export function suggestWindowSpan(season: Season, number: TestWindowNumber): DateSpan | null {
  const first = localDateParts(season.startsOn).year;
  const last = localDateParts(season.endsOn).year;
  for (let year = first; year <= last; year += 1) {
    const reference = defaultTestWindows(year).find((window) => window.number === number);
    if (reference === undefined || !spansOverlap(reference, season)) continue;
    const span: DateSpan = {
      startsOn:
        compareLocalDates(reference.startsOn, season.startsOn) < 0
          ? season.startsOn
          : reference.startsOn,
      endsOn:
        compareLocalDates(reference.endsOn, season.endsOn) > 0 ? season.endsOn : reference.endsOn,
    };
    if (windowPlanProblems(season, { id: null, number, ...span }).length === 0) return span;
  }
  return null;
}

/** A window being planned or edited (`id: null` for a new one). */
export interface WindowDraft extends DateSpan {
  readonly id: string | null;
  readonly number: TestWindowNumber;
}

const DRAFT_ID = 'draft';

/** A problem of the draft, naming the other window by its label. */
export interface WindowDraftProblem {
  readonly kind: TestWindowProblem['kind'];
  readonly other?: `V${TestWindowNumber}`;
}

/**
 * The problems of `draft` against its season and the other active windows,
 * with the same rules as the API (`testWindowProblems` of the domain).
 */
export function windowPlanProblems(season: Season, draft: WindowDraft): WindowDraftProblem[] {
  const draftId = draft.id ?? DRAFT_ID;
  const others = season.testWindows.filter(
    (window) => window.archivedAt === null && window.id !== draft.id,
  );
  const byId = new Map(others.map((window) => [window.id as string, window]));
  const problems = testWindowProblems(season, [
    { id: draftId, number: draft.number, startsOn: draft.startsOn, endsOn: draft.endsOn },
    ...others.map((window) => ({
      id: window.id,
      number: window.number,
      startsOn: window.startsOn,
      endsOn: window.endsOn,
    })),
  ]);
  const result: WindowDraftProblem[] = [];
  for (const problem of problems) {
    if (problem.kind === 'ends_before_start' || problem.kind === 'outside_season') {
      if (problem.id === draftId) result.push({ kind: problem.kind });
      continue;
    }
    const otherId =
      problem.id === draftId ? problem.otherId : problem.otherId === draftId ? problem.id : null;
    if (otherId === null) continue;
    const other = byId.get(otherId);
    result.push({
      kind: problem.kind,
      ...(other === undefined ? {} : { other: testWindowLabel(other.number) }),
    });
  }
  return result;
}

/** Whether the new dates of a season still contain its active windows (the API asks for it). */
export function seasonKeepsWindows(season: Season, span: DateSpan): boolean {
  return season.testWindows
    .filter((window) => window.archivedAt === null)
    .every((window) => spanContainsSpan(span, window));
}

/** Window numbers a season has not planned yet (no window with that number, archived or not). */
export function missingWindowNumbers(season: Season): TestWindowNumber[] {
  const present = new Set(season.testWindows.map((window) => window.number));
  return ([1, 2, 3, 4] as const).filter((number) => !present.has(number));
}

// ─── Forms ───────────────────────────────────────────────────────────────────────────

/** A date input's value as a `LocalDate`, or `null`. */
export function dateInput(value: string): LocalDate | null {
  const trimmed = value.trim();
  return isLocalDate(trimmed) ? trimmed : null;
}

/** Optional text of a form: trimmed, `null` when empty. */
export function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
