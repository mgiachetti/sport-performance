import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ABSOLUTE_SPEED_ZONES,
  DEFAULT_RELATIVE_SPEED_ZONES,
  DEFAULT_SPEED_ZONE_SETS,
  DomainValidationError,
  classifySpeedMs,
  highSpeedThresholdMs,
  isSpeedZoneKind,
  parseSpeedZoneKind,
  speedPctOfVmax,
  speedZoneBandsMs,
  validateSpeedZoneSet,
  type AbsoluteSpeedZoneSet,
  type RelativeSpeedZoneSet,
  type SpeedZoneSet,
} from '../index.js';

function expectInvalid(fn: () => unknown, message?: RegExp): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).code).toBe('invalid_argument');
    if (message) expect((error as Error).message).toMatch(message);
    return;
  }
  expect.fail('expected a DomainValidationError');
}

const absolute = (
  zones: AbsoluteSpeedZoneSet['zones'],
  highSpeedZoneCode = 'hsr',
): AbsoluteSpeedZoneSet => ({ kind: 'absolute', zones, highSpeedZoneCode });

describe('speed zone kinds', () => {
  it('guards and parses the closed set', () => {
    expect(isSpeedZoneKind('absolute')).toBe(true);
    expect(isSpeedZoneKind('relative')).toBe(true);
    expect(isSpeedZoneKind('kmh')).toBe(false);
    expect(parseSpeedZoneKind('relative')).toBe('relative');
    expectInvalid(() => parseSpeedZoneKind('pct'));
  });
});

describe('default zones', () => {
  it('are valid', () => {
    expect(() => {
      validateSpeedZoneSet(DEFAULT_ABSOLUTE_SPEED_ZONES);
    }).not.toThrow();
    expect(() => {
      validateSpeedZoneSet(DEFAULT_RELATIVE_SPEED_ZONES);
    }).not.toThrow();
  });

  it('put HSR at 5.5 m/s absolute and 60% of Vmax relative (CLAUDE.md)', () => {
    expect(highSpeedThresholdMs(DEFAULT_ABSOLUTE_SPEED_ZONES)).toBe(5.5);
    expect(highSpeedThresholdMs(DEFAULT_RELATIVE_SPEED_ZONES, 9)).toBeCloseTo(5.4, 10);
  });

  it('are indexed by kind', () => {
    expect(DEFAULT_SPEED_ZONE_SETS.absolute.kind).toBe('absolute');
    expect(DEFAULT_SPEED_ZONE_SETS.relative.kind).toBe('relative');
  });

  it('are plain serialisable data, ready to seed', () => {
    expect(JSON.parse(JSON.stringify(DEFAULT_SPEED_ZONE_SETS))).toEqual(DEFAULT_SPEED_ZONE_SETS);
  });
});

describe('validateSpeedZoneSet', () => {
  it('rejects an empty set', () => {
    expectInvalid(() => {
      validateSpeedZoneSet(absolute([]));
    }, /at least one zone/);
  });

  it('rejects an unknown kind', () => {
    expectInvalid(() => {
      validateSpeedZoneSet({ ...absolute([{ code: 'a', minSpeedMs: 0 }]), kind: 'kmh' } as never);
    }, /kind/);
  });

  it('requires the first zone to start at 0', () => {
    expectInvalid(() => {
      validateSpeedZoneSet(
        absolute([
          { code: 'low', minSpeedMs: 1 },
          { code: 'hsr', minSpeedMs: 5.5 },
        ]),
      );
    }, /start at 0/);
  });

  it('requires strictly increasing finite bounds', () => {
    expectInvalid(() => {
      validateSpeedZoneSet(
        absolute([
          { code: 'low', minSpeedMs: 0 },
          { code: 'mid', minSpeedMs: 5.5 },
          { code: 'hsr', minSpeedMs: 5.5 },
        ]),
      );
    }, /strictly increasing/);
    expectInvalid(() => {
      validateSpeedZoneSet(
        absolute([
          { code: 'low', minSpeedMs: 0 },
          { code: 'hsr', minSpeedMs: Number.NaN },
        ]),
      );
    }, /finite/);
    expectInvalid(() => {
      validateSpeedZoneSet(
        absolute([
          { code: 'low', minSpeedMs: 0 },
          { code: 'hsr', minSpeedMs: '5.5' as unknown as number },
        ]),
      );
    }, /finite/);
  });

  it('caps absolute bounds at 15 m/s (catches km/h typed as m/s)', () => {
    expectInvalid(() => {
      validateSpeedZoneSet(
        absolute([
          { code: 'low', minSpeedMs: 0 },
          { code: 'hsr', minSpeedMs: 19.8 },
        ]),
      );
    }, /exceeds 15/);
    expect(() => {
      validateSpeedZoneSet(
        absolute([
          { code: 'low', minSpeedMs: 0 },
          { code: 'hsr', minSpeedMs: 15 },
        ]),
      );
    }).not.toThrow();
  });

  it('caps relative bounds at 100% of Vmax', () => {
    const relative: RelativeSpeedZoneSet = {
      kind: 'relative',
      zones: [
        { code: 'low', minVmaxPct: 0 },
        { code: 'hsr', minVmaxPct: 600 },
      ],
      highSpeedZoneCode: 'hsr',
    };
    expectInvalid(() => {
      validateSpeedZoneSet(relative);
    }, /exceeds 100/);
  });

  it('requires unique, well-formed codes', () => {
    expectInvalid(() => {
      validateSpeedZoneSet(
        absolute([
          { code: 'hsr', minSpeedMs: 0 },
          { code: 'hsr', minSpeedMs: 5.5 },
        ]),
      );
    }, /Duplicate/);
    expectInvalid(() => {
      validateSpeedZoneSet(
        absolute([
          { code: 'Band 1', minSpeedMs: 0 },
          { code: 'hsr', minSpeedMs: 5.5 },
        ]),
      );
    }, /snake_case/);
  });

  it('requires an existing high-speed zone other than the first', () => {
    const zones = [
      { code: 'low', minSpeedMs: 0 },
      { code: 'hsr', minSpeedMs: 5.5 },
    ];
    expectInvalid(() => {
      validateSpeedZoneSet(absolute(zones, 'sprint'));
    }, /not one of the zones/);
    expectInvalid(() => {
      validateSpeedZoneSet(absolute(zones, 'low'));
    }, /first zone/);
  });
});

