import { describe, expect, it } from 'vitest';
import {
  addPlayerCategory,
  archivePlayer,
  createPlayer,
  endpointErrorCodes,
  listPlayers,
  setPlayerParentHeight,
  updatePlayer,
} from '../index.js';

const POSITION_A = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';
const POSITION_B = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10';

describe('player endpoints', () => {
  const create = {
    firstName: 'Juan',
    lastName: 'Pérez',
    birthDate: '2011-05-04',
    sex: 'male',
    sport: 'rugby',
  };

  it('creates a player with the minimum data, idempotent by clientUuid', () => {
    expect(createPlayer.body.parse(create)).toEqual(create);
    const withUuid = createPlayer.body.parse({
      ...create,
      clientUuid: POSITION_A.toUpperCase(),
      positionIds: [POSITION_A, POSITION_B],
      dominantSide: 'left',
    });
    expect(withUuid.clientUuid).toBe(POSITION_A);
    expect(endpointErrorCodes(createPlayer)).toContain('conflict');
  });

  it('rejects padded names, repeated positions, unknown fields and bad dates', () => {
    for (const body of [
      { ...create, firstName: ' Juan' },
      { ...create, lastName: '' },
      { ...create, positionIds: [POSITION_A, POSITION_A] },
      { ...create, positionIds: Array.from({ length: 6 }, () => POSITION_A) },
      { ...create, birthDate: '04/05/2011' },
      { ...create, sport: 'football' },
      { ...create, dominantSide: 'ambidextrous' },
      { ...create, motherHeightCm: 165 },
    ]) {
      expect(createPlayer.body.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('edits with the version, never the sport', () => {
    expect(updatePlayer.body.safeParse({ firstName: 'Otro' }).success).toBe(false);
    expect(updatePlayer.body.safeParse({ version: '1', dominantSide: null }).success).toBe(true);
    expect(updatePlayer.body.safeParse({ version: '1', sport: 'hockey' }).success).toBe(false);
    expect(endpointErrorCodes(updatePlayer)).toEqual(
      expect.arrayContaining(['not_found', 'conflict']),
    );
  });

  it('lists active players by name by default', () => {
    expect(listPlayers.query.parse({})).toMatchObject({
      status: 'active',
      sort: 'name',
      limit: 50,
    });
    expect(listPlayers.query.safeParse({ sort: 'lastName' }).success).toBe(false);
    expect(listPlayers.query.parse({ sort: '-birthDate', status: 'all' }).sort).toBe('-birthDate');
  });

  it('takes a leave with a reason and a trimmed note', () => {
    expect(
      archivePlayer.body.safeParse({ leftOn: '2026-06-30', reason: 'graduated' }).success,
    ).toBe(true);
    expect(archivePlayer.body.safeParse({ leftOn: '2026-06-30' }).success).toBe(false);
    expect(
      archivePlayer.body.safeParse({ leftOn: '2026-06-30', reason: 'quit', note: ' x' }).success,
    ).toBe(false);
  });

  it('moves between categories, closing the current ones by default', () => {
    const body = addPlayerCategory.body.parse({
      categoryId: POSITION_A,
      validFrom: '2027-03-01',
    });
    expect(body.keepCurrent).toBe(false);
  });

  it('takes a plausible parent height with its origin', () => {
    expect(setPlayerParentHeight.params.parse({ playerId: POSITION_A, parent: 'mother' })).toEqual({
      playerId: POSITION_A,
      parent: 'mother',
    });
    expect(
      setPlayerParentHeight.params.safeParse({ playerId: POSITION_A, parent: 'aunt' }).success,
    ).toBe(false);
    expect(
      setPlayerParentHeight.body.safeParse({ heightCm: 168.5, source: 'reported' }).success,
    ).toBe(true);
    for (const heightCm of [16.8, 300, Number.NaN]) {
      expect(setPlayerParentHeight.body.safeParse({ heightCm, source: 'measured' }).success).toBe(
        false,
      );
    }
    expect(setPlayerParentHeight.body.safeParse({ heightCm: 170, source: 'guess' }).success).toBe(
      false,
    );
  });
});
