import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ABSOLUTE_SPEED_ZONES,
  DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES,
  DEFAULT_RELATIVE_SPEED_ZONES,
  DomainValidationError,
  findSpeedZoneConfigConflicts,
  highSpeedThresholdMs,
  isSpeedZoneConfigValidOn,
  parseClubId,
  parseLocalDate,
  parsePlayerId,
  resolveSpeedZoneConfig,
  resolveSpeedZoneSet,
  speedZoneConfigSpecificity,
  validateSpeedZoneConfig,
  type AbsoluteSpeedZoneSet,
  type LocalDate,
  type SpeedZoneConfig,
  type SpeedZoneQuery,
  type SpeedZoneSet,
} from '../index.js';

const CLUB = parseClubId('00000000-0000-4000-8000-000000000001');
const OTHER_CLUB = parseClubId('00000000-0000-4000-8000-000000000002');
const PLAYER = parsePlayerId('00000000-0000-4000-8000-0000000000a1');
const OTHER_PLAYER = parsePlayerId('00000000-0000-4000-8000-0000000000a2');

const d = (value: string): LocalDate => parseLocalDate(value);

function hsrAt(minSpeedMs: number): AbsoluteSpeedZoneSet {
  return {
    kind: 'absolute',
    zones: [
      { code: 'low', minSpeedMs: 0 },
      { code: 'hsr', minSpeedMs },
    ],
    highSpeedZoneCode: 'hsr',
  };
}

interface Row extends SpeedZoneConfig {
  readonly id: string;
}

function row(id: string, overrides: Partial<SpeedZoneConfig> = {}): Row {
  return {
    id,
    clubId: CLUB,
    sport: null,
    sex: null,
    playerId: null,
    validFrom: d('2026-01-01'),
    validTo: null,
    zoneSet: hsrAt(5.5),
    ...overrides,
  };
}

const query = (
  overrides: Partial<SpeedZoneQuery<'absolute'>> = {},
): SpeedZoneQuery<'absolute'> => ({
  clubId: CLUB,
  sport: 'rugby',
  sex: 'male',
  playerId: PLAYER,
  onDate: d('2026-06-15'),
  kind: 'absolute',
  ...overrides,
});

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

describe('validateSpeedZoneConfig', () => {
  it('accepts a well-formed configuration', () => {
    expect(() => {
      validateSpeedZoneConfig(
        row('a', { sport: 'hockey', sex: 'female', playerId: PLAYER, validTo: d('2026-07-01') }),
      );
    }).not.toThrow();
  });

  it('requires validTo strictly after validFrom (validTo is exclusive)', () => {
    expectInvalid(() => {
      validateSpeedZoneConfig(row('a', { validTo: d('2026-01-01') }));
    }, /must be after/);
    expectInvalid(() => {
      validateSpeedZoneConfig(row('a', { validTo: d('2025-12-31') }));
    }, /must be after/);
    expect(() => {
      validateSpeedZoneConfig(row('a', { validTo: d('2026-01-02') }));
    }).not.toThrow();
  });

  it('rejects malformed ids, scope and dates', () => {
    const cases: Partial<Record<keyof SpeedZoneConfig, unknown>>[] = [
      { clubId: 'club-1' },
      { playerId: 'p1' },
      { sport: 'football' },
      { sex: 'x' },
      { validFrom: '2026-13-01' },
      { validTo: '01/07/2026' },
    ];
    for (const overrides of cases) {
      expectInvalid(() => {
        validateSpeedZoneConfig(row('a', overrides as Partial<SpeedZoneConfig>));
      });
    }
  });

  it('validates the zone set', () => {
    expectInvalid(() => {
      validateSpeedZoneConfig(row('a', { zoneSet: hsrAt(0) }));
    });
  });
});

describe('isSpeedZoneConfigValidOn', () => {
  const config = row('a', { validFrom: d('2026-03-01'), validTo: d('2026-04-01') });

  it('includes validFrom and excludes validTo', () => {
    expect(isSpeedZoneConfigValidOn(config, d('2026-02-28'))).toBe(false);
    expect(isSpeedZoneConfigValidOn(config, d('2026-03-01'))).toBe(true);
    expect(isSpeedZoneConfigValidOn(config, d('2026-03-31'))).toBe(true);
    expect(isSpeedZoneConfigValidOn(config, d('2026-04-01'))).toBe(false);
  });

  it('is open ended when validTo is null', () => {
    expect(isSpeedZoneConfigValidOn(row('b'), d('2099-12-31'))).toBe(true);
  });
});

