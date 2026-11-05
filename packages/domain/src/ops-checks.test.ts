import { describe, expect, it } from 'vitest';
import {
  OPS_CHECKS,
  OPS_CHECK_CODES,
  evaluateOpsCheck,
  opsCheckDefinition,
  opsStatusFails,
  overallOpsStatus,
  trackSyncHorizon,
  workerHeartbeatAgeS,
} from './ops-checks.js';

describe('operational check definitions', () => {
  it('defines every code once, with ordered thresholds and a snake_case code with its unit', () => {
    expect(OPS_CHECKS.map((d) => d.code)).toEqual([...OPS_CHECK_CODES]);
    for (const definition of OPS_CHECKS) {
      expect(definition.code).toMatch(/^[a-z][a-z0-9_]{1,62}$/);
      expect(definition.code.endsWith(`_${definition.unit}`), definition.code).toBe(true);
      expect(definition.warning).toBeGreaterThan(0);
      expect(definition.critical).toBeGreaterThanOrEqual(definition.warning);
      expect(definition.description).not.toBe('');
    }
  });

  it('only the heartbeat is measured by the API, and a missing heartbeat is critical', () => {
    expect(OPS_CHECKS.filter((d) => d.measuredBy === 'api').map((d) => d.code)).toEqual([
      'worker_heartbeat_s',
    ]);
    expect(opsCheckDefinition('worker_heartbeat_s').whenMissing).toBe('critical');
    expect(opsCheckDefinition('job_backlog_s').whenMissing).toBe('unknown');
  });
});

describe('evaluateOpsCheck', () => {
  const backlog = opsCheckDefinition('job_backlog_s');

  it.each([
    [0, 'ok'],
    [299.9, 'ok'],
    [300, 'warning'],
    [1799, 'warning'],
    [1800, 'critical'],
    [86_400, 'critical'],
  ] as const)('%d s of backlog is %s', (value, status) => {
    expect(evaluateOpsCheck(backlog, value)).toBe(status);
  });

  it('a value that could not be measured takes the definition status', () => {
    expect(evaluateOpsCheck(backlog, null)).toBe('unknown');
    expect(evaluateOpsCheck(backlog, Number.NaN)).toBe('unknown');
    expect(evaluateOpsCheck(opsCheckDefinition('worker_heartbeat_s'), null)).toBe('critical');
  });

  it('one dead-lettered job already needs attention', () => {
    const dead = opsCheckDefinition('job_dead_letter_n');
    expect(evaluateOpsCheck(dead, 0)).toBe('ok');
    expect(evaluateOpsCheck(dead, 1)).toBe('warning');
    expect(evaluateOpsCheck(dead, 10)).toBe('critical');
  });
});

describe('overallOpsStatus', () => {
  it('is the worst status, unknown above ok', () => {
    expect(overallOpsStatus(['ok', 'ok'])).toBe('ok');
    expect(overallOpsStatus(['ok', 'unknown'])).toBe('unknown');
    expect(overallOpsStatus(['unknown', 'warning', 'ok'])).toBe('warning');
    expect(overallOpsStatus(['warning', 'critical', 'unknown'])).toBe('critical');
    expect(overallOpsStatus([])).toBe('unknown');
  });

  it('only critical fails the uptime monitor', () => {
    expect(opsStatusFails('critical')).toBe(true);
    for (const status of ['ok', 'warning', 'unknown'] as const) {
      expect(opsStatusFails(status)).toBe(false);
    }
  });
});

describe('workerHeartbeatAgeS', () => {
  it('counts seconds since the last pass, never negative', () => {
    const now = new Date('2026-11-04T12:00:00Z');
    expect(workerHeartbeatAgeS(new Date('2026-11-04T11:58:30Z'), now)).toBe(90);
    expect(workerHeartbeatAgeS(new Date('2026-11-04T12:00:05Z'), now)).toBe(0);
    expect(workerHeartbeatAgeS(null, now)).toBeNull();
  });
});

describe('trackSyncHorizon', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 4, 12, minute));

  it('is not stalled without transactions newer than the horizon', () => {
    expect(trackSyncHorizon(null, { xmin: '900', xmax: '900', at: at(0) })).toEqual({
      state: null,
      stalledS: 0,
    });
    const held = { xmin: '900', since: at(0) };
    expect(trackSyncHorizon(held, { xmin: '950', xmax: '950', at: at(5) }).state).toBeNull();
  });

  it('counts from the first pass that saw the same xmin behind newer transactions', () => {
    const first = trackSyncHorizon(null, { xmin: '900', xmax: '905', at: at(0) });
    expect(first).toEqual({ state: { xmin: '900', since: at(0) }, stalledS: 0 });
    const second = trackSyncHorizon(first.state, { xmin: '900', xmax: '990', at: at(12) });
    expect(second.stalledS).toBe(12 * 60);
    expect(second.state).toEqual(first.state);
  });

  it('starts over when the horizon moves', () => {
    const held = { xmin: '900', since: at(0) };
    expect(trackSyncHorizon(held, { xmin: '901', xmax: '990', at: at(20) })).toEqual({
      state: { xmin: '901', since: at(20) },
      stalledS: 0,
    });
  });

  it('compares 64-bit transaction ids exactly', () => {
    const big = '18446744073709551000';
    const result = trackSyncHorizon(null, { xmin: big, xmax: '18446744073709551001', at: at(0) });
    expect(result.state?.xmin).toBe(big);
  });
});
