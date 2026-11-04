import { describe, expect, it } from 'vitest';
import { sortQuerySchema } from '../primitives/conventions.js';
import {
  archivePosition,
  createCategory,
  createClub,
  createPosition,
  endpointErrorCodes,
  listCategories,
  listPositions,
  updateCategory,
  updateClub,
  updatePosition,
} from '../index.js';

describe('club endpoints', () => {
  const create = {
    slug: 'club-nuevo',
    name: 'Club Nuevo',
    shortName: 'CN',
    branches: [{ sport: 'rugby', sex: 'male' }],
  };

  it('defaults the zone and the locale of a new club', () => {
    expect(createClub.body.parse(create)).toMatchObject({
      timeZone: 'America/Argentina/Buenos_Aires',
      locale: 'es-AR',
    });
  });

  it('rejects duplicate or missing branches and padded names', () => {
    for (const body of [
      { ...create, branches: [] },
      {
        ...create,
        branches: [
          { sport: 'rugby', sex: 'male' },
          { sport: 'rugby', sex: 'male' },
        ],
      },
      { ...create, name: 'Club ' },
      { ...create, branches: [{ sport: 'football', sex: 'male' }] },
      { ...create, locale: 'en-US' },
    ]) {
      expect(createClub.body.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('needs the version to edit the club, and answers conflict', () => {
    expect(updateClub.body.safeParse({ name: 'Otro' }).success).toBe(false);
    expect(updateClub.body.safeParse({ version: '1793586338688123', name: 'Otro' }).success).toBe(
      true,
    );
    expect(endpointErrorCodes(updateClub)).toContain('conflict');
    expect(updateClub.auth).toBe('club');
    expect(createClub.auth).toBe('session');
    expect(endpointErrorCodes(createClub)).toContain('forbidden');
  });
});

describe('category endpoints', () => {
  it('takes an age band of the domain and an optional clientUuid', () => {
    const body = createCategory.body.parse({
      clientUuid: '0192E7A0-5C1A-7B7E-9F3A-2D4C6B8A1E0F',
      sport: 'hockey',
      sex: 'female',
      ageBandCode: 'm19',
    });
    expect(body.clientUuid).toBe('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f');
    expect(createCategory.body.safeParse({ ...body, ageBandCode: 'm18' }).success).toBe(false);
  });

  it('does not let a category change branch or band', () => {
    expect(updateCategory.body.safeParse({ version: '1', sport: 'hockey' }).success).toBe(false);
    expect(updateCategory.body.safeParse({ version: '1', ageBandCode: 'm15' }).success).toBe(false);
  });

  it('lists active categories by sort order by default', () => {
    expect(listCategories.query.parse({})).toEqual({
      limit: 50,
      status: 'active',
      sort: 'sortOrder',
    });
    expect(listCategories.query.safeParse({ sort: '-name' }).success).toBe(true);
    expect(listCategories.query.safeParse({ sort: 'id' }).success).toBe(false);
  });
});

describe('position endpoints', () => {
  const create = { sport: 'hockey', code: 'sweeper', label: 'Líbero', lineCode: 'defenders' };

  it('takes a code, a label and a line to add a position', () => {
    expect(createPosition.body.parse(create)).toEqual(create);
    for (const body of [
      { ...create, code: 'Líbero' },
      { ...create, code: 'sweeper_playerload' },
      { ...create, label: ' Líbero' },
      { ...create, label: '' },
      { ...create, label: 'x'.repeat(41) },
      { ...create, lineCode: 'keepers' },
      { sport: 'hockey', code: 'sweeper', lineCode: 'defenders' },
      { ...create, archivedAt: null },
    ]) {
      expect(createPosition.body.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(endpointErrorCodes(createPosition)).toContain('conflict');
  });

  it('edits the label (null goes back to the catalog), the line and the order, never the code', () => {
    expect(updatePosition.body.safeParse({ version: '1', label: null }).success).toBe(true);
    expect(updatePosition.body.safeParse({ version: '1', lineCode: 'midfielders' }).success).toBe(
      true,
    );
    expect(updatePosition.body.safeParse({ version: '1', code: 'other' }).success).toBe(false);
    expect(updatePosition.body.safeParse({ version: '1', sport: 'rugby' }).success).toBe(false);
    expect(updatePosition.body.safeParse({ label: 'Líbero' }).success).toBe(false);
    expect(endpointErrorCodes(updatePosition)).toEqual(
      expect.arrayContaining(['not_found', 'conflict']),
    );
    expect(endpointErrorCodes(archivePosition)).toContain('not_found');
  });

  it('lists active positions by default', () => {
    expect(listPositions.query.parse({})).toEqual({
      limit: 50,
      status: 'active',
      sort: 'sortOrder',
    });
    expect(listPositions.query.parse({ status: 'all', sport: 'hockey' })).toMatchObject({
      status: 'all',
      sport: 'hockey',
    });
  });
});

describe('sortQuerySchema', () => {
  it('accepts each field ascending and descending, with its default', () => {
    const schema = sortQuerySchema(['name', 'createdAt'], '-createdAt');
    expect(schema.parse(undefined)).toBe('-createdAt');
    for (const value of ['name', '-name', 'createdAt', '-createdAt']) {
      expect(schema.parse(value)).toBe(value);
    }
    expect(schema.safeParse('--name').success).toBe(false);
  });
});