describe('speedZoneConfigSpecificity', () => {
  it('ranks player over sport over sex', () => {
    expect(speedZoneConfigSpecificity(row('a'))).toBe(0);
    expect(speedZoneConfigSpecificity(row('a', { sex: 'male' }))).toBe(1);
    expect(speedZoneConfigSpecificity(row('a', { sport: 'rugby' }))).toBe(2);
    expect(speedZoneConfigSpecificity(row('a', { sport: 'rugby', sex: 'male' }))).toBe(3);
    expect(speedZoneConfigSpecificity(row('a', { playerId: PLAYER }))).toBe(4);
    expect(
      speedZoneConfigSpecificity(row('a', { playerId: PLAYER, sport: 'rugby', sex: 'male' })),
    ).toBe(7);
  });
});

describe('resolveSpeedZoneConfig', () => {
  const club = row('club');
  const rugby = row('rugby', { sport: 'rugby' });
  const female = row('female', { sex: 'female' });
  const rugbyMale = row('rugby-male', { sport: 'rugby', sex: 'male' });
  const player = row('player', { playerId: PLAYER, zoneSet: hsrAt(5) });

  it('returns null when nothing applies', () => {
    expect(resolveSpeedZoneConfig([], query())).toBeNull();
  });

  it('picks the most specific configuration in force', () => {
    const all = [club, rugby, female, rugbyMale, player];
    expect(resolveSpeedZoneConfig(all, query())?.id).toBe('player');
    expect(resolveSpeedZoneConfig(all, query({ playerId: OTHER_PLAYER }))?.id).toBe('rugby-male');
    expect(resolveSpeedZoneConfig(all, query({ playerId: OTHER_PLAYER, sex: 'female' }))?.id).toBe(
      'rugby',
    );
    expect(
      resolveSpeedZoneConfig(all, query({ playerId: OTHER_PLAYER, sex: 'female', sport: 'hockey' }))
        ?.id,
    ).toBe('female');
    expect(
      resolveSpeedZoneConfig(all, query({ playerId: OTHER_PLAYER, sport: 'hockey' }))?.id,
    ).toBe('club');
  });

  it('ignores other clubs, kinds, scopes and configurations out of their validity', () => {
    const configs: SpeedZoneConfig[] = [
      row('other-club', { clubId: OTHER_CLUB, playerId: PLAYER }),
      row('relative', { playerId: PLAYER, zoneSet: DEFAULT_RELATIVE_SPEED_ZONES }),
      row('other-player', { playerId: OTHER_PLAYER }),
      row('hockey', { sport: 'hockey' }),
      row('female', { sex: 'female' }),
      row('expired', { playerId: PLAYER, validTo: d('2026-06-15') }),
      row('future', { playerId: PLAYER, validFrom: d('2026-06-16') }),
    ];
    expect(resolveSpeedZoneConfig(configs, query())).toBeNull();
  });

  it('follows validity over time: past sessions keep the zones they had', () => {
    const before = row('before', { validTo: d('2026-05-01'), zoneSet: hsrAt(5.5) });
    const after = row('after', { validFrom: d('2026-05-01'), zoneSet: hsrAt(5) });
    const configs = [before, after];
    expect(resolveSpeedZoneConfig(configs, query({ onDate: d('2026-04-30') }))?.id).toBe('before');
    expect(resolveSpeedZoneConfig(configs, query({ onDate: d('2026-05-01') }))?.id).toBe('after');
  });

  it('falls back to a group configuration when the player one is not in force yet', () => {
    const configs = [club, row('player', { playerId: PLAYER, validFrom: d('2026-07-01') })];
    expect(resolveSpeedZoneConfig(configs, query())?.id).toBe('club');
    expect(resolveSpeedZoneConfig(configs, query({ onDate: d('2026-07-01') }))?.id).toBe('player');
  });

  it('throws when two equally specific configurations apply', () => {
    expectInvalid(
      () => resolveSpeedZoneConfig([rugby, row('rugby-2', { sport: 'rugby' })], query()),
      /Ambiguous/,
    );
    // sport-only and sex-only are not equally specific: sport wins.
    expect(resolveSpeedZoneConfig([row('male', { sex: 'male' }), rugby], query())?.id).toBe(
      'rugby',
    );
  });

  it('does not throw for a tie below the winner', () => {
    const configs = [club, row('club-2'), player];
    expect(resolveSpeedZoneConfig(configs, query())?.id).toBe('player');
  });

  it('narrows the zone set to the queried kind', () => {
    const relative = row('relative', { zoneSet: DEFAULT_RELATIVE_SPEED_ZONES });
    const resolved = resolveSpeedZoneConfig([relative], { ...query(), kind: 'relative' });
    expect(resolved?.zoneSet.kind).toBe('relative');
    expect(resolved?.zoneSet.zones[0]?.minVmaxPct).toBe(0);
  });
});