describe('speedZoneBandsMs', () => {
  it('returns absolute bands with exclusive upper bounds and an open last band', () => {
    expect(speedZoneBandsMs(DEFAULT_ABSOLUTE_SPEED_ZONES)).toEqual([
      { code: 'walking', minSpeedMs: 0, maxSpeedMs: 2 },
      { code: 'jogging', minSpeedMs: 2, maxSpeedMs: 4 },
      { code: 'running', minSpeedMs: 4, maxSpeedMs: 5.5 },
      { code: 'high_speed_running', minSpeedMs: 5.5, maxSpeedMs: 7 },
      { code: 'sprinting', minSpeedMs: 7, maxSpeedMs: null },
    ]);
  });

  it('ignores vmaxMs for absolute sets', () => {
    expect(speedZoneBandsMs(DEFAULT_ABSOLUTE_SPEED_ZONES, 8)).toEqual(
      speedZoneBandsMs(DEFAULT_ABSOLUTE_SPEED_ZONES),
    );
  });

  it("scales relative bands by the player's Vmax", () => {
    const bands = speedZoneBandsMs(DEFAULT_RELATIVE_SPEED_ZONES, 8);
    expect(bands.map((band) => band.code)).toEqual(
      DEFAULT_RELATIVE_SPEED_ZONES.zones.map((zone) => zone.code),
    );
    expect(bands.map((band) => band.minSpeedMs)).toEqual([0, 3.2, 4.8, 6.4, 7.2]);
    expect(bands.map((band) => band.maxSpeedMs)).toEqual([3.2, 4.8, 6.4, 7.2, null]);
  });

  it('requires a usable reference Vmax for relative sets', () => {
    for (const vmaxMs of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectInvalid(() => speedZoneBandsMs(DEFAULT_RELATIVE_SPEED_ZONES, vmaxMs), /reference Vmax/);
    }
  });

  it('validates the set first', () => {
    expectInvalid(() => speedZoneBandsMs(absolute([])));
  });
});

describe('highSpeedThresholdMs', () => {
  it("is the lower bound of the high-speed zone, e.g. the first team's own threshold", () => {
    const firstTeam: SpeedZoneSet = absolute([
      { code: 'low', minSpeedMs: 0 },
      { code: 'hsr', minSpeedMs: 5 },
      { code: 'sprint', minSpeedMs: 7 },
    ]);
    expect(highSpeedThresholdMs(firstTeam)).toBe(5);
  });

  it('relative threshold follows the player: 60% of 7.5 m/s is 4.5 m/s', () => {
    expect(highSpeedThresholdMs(DEFAULT_RELATIVE_SPEED_ZONES, 7.5)).toBeCloseTo(4.5, 10);
  });
});

describe('classifySpeedMs', () => {
  const bands = speedZoneBandsMs(DEFAULT_ABSOLUTE_SPEED_ZONES);

  it('classifies with inclusive lower bounds', () => {
    expect(classifySpeedMs(0, bands)).toBe('walking');
    expect(classifySpeedMs(1.99, bands)).toBe('walking');
    expect(classifySpeedMs(2, bands)).toBe('jogging');
    expect(classifySpeedMs(5.49, bands)).toBe('running');
    expect(classifySpeedMs(5.5, bands)).toBe('high_speed_running');
    expect(classifySpeedMs(7, bands)).toBe('sprinting');
    expect(classifySpeedMs(11, bands)).toBe('sprinting');
  });

  it('classifies relative bands for a given player', () => {
    const relative = speedZoneBandsMs(DEFAULT_RELATIVE_SPEED_ZONES, 8);
    expect(classifySpeedMs(4.79, relative)).toBe('moderate_intensity');
    expect(classifySpeedMs(4.8, relative)).toBe('high_speed_running');
    expect(classifySpeedMs(8.1, relative)).toBe('near_max_sprinting');
  });

  it('rejects negative or non-finite speeds', () => {
    for (const speedMs of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectInvalid(() => classifySpeedMs(speedMs, bands), /speedMs/);
    }
  });

  it('rejects bands that do not start at 0', () => {
    expectInvalid(() => classifySpeedMs(1, []), /start at 0/);
  });
});

describe('speedPctOfVmax', () => {
  it('returns the speed as % of the reference Vmax', () => {
    expect(speedPctOfVmax(7.2, 8)).toBeCloseTo(90, 10);
    expect(speedPctOfVmax(0, 8)).toBe(0);
  });

  it('can exceed 100 when the player beats the reference', () => {
    expect(speedPctOfVmax(8.4, 8)).toBeCloseTo(105, 10);
  });

  it('rejects invalid inputs', () => {
    expectInvalid(() => speedPctOfVmax(-1, 8));
    expectInvalid(() => speedPctOfVmax(7, 0));
  });
});
