import { describe, expect, it } from 'vitest';
import { DomainValidationError } from '../errors.js';
import {
  instantAtLocalTime,
  localDateTimeInTimeZone,
  parseLocalDate,
  parseTimeZone,
} from '../time.js';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_KINDS,
  allowedHoursFor,
  enabledChannels,
  formatWallTime,
  isExpoPushToken,
  isMinorOn,
  isWithinAllowedHours,
  nextAllowedInstant,
  notificationKindsForRole,
  parseWallTime,
  preTrainingSummaryDueAt,
  resolveNotificationPreferences,
  resolveNotificationSettings,
  rpeReminderDueAt,
  rpeRequestDueAt,
  sessionEndsAt,
  storedChannelValue,
} from './index.js';

const BA = parseTimeZone('America/Argentina/Buenos_Aires');
const MADRID = parseTimeZone('Europe/Madrid');
const d = parseLocalDate;

describe('kinds and audiences', () => {
  it('players get the RPE kinds, staff the alert and summary kinds, the rest nothing', () => {
    expect(notificationKindsForRole('player')).toEqual(['rpe_request', 'rpe_reminder']);
    for (const role of ['coach', 'sc', 'medical', 'admin'] as const) {
      expect(notificationKindsForRole(role)).toEqual(['critical_alert', 'pre_training_summary']);
    }
    expect(notificationKindsForRole('parent')).toEqual([]);
    expect(notificationKindsForRole('superadmin')).toEqual([]);
  });

  it('accepts Expo push tokens only', () => {
    expect(isExpoPushToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[abcDEF123_-xyz]')).toBe(true);
    expect(isExpoPushToken('ExponentPushToken[short]')).toBe(false);
    expect(isExpoPushToken('fcm:abcdefghijkl')).toBe(false);
    expect(isExpoPushToken('ExponentPushToken[<script>alert(1)</script>]')).toBe(false);
    expect(isExpoPushToken(`ExponentPushToken[${'a'.repeat(300)}]`)).toBe(false);
    expect(isExpoPushToken(42)).toBe(false);
  });
});

describe('preferences', () => {
  it('fills what the user never touched with the defaults', () => {
    expect(resolveNotificationPreferences('coach', [])).toEqual([
      { kind: 'critical_alert', push: true, email: true, isDefault: true },
      { kind: 'pre_training_summary', push: true, email: false, isDefault: true },
    ]);
    expect(
      resolveNotificationPreferences('player', [
        { kind: 'rpe_reminder', push: false, email: null },
        // A staff kind stored for a player (a role change) is ignored.
        { kind: 'critical_alert', push: false, email: false },
      ]),
    ).toEqual([
      { kind: 'rpe_request', push: true, email: false, isDefault: true },
      { kind: 'rpe_reminder', push: false, email: false, isDefault: false },
    ]);
  });

  it('stores null for a value equal to the default', () => {
    expect(storedChannelValue('critical_alert', 'email', true)).toBeNull();
    expect(storedChannelValue('critical_alert', 'email', false)).toBe(false);
    expect(storedChannelValue('rpe_request', 'email', true)).toBe(true);
  });

  it('lists the channels that are on', () => {
    expect(enabledChannels({ push: true, email: true })).toEqual(['push', 'email']);
    expect(enabledChannels({ push: false, email: false })).toEqual([]);
  });

  it('has a default for every kind', () => {
    for (const kind of NOTIFICATION_KINDS)
      expect(DEFAULT_NOTIFICATION_PREFERENCES[kind]).toBeDefined();
  });
});

describe('club settings', () => {
  it('defaults when absent', () => {
    expect(resolveNotificationSettings(undefined)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(resolveNotificationSettings(null)).toBe(DEFAULT_NOTIFICATION_SETTINGS);
    expect(resolveNotificationSettings({})).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('reads partial settings', () => {
    const settings = resolveNotificationSettings({
      rpeRequestDelayMin: 15,
      rpeReminderTime: '07:30',
      minorAllowedHours: { to: '20:30' },
      allowedHours: { from: '06:00', to: '24:00' },
    });
    expect(settings.rpeRequestDelayMin).toBe(15);
    expect(settings.rpeReminderMinute).toBe(7 * 60 + 30);
    expect(settings.minorAllowedHours).toEqual({ fromMinute: 480, toMinute: 20 * 60 + 30 });
    expect(settings.allowedHours).toEqual({ fromMinute: 360, toMinute: 1440 });
    expect(settings.preTrainingSummaryLeadMin).toBe(120);
  });

  it.each([
    [{ rpeRequestDelay: 20 }, /Unknown notifications parameters: rpeRequestDelay/],
    [{ rpeRequestDelayMin: -1 }, /rpeRequestDelayMin/],
    [{ rpeRequestDelayMin: 1.5 }, /rpeRequestDelayMin/],
    [{ rpeReminderTime: '8:00' }, /rpeReminderTime/],
    [{ rpeReminderTime: '24:00' }, /rpeReminderTime/],
    [{ preTrainingSummaryLeadMin: 5 }, /preTrainingSummaryLeadMin/],
    [{ allowedHours: { from: '08:00', to: '08:00' } }, /different times/],
    [{ allowedHours: { from: '00:00', to: '24:00' } }, /different times/],
    [{ minorAllowedHours: { start: '08:00' } }, /Unknown minorAllowedHours/],
    [{ minorAllowedHours: '08-21' }, /must be an object/],
    ['quiet', /must be an object/],
  ])('rejects %j', (value, message) => {
    expect(() => resolveNotificationSettings(value)).toThrow(DomainValidationError);
    expect(() => resolveNotificationSettings(value)).toThrow(message);
  });

  it('round-trips wall times', () => {
    expect(parseWallTime('00:00', 'x')).toBe(0);
    expect(parseWallTime('23:59', 'x')).toBe(1439);
    expect(parseWallTime('24:00', 'x', true)).toBe(1440);
    expect(formatWallTime(8 * 60 + 5)).toBe('08:05');
  });
});

describe('wall-clock instants', () => {
  it('converts a club wall time to an instant and back', () => {
    const at = instantAtLocalTime(d('2026-03-20'), 8 * 60, BA);
    expect(at.toISOString()).toBe('2026-03-20T11:00:00.000Z');
    expect(localDateTimeInTimeZone(at, BA)).toEqual({ date: '2026-03-20', minuteOfDay: 480 });
  });

  it('moves a wall time inside a DST gap forward by the jump', () => {
    // Madrid, 2026-03-29: 02:00 → 03:00.
    expect(instantAtLocalTime(d('2026-03-29'), 2 * 60 + 30, MADRID).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    expect(localDateTimeInTimeZone(new Date('2026-03-29T01:30:00Z'), MADRID).minuteOfDay).toBe(
      3 * 60 + 30,
    );
  });

  it('takes the first occurrence of a repeated wall time', () => {
    // Madrid, 2026-10-25: 03:00 → 02:00; 02:30 happens at 00:30Z and 01:30Z.
    expect(instantAtLocalTime(d('2026-10-25'), 2 * 60 + 30, MADRID).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });

  it('rejects minutes outside the day', () => {
    expect(() => instantAtLocalTime(d('2026-03-20'), 1440, BA)).toThrow(DomainValidationError);
    expect(() => instantAtLocalTime(d('2026-03-20'), -1, BA)).toThrow(DomainValidationError);
  });
});

describe('allowed hours', () => {
  const day = { fromMinute: 8 * 60, toMinute: 21 * 60 };
  const night = { fromMinute: 22 * 60, toMinute: 6 * 60 };

  it('checks a minute against a window, also across midnight', () => {
    expect(isWithinAllowedHours(8 * 60, day)).toBe(true);
    expect(isWithinAllowedHours(21 * 60, day)).toBe(false);
    expect(isWithinAllowedHours(7 * 60 + 59, day)).toBe(false);
    expect(isWithinAllowedHours(23 * 60, night)).toBe(true);
    expect(isWithinAllowedHours(5 * 60, night)).toBe(true);
    expect(isWithinAllowedHours(12 * 60, night)).toBe(false);
    expect(isWithinAllowedHours(1439, { fromMinute: 0, toMinute: 1440 })).toBe(true);
  });

  it('keeps an allowed instant', () => {
    const at = new Date('2026-03-20T15:00:00Z'); // 12:00 BA
    expect(nextAllowedInstant(at, BA, day)).toEqual(at);
  });

  it('defers a late instant to the next morning in the club zone', () => {
    const at = new Date('2026-03-21T01:30:00Z'); // 22:30 BA on the 20th
    expect(nextAllowedInstant(at, BA, day).toISOString()).toBe('2026-03-21T11:00:00.000Z');
  });

  it('defers an early instant to the opening of the same day', () => {
    const at = new Date('2026-03-20T09:00:00Z'); // 06:00 BA
    expect(nextAllowedInstant(at, BA, day).toISOString()).toBe('2026-03-20T11:00:00.000Z');
  });

  it('defers inside a window that crosses midnight', () => {
    const at = new Date('2026-03-20T15:00:00Z'); // 12:00 BA
    expect(nextAllowedInstant(at, BA, night).toISOString()).toBe('2026-03-21T01:00:00.000Z');
  });

  it('uses the wall-clock opening across a DST change', () => {
    // Madrid: 23:00 on 2026-03-28 (UTC+1) → 08:00 on the 29th, already UTC+2.
    const at = new Date('2026-03-28T22:00:00Z');
    expect(nextAllowedInstant(at, MADRID, day).toISOString()).toBe('2026-03-29T06:00:00.000Z');
  });

  it('picks the minors window for minors', () => {
    const settings = DEFAULT_NOTIFICATION_SETTINGS;
    expect(allowedHoursFor(settings, true)).toBe(settings.minorAllowedHours);
    expect(allowedHoursFor(settings, false)).toBe(settings.allowedHours);
  });

  it('tells minors on the club day', () => {
    expect(isMinorOn(d('2008-03-21'), d('2026-03-20'))).toBe(true);
    expect(isMinorOn(d('2008-03-20'), d('2026-03-20'))).toBe(false);
    // 29 February: of age on 1 March of a common year.
    expect(isMinorOn(d('2008-02-29'), d('2026-02-28'))).toBe(true);
    expect(isMinorOn(d('2008-02-29'), d('2026-03-01'))).toBe(false);
  });
});

describe('session times', () => {
  const settings = DEFAULT_NOTIFICATION_SETTINGS;
  const session = {
    startsAt: new Date('2026-03-20T21:00:00Z'), // 18:00 BA
    localDate: d('2026-03-20'),
    plannedDurationMin: 75,
  };

  it('asks the RPE after the end of the session plus the delay', () => {
    expect(sessionEndsAt(session, settings).toISOString()).toBe('2026-03-20T22:15:00.000Z');
    expect(rpeRequestDueAt(session, settings).toISOString()).toBe('2026-03-20T22:35:00.000Z');
    expect(sessionEndsAt({ ...session, plannedDurationMin: null }, settings).toISOString()).toBe(
      '2026-03-20T22:30:00.000Z',
    );
  });

  it('reminds the next morning at the club time', () => {
    expect(rpeReminderDueAt(session, BA, settings).toISOString()).toBe('2026-03-21T11:00:00.000Z');
  });

  it('sends the staff summary before the session', () => {
    expect(preTrainingSummaryDueAt(session, settings).toISOString()).toBe(
      '2026-03-20T19:00:00.000Z',
    );
  });
});
