import {
  CLUB_MODULES,
  DEFAULT_ALERT_RULES,
  DEFAULT_SPEED_ZONE_SETS,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import {
  clubModulesSchema,
  createAlertRule,
  createBatteryEntry,
  createSpeedZoneConfig,
  getEffectiveBattery,
  speedZoneSetSchema,
  updateAlertRule,
  updateClubModules,
} from './index.js';

describe('configuration contracts', () => {
  it('lives under /v1/configuration, for a club', () => {
    for (const endpoint of [createBatteryEntry, createSpeedZoneConfig, createAlertRule]) {
      expect(endpoint.path.startsWith('/v1/configuration/')).toBe(true);
      expect(endpoint.auth).toBe('club');
      expect(endpoint.errors).toContain('conflict');
    }
    expect(getEffectiveBattery.path).toBe('/v1/configuration/battery/effective');
  });

  it('accepts the seeded defaults of the domain', () => {
    expect(speedZoneSetSchema.safeParse(DEFAULT_SPEED_ZONE_SETS.absolute).success).toBe(true);
    expect(speedZoneSetSchema.safeParse(DEFAULT_SPEED_ZONE_SETS.relative).success).toBe(true);
    for (const rule of DEFAULT_ALERT_RULES) {
      expect(createAlertRule.body.safeParse(rule).success, rule.code).toBe(true);
    }
  });

  it('keeps zone sets of one kind', () => {
    expect(
      speedZoneSetSchema.safeParse({
        kind: 'relative',
        zones: [{ code: 'walking', minSpeedMs: 0 }],
        highSpeedZoneCode: 'walking',
      }).success,
    ).toBe(false);
    expect(
      speedZoneSetSchema.safeParse({ ...DEFAULT_SPEED_ZONE_SETS.absolute, zones: [] }).success,
    ).toBe(false);
  });

  it('types the params of each alert rule kind', () => {
    const wrongParams = {
      code: 'acwr_custom',
      kind: 'acwr_high',
      params: { warningBelowScore: 3, criticalBelowScore: null },
    };
    expect(createAlertRule.body.safeParse(wrongParams).success).toBe(false);
    expect(
      updateAlertRule.body.safeParse({ version: '1', params: { warningBelowScore: 3 } }).success,
    ).toBe(false);
    expect(updateAlertRule.body.safeParse({ version: '1', appliesTo: null }).success).toBe(true);
  });

  it('describes every module and only those', () => {
    const all = Object.fromEntries(CLUB_MODULES.map((module) => [module, true]));
    expect(clubModulesSchema.safeParse(all).success).toBe(true);
    expect(clubModulesSchema.safeParse({ ...all, rankings: true }).success).toBe(false);
    expect(
      updateClubModules.body.safeParse({ version: '1', modules: { gym: false } }).success,
    ).toBe(true);
    expect(
      updateClubModules.body.safeParse({ version: '1', modules: { rankings: false } }).success,
    ).toBe(false);
  });

  it('bounds the battery schedule', () => {
    const base = { sport: 'rugby', testCode: 'cmj' };
    expect(createBatteryEntry.body.safeParse({ ...base, windows: [1, 3] }).success).toBe(true);
    expect(createBatteryEntry.body.safeParse({ ...base, windows: [0] }).success).toBe(false);
    expect(createBatteryEntry.body.safeParse({ ...base, testCode: 'CMJ' }).success).toBe(false);
    expect(
      createBatteryEntry.body.safeParse({ ...base, cadenceWeeks: { min: 0, max: 2 } }).success,
    ).toBe(false);
  });
});
