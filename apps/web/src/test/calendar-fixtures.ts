import type {
  CalendarEvent,
  Category,
  Fixture,
  Season,
  TestSession,
  TestWindow,
} from '@sport-performance/contracts';
import {
  parseLocalDate,
  testWindowLabel,
  type Sport,
  type TestWindowNumber,
} from '@sport-performance/domain';

/** Valid calendar payloads (B-317) for the calendar screen tests. */

const AT = '2026-11-01T12:00:00.000Z';
const VERSION = '1793586338688123';

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `0192e7a0-${prefix}-7000-8000-${String(sequence).padStart(12, '0')}`;
}

type Overrides<T> = Partial<{ -readonly [K in keyof T]: T[K] }>;

export function testWindow(
  seasonId: Season['id'],
  number: TestWindowNumber,
  startsOn: string,
  endsOn: string,
  overrides: Overrides<TestWindow> = {},
): TestWindow {
  return {
    id: nextId('4444') as TestWindow['id'],
    seasonId,
    number,
    label: testWindowLabel(number),
    startsOn: parseLocalDate(startsOn),
    endsOn: parseLocalDate(endsOn),
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export function season(
  sport: Sport,
  name: string,
  startsOn: string,
  endsOn: string,
  windows: (id: Season['id']) => TestWindow[] = () => [],
  overrides: Overrides<Season> = {},
): Season {
  const id = (overrides.id ?? nextId('5555')) as Season['id'];
  return {
    id,
    sport,
    name,
    startsOn: parseLocalDate(startsOn),
    endsOn: parseLocalDate(endsOn),
    testWindows: windows(id),
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export function testSession(
  category: Category,
  scheduledOn: string,
  overrides: Overrides<TestSession> = {},
): TestSession {
  return {
    id: nextId('6666') as TestSession['id'],
    sport: category.sport,
    categoryId: category.id,
    testWindowId: null,
    scheduledOn: parseLocalDate(scheduledOn),
    status: 'scheduled',
    location: null,
    conditions: {},
    notes: null,
    evaluatorId: null,
    startedAt: null,
    completedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export function fixture(
  category: Category,
  date: string,
  opponent: string,
  overrides: Overrides<Fixture> = {},
): Fixture {
  return {
    id: nextId('7777') as Fixture['id'],
    sport: category.sport,
    categoryId: category.id,
    opponent,
    venue: 'home',
    competition: null,
    date: parseLocalDate(date),
    kickoffTime: null,
    startsAt: null,
    location: null,
    status: 'scheduled',
    notes: null,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

/** The `GET /v1/calendar` entries of a season's windows, test days and matches. */
export function calendarEvents(input: {
  seasons?: readonly Season[];
  testSessions?: readonly TestSession[];
  fixtures?: readonly Fixture[];
}): CalendarEvent[] {
  return [
    ...(input.seasons ?? []).flatMap((s) =>
      s.testWindows.map((window): CalendarEvent => ({
        type: 'test_window',
        date: window.startsOn,
        endDate: window.endsOn,
        season: { id: s.id, name: s.name },
        testWindow: window,
      })),
    ),
    ...(input.testSessions ?? []).map((session): CalendarEvent => ({
      type: 'test_session',
      date: session.scheduledOn,
      endDate: session.scheduledOn,
      testSession: session,
    })),
    ...(input.fixtures ?? []).map((match): CalendarEvent => ({
      type: 'fixture',
      date: match.date,
      endDate: match.date,
      fixture: match,
    })),
  ];
}
