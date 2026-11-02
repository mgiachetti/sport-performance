import { describe, expect, it } from 'vitest';
import type { CategoryId, PlayerId } from './ids.js';
import {
  DomainValidationError,
  SEASON_ROLLOVER_DECISIONS,
  SEASON_ROLLOVER_OUTCOMES,
  SEASON_ROLLOVER_PROPOSALS,
  SEASON_ROLLOVER_STATUSES,
  isSeasonRolloverDecision,
  isSeasonRolloverOutcome,
  isSeasonRolloverProposal,
  isSeasonRolloverStatus,
  parseSeasonRolloverDecision,
  parseSeasonRolloverOutcome,
  parseSeasonRolloverProposal,
  parseSeasonRolloverStatus,
  proposeSeasonRollover,
  seasonRolloverYear,
  type LocalDate,
  type RolloverCategory,
  type RolloverPlayer,
} from './index.js';

const cat = (id: string, ageBandCode: string, sex: 'male' | 'female' = 'male') =>
  ({ id: id as CategoryId, ageBandCode, sex }) satisfies RolloverCategory;
const M14 = cat('00000000-0000-4000-8000-000000000014', 'm14');
const M15 = cat('00000000-0000-4000-8000-000000000015', 'm15');
const M16 = cat('00000000-0000-4000-8000-000000000016', 'm16');
const M17 = cat('00000000-0000-4000-8000-000000000017', 'm17');
const M19 = cat('00000000-0000-4000-8000-000000000019', 'm19');
const W15 = cat('00000000-0000-4000-8000-000000000115', 'm15', 'female');
const CATEGORIES = [M14, M15, M16, M17, M19, W15];

