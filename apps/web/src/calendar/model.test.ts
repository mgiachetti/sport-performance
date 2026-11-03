import { parseLocalDate } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import * as cal from '../test/calendar-fixtures';
import { M15_RUGBY } from '../test/fixtures';
import {
  addMonths,
  calendarDays,
  eventsFromLists,
  missingWindowNumbers,
  monthGrid,
  monthKey,
  parseCalendarSearch,
  parseMonth,
  seasonKeepsWindows,
  sessionWindowLabel,
  suggestWindowSpan,
  windowLabel,
  windowPlanProblems,
  windowsForDate,
} from './model';

const d = parseLocalDate;

function season2027(withWindows = true) {
  return cal.season('rugby', '2027', '2027-02-01', '2027-11-30', (id) =>
    withWindows
      ? [
          cal.testWindow(id, 1, '2027-02-01', '2027-02-28'),
          cal.testWindow(id, 2, '2027-04-01', '2027-04-30'),
          cal.testWindow(id, 3, '2027-07-01', '2027-07-31', {
            archivedAt: '2027-01-01T00:00:00.000Z',
          }),
        ]
      : [],
  );
}

describe('month and search', () => {
  it('parses YYYY-MM and rejects anything else', () => {
    expect(parseMonth('2026-11')).toEqual({ year: 2026, month: 11 });
    expect(parseMonth('2026-13')).toBeUndefined();
    expect(parseMonth('2026-1')).toBeUndefined();
    expect(parseMonth(202611)).toBeUndefined();
  });

  it('moves across years', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(monthKey({ year: 2027, month: 3 })).toBe('2027-03');
  });

  it('keeps only a valid month and a non-default view in the URL', () => {
    expect(parseCalendarSearch({ month: '2027-07', view: 'list' })).toEqual({
      month: '2027-07',
      view: 'list',
    });
    expect(parseCalendarSearch({ month: 'julio', view: 'month' })).toEqual({});
    expect(parseCalendarSearch({ view: 'year' })).toEqual({});
  });
});

describe('monthGrid', () => {
  it('covers the month with full weeks from Monday to Sunday', () => {
    // November 2026 starts on a Sunday and ends on a Monday.
    const grid = monthGrid({ year: 2026, month: 11 });
    expect(grid.range).toEqual({ startsOn: d('2026-10-26'), endsOn: d('2026-12-06') });
    expect(grid.weeks).toHaveLength(6);
    expect(grid.weeks.every((week) => week.length === 7)).toBe(true);
    expect(grid.weeks[0]?.[6]).toBe('2026-11-01');
  });

  it('needs only four weeks for a February that starts on Monday', () => {
    const grid = monthGrid({ year: 2027, month: 2 });
    expect(grid.weeks).toHaveLength(4);
    expect(grid.range).toEqual({ startsOn: d('2027-02-01'), endsOn: d('2027-02-28') });
  });
});

describe('events', () => {
  it('builds the calendar of a sport from the lists, sorted, without archived windows or matches', () => {
    const season = season2027();
    const day = cal.testSession(M15_RUGBY, '2027-04-10');
    const late = cal.fixture(M15_RUGBY, '2027-04-10', 'CASI', { kickoffTime: '17:00' });
    const early = cal.fixture(M15_RUGBY, '2027-04-10', 'SIC', { kickoffTime: '10:00' });
    const archived = cal.fixture(M15_RUGBY, '2027-04-11', 'Belgrano', {
      archivedAt: '2027-04-01T00:00:00.000Z',
    });
    const events = eventsFromLists({
      seasons: [season],
      testSessions: [day],
      fixtures: [late, archived, early],
      range: { startsOn: d('2027-03-29'), endsOn: d('2027-05-09') },
    });
    expect(events.map((event) => event.type)).toEqual([
      'test_window',
      'test_session',
      'fixture',
      'fixture',
    ]);
    expect(
      events.slice(2).map((event) => event.type === 'fixture' && event.fixture.opponent),
    ).toEqual(['SIC', 'CASI']);
  });

  it('places windows on every day they span and items on their day', () => {
    const season = season2027();
    const match = cal.fixture(M15_RUGBY, '2027-03-31', 'CASI');
    const events = eventsFromLists({
      seasons: [season],
      testSessions: [],
      fixtures: [match],
      range: { startsOn: d('2027-03-29'), endsOn: d('2027-04-04') },
    });
    const days = calendarDays(
      monthGrid({ year: 2027, month: 4 }).weeks[0] ?? [],
      events,
      { year: 2027, month: 4 },
      d('2027-04-01'),
    );
    expect(days.map((day) => day.windows.length)).toEqual([0, 0, 0, 1, 1, 1, 1]);
    expect(days.map((day) => day.items.length)).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(days.map((day) => day.inMonth)).toEqual([false, false, false, true, true, true, true]);
    expect(days[3]?.isToday).toBe(true);
  });
});

