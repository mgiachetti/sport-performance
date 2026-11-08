import { describe, expect, it } from 'vitest';
import { FILE_KIND_POLICIES } from '../files.js';
import { LOCATION_ERASURE_FILE_KINDS, LOCATION_ERASURE_TABLES } from '../location-erasure.js';
import { parseLocalDate, parseTimeZone } from '../time.js';
import {
  POD_DATA_CONSENTS,
  POD_METHOD_VARIANTS,
  POD_RAW_PENDING_DAYS_DEFAULT,
  POD_RAW_UPLOAD_STATES,
  consentCoverage,
  decimateByTime,
  intersectIntervals,
  intervalsContain,
  intervalsOverlap,
  isPodRawPendingDays,
  normalizeIntervals,
  podDataWindows,
  podRawPendingUntil,
  podRawTrimDue,
  resolvePodSettings,
  sessionWindow,
  type ConsentCoverageRecord,
} from './pod-raw.js';

const TZ = parseTimeZone('America/Argentina/Buenos_Aires');
const at = (iso: string) => new Date(iso).getTime();
const range = (from: string, to: string) => ({ startMs: at(from), endMs: at(to) });

describe('pod_raw vocabulary', () => {
  it('names the states, variants and consents of ADR 0106', () => {
    expect(POD_RAW_UPLOAD_STATES).toEqual([
      'uploading',
      'pending',
      'verified',
      'trimmed',
      'rejected',
    ]);
    expect(POD_METHOD_VARIANTS).toEqual(['pod_live', 'pod_log', 'pod_ppk', 'pod_rtk', 'pod_uwb']);
    expect(POD_DATA_CONSENTS).toEqual(['data', 'location']);
  });

  it('keeps pending files a bounded number of days', () => {
    expect(isPodRawPendingDays(POD_RAW_PENDING_DAYS_DEFAULT)).toBe(true);
    expect(isPodRawPendingDays(0)).toBe(false);
    expect(isPodRawPendingDays(31)).toBe(false);
    expect(isPodRawPendingDays(2.5)).toBe(false);
    expect(podRawPendingUntil(new Date('2026-11-01T10:00:00Z'), 7).toISOString()).toBe(
      '2026-11-08T10:00:00.000Z',
    );
  });

  it('is a file of no player until trimmed, never downloaded, and erased with location', () => {
    expect(FILE_KIND_POLICIES.pod_raw).toMatchObject({
      subject: 'player_optional',
      clientUpload: false,
      contentTypes: ['application/octet-stream'],
    });
    expect(LOCATION_ERASURE_TABLES).toEqual(['public.pod_trace_segment', 'public.pod_raw_trim']);
    expect(LOCATION_ERASURE_FILE_KINDS).toEqual(['pod_raw']);
  });
});

describe('intervals', () => {
  it('normalizes, intersects and searches half-open intervals', () => {
    expect(
      normalizeIntervals([
        { startMs: 10, endMs: 20 },
        { startMs: 0, endMs: 5 },
        { startMs: 5, endMs: 8 },
        { startMs: 15, endMs: 30 },
        { startMs: 40, endMs: 40 },
      ]),
    ).toEqual([
      { startMs: 0, endMs: 8 },
      { startMs: 10, endMs: 30 },
    ]);
    expect(
      intersectIntervals(
        [
          { startMs: 0, endMs: 10 },
          { startMs: 20, endMs: 30 },
        ],
        [{ startMs: 5, endMs: 25 }],
      ),
    ).toEqual([
      { startMs: 5, endMs: 10 },
      { startMs: 20, endMs: 25 },
    ]);
    const set = [
      { startMs: 0, endMs: 10 },
      { startMs: 20, endMs: 30 },
    ];
    expect(intervalsContain(set, 0)).toBe(true);
    expect(intervalsContain(set, 10)).toBe(false);
    expect(intervalsContain(set, 25)).toBe(true);
    expect(intervalsContain(set, 31)).toBe(false);
    expect(intervalsOverlap(set, 10, 19)).toBe(false);
    expect(intervalsOverlap(set, 10, 20)).toBe(true);
  });

  it('gives a session its planned window, or two hours', () => {
    const startsAt = new Date('2026-11-04T21:00:00Z');
    expect(sessionWindow({ startsAt, plannedDurationMin: 90 })).toEqual(
      range('2026-11-04T21:00:00Z', '2026-11-04T22:30:00Z'),
    );
    expect(sessionWindow({ startsAt, plannedDurationMin: null })).toEqual(
      range('2026-11-04T21:00:00Z', '2026-11-04T23:00:00Z'),
    );
  });

  it('keeps the first sample of each second', () => {
    const samples = [0, 100, 900, 1000, 1500, 2999, 3000].map((timeMs) => ({ timeMs }));
    expect(decimateByTime(samples).map((s) => s.timeMs)).toEqual([0, 1000, 2999, 3000]);
  });
});

