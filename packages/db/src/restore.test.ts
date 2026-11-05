import { describe, expect, it } from 'vitest';
import { evaluateRestore, RestoreToolError, type RestoreFacts } from './restore.js';
import { parseInstant, parseRestoreCommand } from './restore-cli.js';

const MARKER_BEFORE = '0f6c1a52-7c1e-4b8e-9d0e-2a4b6c8d0e1f';
const MARKER_AFTER = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const TARGET = new Date('2026-11-04T15:30:00Z');

function healthy(overrides: Partial<RestoreFacts> = {}): RestoreFacts {
  return {
    checkedAt: new Date('2026-11-04T16:10:00Z'),
    environment: 'staging',
    serverVersion: '16.10',
    sizeBytes: 123_456_789,
    inRecovery: false,
    localMigrations: ['a', 'b', 'c'],
    appliedMigrations: ['a', 'b', 'c'],
    jobQueueVersion: 26,
    roles: [
      { role: 'sport_performance_app', exists: true, logins: 1 },
      { role: 'sport_performance_auth', exists: true, logins: 1 },
      { role: 'sport_performance_worker', exists: true, logins: 1 },
    ],
    tablesWithoutRls: [],
    disabledTriggers: [],
    triggerCount: 180,
    markersFound: [{ id: MARKER_BEFORE, createdAt: new Date('2026-11-04T15:28:00Z') }],
    latestWriteAt: new Date('2026-11-04T15:29:41Z'),
    restoreEvents: 0,
    tables: [{ table: 'public.player', rows: 120 }],
    ...overrides,
  };
}

const drill = {
  recoveryTargetAt: TARGET,
  presentMarkerIds: [MARKER_BEFORE],
  absentMarkerIds: [MARKER_AFTER],
};

const statusOf = (report: ReturnType<typeof evaluateRestore>, name: string) =>
  report.checks.find((c) => c.name === name)?.status;

describe('evaluateRestore', () => {
  it('passes a healthy copy restored to the target, with the gap to the latest write', () => {
    const report = evaluateRestore(healthy(), drill);
    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.status === 'pass')).toBe(true);
    expect(report.checks.map((c) => c.name)).toEqual([
      'recovery_finished',
      'migrations',
      'job_queue',
      'connection_roles',
      'row_level_security',
      'triggers',
      'drill_markers',
      'recovery_point',
    ]);
    expect(report.recoveryTargetAt).toBe('2026-11-04T15:30:00.000Z');
    expect(report.latestWriteAt).toBe('2026-11-04T15:29:41.000Z');
    expect(report.secondsBetweenLatestWriteAndTarget).toBe(19);
    expect(report.tables).toEqual([{ table: 'public.player', rows: 120 }]);
  });

  it('fails when the marker written after the target is there (restored too late, or the source)', () => {
    const report = evaluateRestore(
      healthy({
        markersFound: [
          { id: MARKER_BEFORE, createdAt: new Date('2026-11-04T15:28:00Z') },
          { id: MARKER_AFTER, createdAt: new Date('2026-11-04T15:33:00Z') },
        ],
      }),
      drill,
    );
    expect(report.ok).toBe(false);
    expect(statusOf(report, 'drill_markers')).toBe('fail');
    expect(report.checks.find((c) => c.name === 'drill_markers')?.detail).toContain(MARKER_AFTER);
  });

  it('fails when the marker written before the target is missing (restored too early)', () => {
    const report = evaluateRestore(healthy({ markersFound: [] }), drill);
    expect(statusOf(report, 'drill_markers')).toBe('fail');
    expect(report.ok).toBe(false);
  });

  it('matches marker ids without regard to case', () => {
    const report = evaluateRestore(healthy(), {
      ...drill,
      presentMarkerIds: [MARKER_BEFORE.toUpperCase()],
    });
    expect(statusOf(report, 'drill_markers')).toBe('pass');
  });

  it('fails when a row is later than the target beyond the clock skew, and allows the skew', () => {
    const late = healthy({ latestWriteAt: new Date('2026-11-04T15:30:07Z') });
    expect(statusOf(evaluateRestore(late, drill), 'recovery_point')).toBe('fail');
    expect(
      statusOf(evaluateRestore(late, { ...drill, clockSkewMs: 10_000 }), 'recovery_point'),
    ).toBe('pass');
    const withinDefault = healthy({ latestWriteAt: new Date('2026-11-04T15:30:03Z') });
    expect(statusOf(evaluateRestore(withinDefault, drill), 'recovery_point')).toBe('pass');
  });

  it('leaves out the marker check without markers and reports the latest write without a target', () => {
    const report = evaluateRestore(healthy());
    expect(report.checks.some((c) => c.name === 'drill_markers')).toBe(false);
    expect(statusOf(report, 'recovery_point')).toBe('pass');
    expect(report.secondsBetweenLatestWriteAndTarget).toBeNull();
  });

  it('warns on pending or unknown migrations, fails with none applied', () => {
    expect(
      statusOf(evaluateRestore(healthy({ appliedMigrations: ['a', 'b'] })), 'migrations'),
    ).toBe('warn');
    expect(
      statusOf(evaluateRestore(healthy({ appliedMigrations: ['a', 'b', 'c', 'd'] })), 'migrations'),
    ).toBe('warn');
    const empty = evaluateRestore(healthy({ appliedMigrations: [] }));
    expect(statusOf(empty, 'migrations')).toBe('fail');
    expect(empty.ok).toBe(false);
    // Warnings alone keep the report ok.
    expect(evaluateRestore(healthy({ appliedMigrations: ['a', 'b'] })).ok).toBe(true);
  });

  it('fails while the server is still recovering, without the job queue, RLS or triggers', () => {
    expect(statusOf(evaluateRestore(healthy({ inRecovery: true })), 'recovery_finished')).toBe(
      'fail',
    );
    expect(statusOf(evaluateRestore(healthy({ jobQueueVersion: null })), 'job_queue')).toBe('fail');
    expect(
      statusOf(
        evaluateRestore(healthy({ tablesWithoutRls: ['public.player', 'medical.injury'] })),
        'row_level_security',
      ),
    ).toBe('fail');
    expect(
      statusOf(
        evaluateRestore(healthy({ disabledTriggers: ['public.player.player_set_updated_at'] })),
        'triggers',
      ),
    ).toBe('fail');
    expect(statusOf(evaluateRestore(healthy({ triggerCount: 0 })), 'triggers')).toBe('fail');
  });

  it('fails without a connection role and warns when a role has no login', () => {
    const roles = healthy().roles;
    expect(
      statusOf(
        evaluateRestore(
          healthy({
            roles: roles.map((r, i) => (i === 0 ? { ...r, exists: false, logins: 0 } : r)),
          }),
        ),
        'connection_roles',
      ),
    ).toBe('fail');
    expect(
      statusOf(
        evaluateRestore(
          healthy({ roles: roles.map((r, i) => (i === 1 ? { ...r, logins: 0 } : r)) }),
        ),
        'connection_roles',
      ),
    ).toBe('warn');
  });

  it('warns on an empty database', () => {
    expect(
      statusOf(evaluateRestore(healthy({ latestWriteAt: null }), drill), 'recovery_point'),
    ).toBe('warn');
  });
});