describe('resolveSpeedZoneSet', () => {
  it('returns the configured zone set', () => {
    const zoneSet: SpeedZoneSet = resolveSpeedZoneSet(
      [row('player', { playerId: PLAYER, zoneSet: hsrAt(5) })],
      query(),
    );
    expect(highSpeedThresholdMs(zoneSet)).toBe(5);
  });

  it('falls back to the seeded defaults of the kind', () => {
    expect(resolveSpeedZoneSet([], query())).toBe(DEFAULT_ABSOLUTE_SPEED_ZONES);
    expect(resolveSpeedZoneSet([], { ...query(), kind: 'relative' })).toBe(
      DEFAULT_RELATIVE_SPEED_ZONES,
    );
  });

  it('falls back to the default of the player sex (B-804)', () => {
    expect(resolveSpeedZoneSet([], query({ sex: 'female' }))).toBe(
      DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES,
    );
    // Relative zones have no sex-specific default: a share of the own Vmax already scales.
    expect(resolveSpeedZoneSet([], { ...query({ sex: 'female' }), kind: 'relative' })).toBe(
      DEFAULT_RELATIVE_SPEED_ZONES,
    );
  });

  it('prefers the female row over the club-wide one, and the club-wide one for men', () => {
    const configs = [
      row('club', { zoneSet: hsrAt(5.5) }),
      row('female', { sex: 'female', zoneSet: DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES }),
    ];
    expect(highSpeedThresholdMs(resolveSpeedZoneSet(configs, query({ sex: 'female' })))).toBe(5.28);
    expect(highSpeedThresholdMs(resolveSpeedZoneSet(configs, query()))).toBe(5.5);
  });

  it('accepts a custom fallback', () => {
    expect(resolveSpeedZoneSet([], query(), hsrAt(6))).toEqual(hsrAt(6));
  });

  it('supports the double reading: absolute and relative for the same player and day', () => {
    const configs = [row('abs', { sport: 'rugby', zoneSet: hsrAt(5) })];
    const absolute = resolveSpeedZoneSet(configs, query());
    const relative = resolveSpeedZoneSet(configs, { ...query(), kind: 'relative' });
    expect(highSpeedThresholdMs(absolute)).toBe(5);
    expect(highSpeedThresholdMs(relative, 8)).toBeCloseTo(4.8, 10);
  });
});

describe('findSpeedZoneConfigConflicts', () => {
  it('flags overlapping ranges with the same club, kind and scope', () => {
    const a = row('a', { sport: 'rugby', validTo: d('2026-06-01') });
    const b = row('b', { sport: 'rugby', validFrom: d('2026-05-01') });
    expect(findSpeedZoneConfigConflicts([a, b]).map(([x, y]) => [x.id, y.id])).toEqual([
      ['a', 'b'],
    ]);
  });

  it('flags two open-ended rows of the same scope', () => {
    expect(
      findSpeedZoneConfigConflicts([row('a'), row('b', { validFrom: d('2030-01-01') })]),
    ).toHaveLength(1);
  });

  it('accepts contiguous ranges', () => {
    const a = row('a', { validTo: d('2026-05-01') });
    const b = row('b', { validFrom: d('2026-05-01') });
    expect(findSpeedZoneConfigConflicts([a, b])).toEqual([]);
  });

  it('ignores different clubs, kinds or scopes', () => {
    const configs = [
      row('club'),
      row('other-club', { clubId: OTHER_CLUB }),
      row('relative', { zoneSet: DEFAULT_RELATIVE_SPEED_ZONES }),
      row('rugby', { sport: 'rugby' }),
      row('male', { sex: 'male' }),
      row('player', { playerId: PLAYER }),
      row('other-player', { playerId: OTHER_PLAYER }),
    ];
    expect(findSpeedZoneConfigConflicts(configs)).toEqual([]);
  });

  it('lists every conflicting pair', () => {
    expect(findSpeedZoneConfigConflicts([row('a'), row('b'), row('c')])).toHaveLength(3);
  });
});
