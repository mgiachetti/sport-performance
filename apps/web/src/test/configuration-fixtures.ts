import type {
  AlertRuleDto,
  BatteryEntryDto,
  CatalogMetric,
  CatalogTest,
  ClubBranch,
  EffectiveBattery,
  EffectiveSpeedZones,
  Position,
  ReferenceValue,
  SpeedZoneConfigDto,
} from '@sport-performance/contracts';
import {
  DEFAULT_ALERT_RULES,
  DEFAULT_SPEED_ZONE_SETS,
  parseLocalDate,
  parseUuid,
  type CategoryId,
  type Sex,
  type Sport,
  type Stage,
  type UnitCode,
} from '@sport-performance/domain';

/**
 * Valid API payloads of the configuration screen (B-409). They go through
 * the client's response validation like every fixture.
 */

const AT = '2026-11-01T12:00:00.000Z';
const VERSION = '1793586338688123';

let counter = 0;
/** A fresh, well-formed id (UUIDv7 layout). */
export function fixtureId(): ReturnType<typeof parseUuid> {
  counter += 1;
  return parseUuid(`0192e7a0-9999-7000-8000-${String(counter).padStart(12, '0')}`);
}

export function clubBranch(sport: Sport, sex: Sex): ClubBranch {
  return {
    id: fixtureId(),
    sport,
    sex,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
  };
}

export function catalogTest(code: string, overrides: Partial<CatalogTest> = {}): CatalogTest {
  return {
    code,
    testDefinitionId: fixtureId(),
    protocolVersion: 1,
    inForce: true,
    sports: null,
    maximalLoad: false,
    attemptCount: 3,
    attemptAggregation: 'best',
    metricCodes: [],
    validFrom: parseLocalDate('2000-01-01'),
    validTo: null,
    ...overrides,
  };
}

export function catalogMetric(
  code: string,
  unit: UnitCode,
  overrides: Partial<CatalogMetric> = {},
): CatalogMetric {
  return {
    id: fixtureId(),
    code,
    unit,
    source: 'test',
    direction: 'higher_is_better',
    testCode: 'cmj',
    sports: null,
    description: null,
    catapultAliases: [],
    isCanonical: true,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export function batteryEntry(overrides: Partial<BatteryEntryDto> = {}): BatteryEntryDto {
  return {
    id: fixtureId(),
    sport: 'rugby',
    sex: null,
    stage: null,
    categoryId: null,
    testCode: 'sprint_40',
    windows: [1, 2, 3, 4],
    cadenceWeeks: null,
    validFrom: parseLocalDate('2026-01-01'),
    validTo: null,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

/** The effective battery of a group, from the entries that apply to it. */
export function effectiveBattery(
  group: { sport: Sport; sex: Sex; stage: Stage; categoryId?: CategoryId | null },
  entries: readonly BatteryEntryDto[],
): EffectiveBattery {
  return {
    sport: group.sport,
    sex: group.sex,
    stage: group.stage,
    categoryId: group.categoryId ?? null,
    onDate: parseLocalDate('2026-11-03'),
    tests: entries.map((entry) => ({
      testCode: entry.testCode,
      windows: entry.windows,
      cadenceWeeks: entry.cadenceWeeks,
      entry,
    })),
  };
}

export function defaultZones(kind: 'absolute' | 'relative'): EffectiveSpeedZones {
  const set = DEFAULT_SPEED_ZONE_SETS[kind];
  return {
    kind,
    onDate: parseLocalDate('2026-11-03'),
    source: 'default',
    config: null,
    zoneSet:
      set.kind === 'absolute'
        ? {
            kind: 'absolute',
            zones: set.zones.map((z) => ({ ...z })),
            highSpeedZoneCode: set.highSpeedZoneCode,
          }
        : {
            kind: 'relative',
            zones: set.zones.map((z) => ({ ...z })),
            highSpeedZoneCode: set.highSpeedZoneCode,
          },
  };
}

export function speedZoneConfig(overrides: Partial<SpeedZoneConfigDto> = {}): SpeedZoneConfigDto {
  const set = DEFAULT_SPEED_ZONE_SETS.absolute;
  return {
    id: fixtureId(),
    kind: 'absolute',
    sport: 'rugby',
    sex: 'male',
    playerId: null,
    zoneSet: {
      kind: 'absolute',
      zones: set.zones.map((z) => ({ ...z })),
      highSpeedZoneCode: set.highSpeedZoneCode,
    },
    validFrom: parseLocalDate('2026-03-01'),
    validTo: null,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

/** The seeded rules, as the API lists them. */
export function defaultAlertRules(): AlertRuleDto[] {
  return DEFAULT_ALERT_RULES.map(
    (rule) =>
      ({
        id: fixtureId(),
        code: rule.code,
        kind: rule.kind,
        enabled: rule.enabled,
        appliesTo: {},
        params: { ...rule.params },
        isDefault: true,
        createdAt: AT,
        updatedAt: AT,
        version: VERSION,
      }) as AlertRuleDto,
  );
}

export function referenceValue(overrides: Partial<ReferenceValue> = {}): ReferenceValue {
  return {
    id: fixtureId(),
    metricDefinitionId: fixtureId(),
    metricCode: 'cmj_height_cm',
    sport: 'rugby',
    sex: 'male',
    scope: 'squad',
    positionId: null,
    positionCode: null,
    lineCode: null,
    value: 45.5,
    unit: 'cm',
    method: 'video',
    validFrom: parseLocalDate('2026-02-01'),
    source: 'Primera, pretemporada 2026',
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export function position(code: string, lineCode: string, sortOrder = 0): Position {
  return {
    id: fixtureId(),
    sport: 'rugby',
    code,
    label: null,
    lineCode,
    sortOrder,
  };
}