describe('parseInstant', () => {
  it('takes instants with an offset', () => {
    expect(parseInstant('2026-11-04T15:30:00Z', 't').toISOString()).toBe(
      '2026-11-04T15:30:00.000Z',
    );
    expect(parseInstant('2026-11-04T12:30-03:00', 't').toISOString()).toBe(
      '2026-11-04T15:30:00.000Z',
    );
  });

  it('refuses a time without its offset or a relative one', () => {
    for (const value of ['2026-11-04T15:30:00', '2026-11-04 15:30', '30m', 'yesterday']) {
      expect(() => parseInstant(value, 't')).toThrow(RestoreToolError);
    }
  });
});

describe('parseRestoreCommand', () => {
  const env = {
    MIGRATIONS_DATABASE_URL: 'postgres://owner@source/db',
    RESTORE_DATABASE_URL: 'postgres://owner@restored/db',
    RAILWAY_ENVIRONMENT_NAME: 'staging',
  };

  it('marks on the source, with the Railway environment by default', () => {
    expect(parseRestoreCommand(['mark', '--label=before'], env)).toEqual({
      command: 'mark',
      connectionString: 'postgres://owner@source/db',
      environment: 'staging',
      label: 'before',
    });
    expect(() =>
      parseRestoreCommand(['mark'], { MIGRATIONS_DATABASE_URL: 'postgres://owner@source/db' }),
    ).toThrow(/--environment/);
  });

  it('verifies only the restored database, never falling back to the source', () => {
    expect(
      parseRestoreCommand(
        [
          'verify',
          '--target=2026-11-04T15:30:00Z',
          `--present=${MARKER_BEFORE.toUpperCase()}`,
          `--absent= ${MARKER_AFTER} ,`,
          '--clock-skew-ms=2000',
          '--no-row-counts',
        ],
        env,
      ),
    ).toEqual({
      command: 'verify',
      connectionString: 'postgres://owner@restored/db',
      recoveryTargetAt: TARGET,
      presentMarkerIds: [MARKER_BEFORE],
      absentMarkerIds: [MARKER_AFTER],
      clockSkewMs: 2000,
      countRows: false,
    });
    expect(() =>
      parseRestoreCommand(['verify'], { MIGRATIONS_DATABASE_URL: 'postgres://owner@source/db' }),
    ).toThrow(/RESTORE_DATABASE_URL/);
  });

  it('needs a target for markers and a sane clock skew', () => {
    expect(() => parseRestoreCommand(['verify', `--present=${MARKER_BEFORE}`], env)).toThrow(
      /--target/,
    );
    expect(() => parseRestoreCommand(['verify', '--clock-skew-ms=-1'], env)).toThrow(
      /--clock-skew-ms/,
    );
  });

  it('records a restore with its kind, target and reason', () => {
    expect(
      parseRestoreCommand(
        [
          'record',
          '--kind=incident',
          '--target=2026-11-04T15:30:00Z',
          '--reason=Migración fallida',
        ],
        env,
      ),
    ).toEqual({
      command: 'record',
      connectionString: 'postgres://owner@restored/db',
      kind: 'incident',
      environment: 'staging',
      recoveryTargetAt: TARGET,
      reason: 'Migración fallida',
    });
    expect(() =>
      parseRestoreCommand(
        ['record', '--kind=oops', '--target=2026-11-04T15:30:00Z', '--reason=x'],
        env,
      ),
    ).toThrow(/--kind/);
    expect(() =>
      parseRestoreCommand(['record', '--kind=drill', '--target=2026-11-04T15:30:00Z'], env),
    ).toThrow(/--reason/);
  });

  it('refuses unknown commands and options', () => {
    expect(() => parseRestoreCommand([], env)).toThrow(/Usage/);
    expect(() => parseRestoreCommand(['drop'], env)).toThrow(/Usage/);
    expect(() => parseRestoreCommand(['verify', '--force'], env)).toThrow();
  });
});
