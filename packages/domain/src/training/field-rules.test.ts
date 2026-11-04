import { describe, expect, it } from 'vitest';
import { SPORTS } from '../sport.js';
import {
  MATCH_PERIODS_MAX,
  SPORT_FIELD_RULES,
  catapultAliasIndex,
  catapultMetricOf,
  metricAppliesToSport,
  normalizeCatapultAlias,
  periodMinutesIssues,
  periodMinutesTotal,
  recordsPeriodMinutes,
  sportRecordsContacts,
} from './index.js';

describe('sport field rules (B-803)', () => {
  it('has rules for every sport, each with its source', () => {
    for (const sport of SPORTS) {
      const rules = SPORT_FIELD_RULES[sport];
      expect(rules.source.length).toBeGreaterThan(20);
      expect(rules.matchPeriodCount).toBeGreaterThan(0);
      expect(rules.matchPeriodCount).toBeLessThanOrEqual(MATCH_PERIODS_MAX);
      expect(rules.pitch.lengthM).toBeGreaterThan(rules.pitch.widthM);
    }
  });

  it('plays hockey on a 91.4 × 55 m pitch, in quarters, without contacts', () => {
    expect(SPORT_FIELD_RULES.hockey).toMatchObject({
      substitutions: 'rolling',
      recordsContacts: false,
      matchPeriodCount: 4,
      pitch: { lengthM: 91.4, widthM: 55 },
    });
    expect(sportRecordsContacts('hockey')).toBe(false);
    expect(sportRecordsContacts('rugby')).toBe(true);
  });

  it('loads minutes by period only in matches with rolling substitutions', () => {
    expect(recordsPeriodMinutes({ sport: 'hockey', kind: 'match' })).toBe(true);
    expect(recordsPeriodMinutes({ sport: 'hockey', kind: 'training' })).toBe(false);
    expect(recordsPeriodMinutes({ sport: 'rugby', kind: 'match' })).toBe(false);
  });

  it('adds up the periods', () => {
    expect(periodMinutesTotal([15, 9, 0, 12])).toBe(36);
    expect(periodMinutesTotal([])).toBe(0);
  });

  it('checks the periods against the session', () => {
    const match = { sport: 'hockey', kind: 'match', plannedDurationMin: 60 } as const;
    expect(periodMinutesIssues(match, [15, 15, 15, 15])).toEqual([]);
    expect(periodMinutesIssues(match, [])).toEqual([{ problem: 'period_count' }]);
    expect(
      periodMinutesIssues(
        match,
        Array.from({ length: MATCH_PERIODS_MAX + 1 }, () => 1),
      ),
    ).toEqual([{ problem: 'period_count' }]);
    expect(periodMinutesIssues(match, [15, 61])).toEqual([
      { problem: 'period_too_long', index: 1 },
    ]);
    expect(periodMinutesIssues({ ...match, plannedDurationMin: null }, [200])).toEqual([]);
    expect(periodMinutesIssues({ ...match, kind: 'training' }, [15])).toEqual([
      { problem: 'not_by_period' },
    ]);
    expect(periodMinutesIssues({ ...match, sport: 'rugby' }, [40, 40])).toEqual([
      { problem: 'not_by_period' },
    ]);
  });
});

describe('Catapult alias index by sport (B-803)', () => {
  const metrics = [
    { code: 'dist_m', catapultAliases: ['Total Distance', 'Distance'] },
    { code: 'contacts_n', sports: ['rugby'] as const, catapultAliases: ['Contacts'] },
    { code: 'scrums_n', sports: ['rugby'] as const, catapultAliases: ['Scrum Count'] },
    { code: 'circle_entries_n', sports: ['hockey'] as const, catapultAliases: ['Circle Entries'] },
    { code: 'old_m', archived: true, catapultAliases: ['Old Distance'] },
    { code: 'a_m', sports: null, catapultAliases: ['Shared'] },
    { code: 'b_m', catapultAliases: [' shared '] },
  ];

  it('maps only the metrics of the sport', () => {
    const hockey = catapultAliasIndex(metrics, 'hockey');
    expect(catapultMetricOf(hockey, '  total   DISTANCE ')).toBe('dist_m');
    expect(catapultMetricOf(hockey, 'Contacts')).toBeUndefined();
    expect(catapultMetricOf(hockey, 'Scrum Count')).toBeUndefined();
    expect(catapultMetricOf(hockey, 'Circle Entries')).toBe('circle_entries_n');
    const rugby = catapultAliasIndex(metrics, 'rugby');
    expect(catapultMetricOf(rugby, 'Contacts')).toBe('contacts_n');
    expect(catapultMetricOf(rugby, 'Circle Entries')).toBeUndefined();
  });

  it('leaves archived metrics out', () => {
    expect(catapultMetricOf(catapultAliasIndex(metrics, 'rugby'), 'Old Distance')).toBeUndefined();
  });

  it('reports an alias of two metrics as a conflict that maps to neither', () => {
    const index = catapultAliasIndex(metrics, 'hockey');
    expect(catapultMetricOf(index, 'Shared')).toBeUndefined();
    expect(index.conflicts).toEqual([{ alias: 'shared', codes: ['a_m', 'b_m'] }]);
  });

  it('normalizes and scopes', () => {
    expect(normalizeCatapultAlias('  Max   Vel ')).toBe('max vel');
    expect(metricAppliesToSport(undefined, 'hockey')).toBe(true);
    expect(metricAppliesToSport(['rugby'], 'hockey')).toBe(false);
  });
});
