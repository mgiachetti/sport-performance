import { describe, expect, it } from 'vitest';
import {
  calendarEventSchema,
  createFixture,
  createTestWindow,
  getCategoryCalendar,
  localTimeSchema,
  testWindowNumberSchema,
  updateTestSession,
} from './calendar.js';

describe('calendar contracts', () => {
  it('take window numbers 1 to 4 and HH:MM kick-offs', () => {
    for (const n of [1, 2, 3, 4]) expect(testWindowNumberSchema.safeParse(n).success).toBe(true);
    expect(testWindowNumberSchema.safeParse(5).success).toBe(false);
    expect(testWindowNumberSchema.safeParse('1').success).toBe(false);
    expect(localTimeSchema.safeParse('15:30').success).toBe(true);
    for (const bad of ['24:00', '9:30', '15:30:00']) {
      expect(localTimeSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(
      createTestWindow.body.safeParse({ number: 1, startsOn: '2027-02-01', endsOn: '2027-02-28' })
        .success,
    ).toBe(true);
  });

  it('default a new match to scheduled and reject padded texts', () => {
    const base = {
      categoryId: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f',
      venue: 'home',
      date: '2027-04-10',
    };
    expect(createFixture.body.parse({ ...base, opponent: 'CASI' }).status).toBe('scheduled');
    expect(createFixture.body.safeParse({ ...base, opponent: ' CASI' }).success).toBe(false);
    expect(
      createFixture.body.safeParse({ ...base, opponent: 'CASI', venue: 'local' }).success,
    ).toBe(false);
  });

  it('carry the change reason of a reschedule in the body', () => {
    expect(
      updateTestSession.body.safeParse({
        version: '1',
        scheduledOn: '2027-02-12',
        changeReason: 'Lluvia',
      }).success,
    ).toBe(true);
    expect(updateTestSession.body.safeParse({ version: '1', changeReason: ' ' }).success).toBe(
      false,
    );
  });

  it('need a category and a range for the calendar', () => {
    expect(
      getCategoryCalendar.query.safeParse({ from: '2027-01-01', to: '2027-12-31' }).success,
    ).toBe(false);
    expect(
      calendarEventSchema.safeParse({ type: 'holiday', date: '2027-01-01', endDate: '2027-01-01' })
        .success,
    ).toBe(false);
  });
});
