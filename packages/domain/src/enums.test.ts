import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  MEASUREMENT_METHODS,
  SEXES,
  SPORTS,
  STAGES,
  STAGE_PROFILES,
  WELLNESS_ITEMS,
  compareStages,
  isMeasurementMethod,
  isSex,
  isSport,
  isStage,
  isWellnessItem,
  parseMeasurementMethod,
  parseSex,
  parseSport,
  parseStage,
  parseWellnessItem,
} from './index.js';

const cases = [
  { name: 'sport', values: SPORTS, is: isSport, parse: parseSport, code: 'invalid_sport' },
  { name: 'sex', values: SEXES, is: isSex, parse: parseSex, code: 'invalid_sex' },
  { name: 'stage', values: STAGES, is: isStage, parse: parseStage, code: 'invalid_stage' },
  {
    name: 'measurement method',
    values: MEASUREMENT_METHODS,
    is: isMeasurementMethod,
    parse: parseMeasurementMethod,
    code: 'invalid_measurement_method',
  },
  {
    name: 'wellness item',
    values: WELLNESS_ITEMS,
    is: isWellnessItem,
    parse: parseWellnessItem,
    code: 'invalid_wellness_item',
  },
] as const;

describe.each(cases)('$name enumeration', ({ values, is, parse, code }) => {
  it('accepts every member', () => {
    for (const value of values) {
      expect(is(value)).toBe(true);
      expect(parse(value)).toBe(value);
    }
  });

  it.each([undefined, null, 1, '', 'RUGBY', 'Male', ' rugby', {}])(
    'rejects %j with a typed error',
    (value) => {
      expect(is(value)).toBe(false);
      expect(() => parse(value)).toThrow(DomainValidationError);
      try {
        parse(value);
      } catch (error) {
        expect(error).toMatchObject({ name: 'DomainValidationError', code, value });
      }
    },
  );

  it('uses English snake_case values', () => {
    for (const value of values) expect(value).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
  });
});

describe('sport and sex', () => {
  it('cover the first tenant (rugby male, hockey female)', () => {
    expect(SPORTS).toEqual(['rugby', 'hockey']);
    expect(SEXES).toEqual(['male', 'female']);
  });
});

describe('stages', () => {
  it('are ordered youngest first', () => {
    expect(compareStages('foundation', 'development')).toBeLessThan(0);
    expect(compareStages('performance', 'development')).toBeGreaterThan(0);
    expect(compareStages('development', 'development')).toBe(0);
    expect([...STAGES].sort(compareStages)).toEqual(STAGES);
  });

  it('have a profile keyed by their own code', () => {
    for (const stage of STAGES) expect(STAGE_PROFILES[stage].stage).toBe(stage);
  });

  it('only allow maximal loads in performance', () => {
    expect(STAGES.filter((s) => STAGE_PROFILES[s].maximalLoadTests)).toEqual(['performance']);
    expect(STAGE_PROFILES.foundation.strengthAssessment).toBe('technique_reps');
    expect(STAGE_PROFILES.development.strengthAssessment).toBe('estimated_rm');
    expect(STAGE_PROFILES.performance.strengthAssessment).toBe('direct_rm');
  });

  it('ask 3 wellness items in foundation and 5 later, never more than exist', () => {
    expect(STAGE_PROFILES.foundation.wellnessItemCount).toBe(3);
    expect(STAGE_PROFILES.development.wellnessItemCount).toBe(5);
    for (const stage of STAGES) {
      expect(STAGE_PROFILES[stage].wellnessItemCount).toBeLessThanOrEqual(WELLNESS_ITEMS.length);
    }
  });

  it('never show named rankings to players before performance', () => {
    expect(STAGE_PROFILES.foundation.playerSeesNamedRankings).toBe(false);
    expect(STAGE_PROFILES.foundation.playerSeesOwnPercentiles).toBe(false);
    expect(STAGE_PROFILES.development.playerSeesNamedRankings).toBe(false);
    expect(STAGE_PROFILES.development.playerSeesOwnPercentiles).toBe(true);
  });
});
