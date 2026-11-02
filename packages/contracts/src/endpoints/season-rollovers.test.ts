import { describe, expect, it } from 'vitest';
import {
  applySeasonRollover,
  createSeasonRollover,
  endpointErrorCodes,
  listSeasonRolloverItems,
  updateSeasonRolloverItem,
} from '../index.js';

const CATEGORY = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';

describe('season change endpoints', () => {
  it('creates a draft with an optional effective day, idempotent by clientUuid', () => {
    expect(createSeasonRollover.body.parse({})).toEqual({});
    expect(
      createSeasonRollover.body.parse({ effectiveOn: '2027-02-01', clientUuid: CATEGORY }),
    ).toEqual({ effectiveOn: '2027-02-01', clientUuid: CATEGORY });
    expect(createSeasonRollover.body.safeParse({ effectiveOn: '2027-02-30' }).success).toBe(false);
    expect(endpointErrorCodes(createSeasonRollover)).toContain('conflict');
  });

  it('a review moves with a category or stays without one', () => {
    const version = '1';
    expect(
      updateSeasonRolloverItem.body.parse({
        version,
        decision: 'move',
        targetCategoryId: CATEGORY,
      }),
    ).toEqual({ version, decision: 'move', targetCategoryId: CATEGORY });
    expect(updateSeasonRolloverItem.body.parse({ version, decision: 'stay' })).toEqual({
      version,
      decision: 'stay',
    });
    for (const body of [
      { version, decision: 'move' },
      { version, decision: 'stay', targetCategoryId: CATEGORY },
      { decision: 'stay' },
      { version, decision: 'stay', extra: true },
    ]) {
      expect(updateSeasonRolloverItem.body.safeParse(body).success, JSON.stringify(body)).toBe(
        false,
      );
    }
  });

  it('applying needs the version of the draft', () => {
    expect(applySeasonRollover.body.safeParse({}).success).toBe(false);
    expect(endpointErrorCodes(applySeasonRollover)).toContain('conflict');
  });

  it('filters items with typed query parameters', () => {
    expect(
      listSeasonRolloverItems.query.parse({ needsReview: 'true', proposal: 'ambiguous' }),
    ).toMatchObject({ needsReview: 'true', proposal: 'ambiguous', sort: 'name', limit: 50 });
    expect(listSeasonRolloverItems.query.safeParse({ needsReview: 'yes' }).success).toBe(false);
  });
});