describe('windows', () => {
  it('offers the active windows of the sport that contain the date', () => {
    const season = season2027();
    expect(
      windowsForDate([season], 'rugby', d('2027-04-15')).map((w) => w.testWindow.label),
    ).toEqual(['V2']);
    expect(windowsForDate([season], 'hockey', d('2027-04-15'))).toEqual([]);
    // V3 is archived: no window for July.
    expect(windowsForDate([season], 'rugby', d('2027-07-15'))).toEqual([]);
  });

  it('names a window by its id', () => {
    const season = season2027();
    expect(windowLabel([season], season.testWindows[1]?.id ?? null)).toBe('V2 · 2027');
    expect(windowLabel([season], null)).toBeNull();
  });

  it('names the window of a test day from the windows in view', () => {
    const season = season2027();
    const v2 = season.testWindows[1];
    const events = cal.calendarEvents({ seasons: [season] });
    expect(sessionWindowLabel(events, v2?.id ?? null)).toBe('V2');
    expect(sessionWindowLabel(events, null)).toBeNull();
    expect(sessionWindowLabel([], v2?.id ?? null)).toBeNull();
  });

  it('suggests the reference month, cut to the season', () => {
    const season = cal.season('rugby', '2027', '2027-02-10', '2027-11-20');
    expect(suggestWindowSpan(season, 1)).toEqual({
      startsOn: d('2027-02-10'),
      endsOn: d('2027-02-28'),
    });
    expect(suggestWindowSpan(season, 3)).toEqual({
      startsOn: d('2027-07-01'),
      endsOn: d('2027-07-31'),
    });
    expect(suggestWindowSpan(season, 4)).toEqual({
      startsOn: d('2027-11-01'),
      endsOn: d('2027-11-20'),
    });
  });

  it('suggests nothing when the reference month is outside the season or breaks the plan', () => {
    const short = cal.season('rugby', 'Apertura', '2027-03-01', '2027-06-30');
    expect(suggestWindowSpan(short, 1)).toBeNull();
    const crowded = cal.season('rugby', '2027', '2027-02-01', '2027-11-30', (id) => [
      cal.testWindow(id, 2, '2027-07-01', '2027-07-15'),
    ]);
    // V3's reference month overlaps V2 there.
    expect(suggestWindowSpan(crowded, 3)).toBeNull();
  });

  it('explains the problems of a draft with the domain rules, naming the other window', () => {
    const season = season2027();
    expect(
      windowPlanProblems(season, {
        id: null,
        number: 4,
        startsOn: d('2027-11-01'),
        endsOn: d('2027-11-30'),
      }),
    ).toEqual([]);
    expect(
      windowPlanProblems(season, {
        id: null,
        number: 4,
        startsOn: d('2027-04-20'),
        endsOn: d('2027-05-05'),
      }),
    ).toEqual([{ kind: 'overlaps', other: 'V2' }]);
    expect(
      windowPlanProblems(season, {
        id: null,
        number: 4,
        startsOn: d('2027-03-01'),
        endsOn: d('2027-03-10'),
      }),
    ).toEqual([{ kind: 'out_of_order', other: 'V2' }]);
    expect(
      windowPlanProblems(season, {
        id: null,
        number: 4,
        startsOn: d('2027-12-01'),
        endsOn: d('2027-12-10'),
      }),
    ).toEqual([{ kind: 'outside_season' }]);
    expect(
      windowPlanProblems(season, {
        id: null,
        number: 4,
        startsOn: d('2027-11-10'),
        endsOn: d('2027-11-01'),
      }),
    ).toEqual([{ kind: 'ends_before_start' }]);
  });

  it('checks an edited window against the others only', () => {
    const season = season2027();
    const v2 = season.testWindows[1];
    if (v2 === undefined) throw new Error('fixture');
    expect(
      windowPlanProblems(season, {
        id: v2.id,
        number: 2,
        startsOn: d('2027-04-05'),
        endsOn: d('2027-04-25'),
      }),
    ).toEqual([]);
  });

  it('lists the numbers not planned yet and checks new season dates against the windows', () => {
    const season = season2027();
    expect(missingWindowNumbers(season)).toEqual([4]);
    expect(missingWindowNumbers(season2027(false))).toEqual([1, 2, 3, 4]);
    expect(seasonKeepsWindows(season, { startsOn: d('2027-01-15'), endsOn: d('2027-12-15') })).toBe(
      true,
    );
    expect(seasonKeepsWindows(season, { startsOn: d('2027-03-01'), endsOn: d('2027-12-15') })).toBe(
      false,
    );
    // An archived window (V3) does not hold the dates.
    expect(seasonKeepsWindows(season, { startsOn: d('2027-02-01'), endsOn: d('2027-05-31') })).toBe(
      true,
    );
  });
});
