import { describe, expect, it } from 'vitest';
import { parseLocalDate, type LocalDate } from '../time.js';
import type { Alert } from './engine.js';
import {
  alertReviewProblems,
  cmjMeasurementsForAlerts,
  nextAlertEpisode,
  type AlertEpisode,
} from './episodes.js';
import type { AlertSeverity } from './rules.js';

const d = (value: string): LocalDate => parseLocalDate(value);

function fired(date: string, severity: AlertSeverity, acwrRatio = 1.35): Alert {
  return {
    ruleCode: 'acwr_high',
    kind: 'acwr_high',
    severity,
    date: d(date),
    observedOn: d(date),
    messageKey: 'alert.acwr_high.message',
    suggestionKey: 'alert.acwr_high.suggestion',
    values: { acwrRatio, thresholdRatio: severity === 'critical' ? 1.4 : 1.3, historyDays: 40 },
  };
}

function episode(overrides: Partial<AlertEpisode> = {}): AlertEpisode {
  const base = fired('2026-03-10', 'warning');
  return {
    raisedOn: d('2026-03-10'),
    lastSeenOn: d('2026-03-10'),
    resolvedOn: null,
    severity: 'warning',
    currentSeverity: 'warning',
    status: 'open',
    observedOn: d('2026-03-10'),
    values: base.values,
    ...overrides,
  };
}

describe('nextAlertEpisode', () => {
  it('raises a new episode the first day a rule fires', () => {
    expect(nextAlertEpisode(null, d('2026-03-10'), fired('2026-03-10', 'warning'))).toEqual({
      type: 'raise',
      episode: episode(),
    });
    expect(nextAlertEpisode(null, d('2026-03-10'), null)).toEqual({ type: 'none' });
  });

  it('continues the episode while the rule keeps firing', () => {
    const change = nextAlertEpisode(
      episode(),
      d('2026-03-11'),
      fired('2026-03-11', 'warning', 1.38),
    );
    expect(change).toEqual({
      type: 'update',
      episode: episode({
        lastSeenOn: d('2026-03-11'),
        observedOn: d('2026-03-11'),
        values: fired('2026-03-11', 'warning', 1.38).values,
      }),
    });
  });

  it('is idempotent: the same day with the same outcome changes nothing', () => {
    expect(nextAlertEpisode(episode(), d('2026-03-10'), fired('2026-03-10', 'warning'))).toEqual({
      type: 'none',
    });
    const resolved = episode({ resolvedOn: d('2026-03-11') });
    expect(nextAlertEpisode(resolved, d('2026-03-11'), null)).toEqual({ type: 'none' });
  });

  it('escalates to the highest severity and reopens a reviewed alert', () => {
    const reviewed = episode({ status: 'acknowledged' });
    const change = nextAlertEpisode(reviewed, d('2026-03-11'), fired('2026-03-11', 'critical'));
    expect(change.type).toBe('update');
    if (change.type !== 'update') return;
    expect(change.episode).toMatchObject({
      severity: 'critical',
      currentSeverity: 'critical',
      status: 'open',
    });
  });

  it('never lowers the severity reached and keeps the review when it calms down', () => {
    const red = episode({ severity: 'critical', currentSeverity: 'critical', status: 'dismissed' });
    const change = nextAlertEpisode(red, d('2026-03-11'), fired('2026-03-11', 'warning'));
    expect(change.type).toBe('update');
    if (change.type !== 'update') return;
    expect(change.episode).toMatchObject({
      severity: 'critical',
      currentSeverity: 'warning',
      status: 'dismissed',
    });
  });

  it('resolves the first day the rule stops firing, also after a same-day correction', () => {
    expect(nextAlertEpisode(episode(), d('2026-03-12'), null)).toEqual({
      type: 'update',
      episode: episode({ resolvedOn: d('2026-03-12') }),
    });
    expect(nextAlertEpisode(episode(), d('2026-03-10'), null)).toEqual({
      type: 'update',
      episode: episode({ resolvedOn: d('2026-03-10') }),
    });
  });

  it('reopens an episode that fires again the day it resolved', () => {
    const resolved = episode({ lastSeenOn: d('2026-03-11'), resolvedOn: d('2026-03-12') });
    const change = nextAlertEpisode(resolved, d('2026-03-12'), fired('2026-03-12', 'warning'));
    expect(change).toMatchObject({
      type: 'update',
      episode: { raisedOn: d('2026-03-10'), lastSeenOn: d('2026-03-12'), resolvedOn: null },
    });
  });

  it('raises a new episode after a resolved one', () => {
    const resolved = episode({ resolvedOn: d('2026-03-11'), status: 'acknowledged' });
    const change = nextAlertEpisode(resolved, d('2026-03-13'), fired('2026-03-13', 'warning'));
    expect(change).toMatchObject({
      type: 'raise',
      episode: { raisedOn: d('2026-03-13'), status: 'open', resolvedOn: null },
    });
  });

  it('only moves forward: days before what the episode knows are ignored', () => {
    const active = episode({ lastSeenOn: d('2026-03-12') });
    expect(nextAlertEpisode(active, d('2026-03-11'), null)).toEqual({ type: 'none' });
    const resolved = episode({ resolvedOn: d('2026-03-12') });
    expect(nextAlertEpisode(resolved, d('2026-03-11'), fired('2026-03-11', 'critical'))).toEqual({
      type: 'none',
    });
  });

  it('rejects an alert of another day', () => {
    expect(() => nextAlertEpisode(null, d('2026-03-11'), fired('2026-03-10', 'warning'))).toThrow(
      /evaluated on 2026-03-10/,
    );
  });
});