let n = 0;
function player(
  birthDate: string,
  current: RolloverCategory[] = [],
  sex: 'male' | 'female' = 'male',
) {
  n += 1;
  return {
    id: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}` as PlayerId,
    birthDate: birthDate as LocalDate,
    sex,
    currentCategoryIds: current.map((c) => c.id),
  } satisfies RolloverPlayer;
}

const propose = (players: RolloverPlayer[], categories = CATEGORIES) =>
  proposeSeasonRollover({ seasonYear: 2027, players, categories });

describe('vocabularies', () => {
  it.each([
    ['status', SEASON_ROLLOVER_STATUSES, isSeasonRolloverStatus, parseSeasonRolloverStatus],
    ['proposal', SEASON_ROLLOVER_PROPOSALS, isSeasonRolloverProposal, parseSeasonRolloverProposal],
    ['decision', SEASON_ROLLOVER_DECISIONS, isSeasonRolloverDecision, parseSeasonRolloverDecision],
    ['outcome', SEASON_ROLLOVER_OUTCOMES, isSeasonRolloverOutcome, parseSeasonRolloverOutcome],
  ] as const)('%s guards and parses its members only', (_, values, is, parse) => {
    for (const value of values) {
      expect(is(value)).toBe(true);
      expect(parse(value)).toBe(value);
    }
    expect(is('nope')).toBe(false);
    expect(() => parse('nope')).toThrow(DomainValidationError);
  });
});

describe('seasonRolloverYear', () => {
  it('is the year of the first day of the season', () => {
    expect(seasonRolloverYear({ startsOn: '2027-02-01' as LocalDate })).toBe(2027);
    expect(seasonRolloverYear({ startsOn: '2026-09-01' as LocalDate })).toBe(2026);
  });
});

describe('proposeSeasonRollover', () => {
  it('moves a player up to the category of their birth year', () => {
    // Born 2012: 15 in 2027 → M15, coming from M14.
    const p = player('2012-11-30', [M14]);
    expect(propose([p])).toEqual([
      {
        playerId: p.id,
        ageInSeasonYear: 15,
        ageBandCode: 'm15',
        proposal: 'birth_year',
        proposedCategoryId: M15.id,
        decision: 'move',
        needsReview: false,
      },
    ]);
  });

  it('uses the birth year only, not the birthday', () => {
    const [early, late] = propose([player('2012-01-01', [M14]), player('2012-12-31', [M14])]);
    expect(early?.proposedCategoryId).toBe(M15.id);
    expect(late?.proposedCategoryId).toBe(M15.id);
  });

  it('keeps a player already in the category of their birth year', () => {
    const [item] = propose([player('2012-05-05', [M15])]);
    expect(item).toMatchObject({
      proposal: 'already_there',
      proposedCategoryId: M15.id,
      decision: 'stay',
      needsReview: false,
    });
  });

  it('M19 spans two years: an 18-year-old moves to M19, a 19-year-old stays', () => {
    const [eighteen, nineteen] = propose([
      player('2009-03-03', [M17]),
      player('2008-03-03', [M19]),
    ]);
    expect(eighteen).toMatchObject({
      ageBandCode: 'm19',
      proposal: 'birth_year',
      decision: 'move',
    });
    expect(nineteen).toMatchObject({ ageBandCode: 'm19', proposal: 'already_there' });
  });

  it('a player older than every band ages out, for the administration to decide', () => {
    const [item] = propose([player('2007-06-01', [M19])]);
    expect(item).toMatchObject({
      ageInSeasonYear: 20,
      ageBandCode: null,
      proposal: 'aged_out',
      proposedCategoryId: null,
      decision: 'stay',
      needsReview: true,
    });
  });

  it('a player younger than every band is too young', () => {
    const [item] = propose([player('2016-06-01')]);
    expect(item).toMatchObject({ ageInSeasonYear: 11, proposal: 'too_young', needsReview: true });
  });

  it('only proposes categories of the player branch (sex)', () => {
    const [woman, man] = propose([player('2012-04-04', [], 'female'), player('2012-04-04', [])]);
    expect(woman?.proposedCategoryId).toBe(W15.id);
    expect(man?.proposedCategoryId).toBe(M15.id);
  });

  it('no active category for the band: no proposal, to review', () => {
    const [item] = propose([player('2011-04-04', [M15])], [M14, M15, M17]);
    expect(item).toMatchObject({
      ageBandCode: 'm16',
      proposal: 'no_category',
      proposedCategoryId: null,
      decision: 'stay',
      needsReview: true,
    });
  });

  it('two active categories for the band: ambiguous, to review', () => {
    const m15b = cat('00000000-0000-4000-8000-000000000215', 'm15');
    const [item] = propose([player('2012-04-04', [M14])], [...CATEGORIES, m15b]);
    expect(item).toMatchObject({
      proposal: 'ambiguous',
      proposedCategoryId: null,
      needsReview: true,
    });
  });

  it('flags a move down a band (the player played up)', () => {
    // Born 2012 (15 in 2027) but played M17 last season.
    const [item] = propose([player('2012-04-04', [M17])]);
    expect(item).toMatchObject({
      proposal: 'birth_year',
      proposedCategoryId: M15.id,
      needsReview: true,
    });
  });

  it('flags a player in more than one category', () => {
    const [moving, staying] = propose([
      player('2012-04-04', [M14, M15]),
      player('2011-04-04', [M16, M17]),
    ]);
    expect(moving).toMatchObject({ proposal: 'already_there', needsReview: true });
    expect(staying).toMatchObject({ proposal: 'already_there', needsReview: true });
  });

  it('a player with no category gets one by birth year', () => {
    const [item] = propose([player('2013-08-08')]);
    expect(item).toMatchObject({
      proposal: 'birth_year',
      proposedCategoryId: M14.id,
      needsReview: false,
    });
  });

  it('ignores categories of codes outside the bands', () => {
    const senior = cat('00000000-0000-4000-8000-000000000099', 'senior');
    const [item] = propose([player('2007-01-01', [senior])], [...CATEGORIES, senior]);
    expect(item).toMatchObject({ proposal: 'aged_out', proposedCategoryId: null });
  });
});
