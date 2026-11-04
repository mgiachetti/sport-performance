import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ABSOLUTE_SPEED_ZONES,
  DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES,
  DEFAULT_RELATIVE_SPEED_ZONES,
  DEFAULT_SPEED_ZONE_SETS_BY_SEX,
  DEFAULT_SPEED_ZONE_SOURCES,
  SEXES,
  SPEED_ZONE_KINDS,
  defaultSpeedZoneSet,
  highSpeedThresholdMs,
  validateSpeedZoneSet,
} from '../index.js';

const kmh = (speedMs: number) => speedMs * 3.6;

describe('sex-specific default zones (B-804)', () => {
  it('are valid zone sets of their kind', () => {
    for (const sex of SEXES) {
      for (const kind of SPEED_ZONE_KINDS) {
        const zoneSet = DEFAULT_SPEED_ZONE_SETS_BY_SEX[sex][kind];
        if (zoneSet === undefined) continue;
        expect(zoneSet.kind).toBe(kind);
        expect(() => {
          validateSpeedZoneSet(zoneSet);
        }).not.toThrow();
      }
    }
  });

  it('give women the FAiM bounds with the same zone codes as men', () => {
    expect(DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES.zones.map((z) => z.code)).toEqual(
      DEFAULT_ABSOLUTE_SPEED_ZONES.zones.map((z) => z.code),
    );
    expect(DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES.highSpeedZoneCode).toBe(
      DEFAULT_ABSOLUTE_SPEED_ZONES.highSpeedZoneCode,
    );
    const bounds = Object.fromEntries(
      DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES.zones.map((z) => [z.code, kmh(z.minSpeedMs)]),
    );
    expect(bounds['running']).toBeCloseTo(12.5, 1);
    expect(bounds['high_speed_running']).toBeCloseTo(19.0, 1);
    expect(bounds['sprinting']).toBeCloseTo(22.5, 1);
    expect(highSpeedThresholdMs(DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES)).toBe(5.28);
    // Every female bound is at or below the male one.
    DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES.zones.forEach((zone, index) => {
      expect(zone.minSpeedMs).toBeLessThanOrEqual(
        DEFAULT_ABSOLUTE_SPEED_ZONES.zones[index]?.minSpeedMs ?? Number.NaN,
      );
    });
  });

  it('pick the sex-specific set and fall back to the general one', () => {
    expect(defaultSpeedZoneSet('absolute', 'female')).toBe(DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES);
    expect(defaultSpeedZoneSet('absolute', 'male')).toBe(DEFAULT_ABSOLUTE_SPEED_ZONES);
    expect(defaultSpeedZoneSet('absolute', null)).toBe(DEFAULT_ABSOLUTE_SPEED_ZONES);
    expect(defaultSpeedZoneSet('absolute')).toBe(DEFAULT_ABSOLUTE_SPEED_ZONES);
    expect(defaultSpeedZoneSet('relative', 'female')).toBe(DEFAULT_RELATIVE_SPEED_ZONES);
  });

  it('cite a source for every sex-specific set, unverified until checked', () => {
    for (const sex of SEXES) {
      for (const kind of SPEED_ZONE_KINDS) {
        const hasSet = DEFAULT_SPEED_ZONE_SETS_BY_SEX[sex][kind] !== undefined;
        const source = DEFAULT_SPEED_ZONE_SOURCES[sex][kind];
        expect(source !== undefined, `${sex} ${kind}`).toBe(hasSet);
        if (source === undefined) continue;
        expect(source.citation).toMatch(/Bradley PS, Vescovi JD/);
        expect(source.verification).toBe('unverified');
        expect(source.verificationNotes).toMatch(/before production/);
      }
    }
  });

  it('survive a JSON round trip (ready for the seed)', () => {
    expect(JSON.parse(JSON.stringify(DEFAULT_SPEED_ZONE_SETS_BY_SEX))).toEqual(
      DEFAULT_SPEED_ZONE_SETS_BY_SEX,
    );
  });
});