describe('alertReviewProblems', () => {
  it('reviews only open alerts and asks a note to dismiss', () => {
    expect(
      alertReviewProblems({ currentStatus: 'open', status: 'acknowledged', note: null }),
    ).toEqual([]);
    expect(
      alertReviewProblems({ currentStatus: 'acknowledged', status: 'acknowledged', note: 'ok' }),
    ).toEqual(['not_open']);
    expect(alertReviewProblems({ currentStatus: 'open', status: 'dismissed', note: '  ' })).toEqual(
      ['note_required'],
    );
    expect(
      alertReviewProblems({ currentStatus: 'open', status: 'dismissed', note: 'x'.repeat(1001) }),
    ).toEqual(['note_too_long']);
  });
});

describe('cmjMeasurementsForAlerts', () => {
  it('keeps the method of the latest jump and ignores later days', () => {
    const results = [
      { date: d('2026-03-01'), heightCm: 40, method: 'app' },
      { date: d('2026-03-03'), heightCm: 45, method: 'manual' },
      { date: d('2026-03-05'), heightCm: 38, method: 'app' },
      { date: d('2026-03-09'), heightCm: 50, method: 'manual' },
    ];
    expect(cmjMeasurementsForAlerts(results, d('2026-03-06'))).toEqual([
      { date: d('2026-03-01'), heightCm: 40 },
      { date: d('2026-03-05'), heightCm: 38 },
    ]);
    expect(cmjMeasurementsForAlerts(results, d('2026-03-09'))).toEqual([
      { date: d('2026-03-03'), heightCm: 45 },
      { date: d('2026-03-09'), heightCm: 50 },
    ]);
    expect(cmjMeasurementsForAlerts([], d('2026-03-09'))).toEqual([]);
  });

  it('on a day with two methods, keeps the method of the best jump', () => {
    const results = [
      { date: d('2026-03-05'), heightCm: 38, method: 'app' },
      { date: d('2026-03-05'), heightCm: 41, method: 'video' },
    ];
    expect(cmjMeasurementsForAlerts(results, d('2026-03-05'))).toEqual([
      { date: d('2026-03-05'), heightCm: 41 },
    ]);
  });
});