describe('consent per instant (#305)', () => {
  // Of age on 10/11/2026 (club day).
  const birthDate = parseLocalDate('2008-11-10');
  const record = (r: Partial<ConsentCoverageRecord>): ConsentCoverageRecord => ({
    type: 'location',
    signerKind: 'guardian',
    signedAt: new Date('2026-01-01T12:00:00Z'),
    revokedAt: null,
    supersededAt: null,
    ...r,
  });

  it('a guardian signs location only until the majority, data with the grace', () => {
    const majority = at('2026-11-10T03:00:00Z');
    expect(
      consentCoverage({ type: 'location', records: [record({})], birthDate, timeZone: TZ }),
    ).toEqual([{ startMs: at('2026-01-01T12:00:00Z'), endMs: majority }]);
    expect(
      consentCoverage({
        type: 'data',
        records: [record({ type: 'data' })],
        birthDate,
        timeZone: TZ,
      }),
    ).toEqual([{ startMs: at('2026-01-01T12:00:00Z'), endMs: at('2026-12-10T03:00:00Z') }]);
    // The adult's own signature counts from when they sign.
    const adult = record({ signerKind: 'player', signedAt: new Date('2026-11-20T12:00:00Z') });
    expect(
      consentCoverage({ type: 'location', records: [record({}), adult], birthDate, timeZone: TZ }),
    ).toEqual([
      { startMs: at('2026-01-01T12:00:00Z'), endMs: majority },
      { startMs: at('2026-11-20T12:00:00Z'), endMs: Number.POSITIVE_INFINITY },
    ]);
  });

  it('an older text stops location where it was superseded, not data', () => {
    const supersededAt = new Date('2026-06-01T00:00:00Z');
    expect(
      consentCoverage({
        type: 'location',
        records: [record({ supersededAt })],
        birthDate,
        timeZone: TZ,
      }),
    ).toEqual([range('2026-01-01T12:00:00Z', '2026-06-01T00:00:00Z')]);
    expect(
      consentCoverage({
        type: 'data',
        records: [record({ type: 'data', supersededAt })],
        birthDate,
        timeZone: TZ,
      })[0]?.endMs,
    ).toBe(at('2026-12-10T03:00:00Z'));
  });

  it('a revoked location never counts again; a revoked data counts until then', () => {
    const revokedAt = new Date('2026-05-01T00:00:00Z');
    expect(
      consentCoverage({
        type: 'location',
        records: [record({ revokedAt })],
        birthDate,
        timeZone: TZ,
      }),
    ).toEqual([]);
    expect(
      consentCoverage({
        type: 'data',
        records: [record({ type: 'data', revokedAt })],
        birthDate,
        timeZone: TZ,
      }),
    ).toEqual([range('2026-01-01T12:00:00Z', '2026-05-01T00:00:00Z')]);
  });
});

describe('podDataWindows', () => {
  const session = range('2026-11-04T21:00:00Z', '2026-11-04T22:30:00Z');
  const other = range('2026-11-05T21:00:00Z', '2026-11-05T22:30:00Z');
  const always = [{ startMs: 0, endMs: Number.POSITIVE_INFINITY }];

  it('is session × assignment × consents', () => {
    const windows = podDataWindows({
      assignments: [
        { range: range('2026-11-04T20:00:00Z', '2026-11-04T22:00:00Z'), sessionWindow: null },
      ],
      sessionWindows: [session, other],
      consentCoverages: [always, [range('2026-11-04T21:30:00Z', '2026-12-01T00:00:00Z')]],
    });
    expect(windows).toEqual([range('2026-11-04T21:30:00Z', '2026-11-04T22:00:00Z')]);
  });

  it('an assignment for a session counts only in that session', () => {
    const windows = podDataWindows({
      assignments: [
        { range: range('2026-11-04T00:00:00Z', '2026-11-06T00:00:00Z'), sessionWindow: session },
      ],
      sessionWindows: [session, other],
      consentCoverages: [always, always],
    });
    expect(windows).toEqual([session]);
  });

  it('nothing without a consent', () => {
    expect(
      podDataWindows({
        assignments: [{ range: session, sessionWindow: null }],
        sessionWindows: [session],
        consentCoverages: [always, []],
      }),
    ).toEqual([]);
  });
});

describe('podRawTrimDue', () => {
  const now = new Date('2026-11-05T00:00:00Z');
  const later = new Date('2026-11-10T00:00:00Z');
  const ended = new Date('2026-11-04T22:30:00Z');

  it('waits for the sessions and the assignments, never past the pending days', () => {
    const base = {
      now,
      pendingUntil: later,
      sessionEnds: [ended],
      openAssignment: false,
    };
    expect(podRawTrimDue(base)).toBe(true);
    expect(podRawTrimDue({ ...base, sessionEnds: [ended, new Date('2026-11-05T01:00:00Z')] })).toBe(
      false,
    );
    expect(podRawTrimDue({ ...base, openAssignment: true })).toBe(false);
    // No session yet: the staff may load it late.
    expect(podRawTrimDue({ ...base, sessionEnds: [] })).toBe(false);
    expect(podRawTrimDue({ ...base, sessionEnds: [], openAssignment: true, now: later })).toBe(
      true,
    );
  });
});

describe('pod settings', () => {
  it('resolves the stored JSON over the defaults', () => {
    expect(resolvePodSettings(undefined)).toEqual({ rawPendingDays: 7 });
    expect(resolvePodSettings({ rawPendingDays: 14 })).toEqual({ rawPendingDays: 14 });
    expect(resolvePodSettings({ rawPendingDays: 90 })).toEqual({ rawPendingDays: 7 });
    expect(resolvePodSettings({ rawPendingDays: '3' })).toEqual({ rawPendingDays: 7 });
  });
});
