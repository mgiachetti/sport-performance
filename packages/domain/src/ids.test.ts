import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  DomainValidationError,
  isUuid,
  packageName,
  parseClubId,
  parsePlayerId,
  parseUuid,
  type ClubId,
  type PlayerId,
  type Uuid,
} from './index.js';

const id = '0b6f4f5e-8c1a-4f3e-9a51-2d3c4b5a6f70';

describe('UUIDs', () => {
  it('accepts canonical lowercase UUIDs', () => {
    expect(isUuid(id)).toBe(true);
    expect(parseUuid(id)).toBe(id);
  });

  it('normalises upper case to lowercase', () => {
    expect(parseUuid(id.toUpperCase())).toBe(id);
    expect(isUuid(id.toUpperCase())).toBe(false);
  });

  it.each(['', 'not-a-uuid', id.replaceAll('-', ''), `{${id}}`, `${id} `, 123, undefined])(
    'rejects %j',
    (value) => {
      expect(() => parseUuid(value)).toThrow(DomainValidationError);
      expect(() => parseClubId(value)).toThrow(expect.objectContaining({ code: 'invalid_uuid' }));
    },
  );
});

describe('branded ids', () => {
  it('are distinct types that are all UUIDs', () => {
    const clubId = parseClubId(id);
    const playerId = parsePlayerId(id);
    expectTypeOf(clubId).toExtend<Uuid>();
    expectTypeOf(clubId).toExtend<string>();
    expectTypeOf(clubId).not.toExtend<PlayerId>();
    expectTypeOf(playerId).not.toExtend<ClubId>();
    expectTypeOf<string>().not.toExtend<ClubId>();
    expect(clubId).toBe(playerId);
  });
});

describe('package', () => {
  it('exposes its name', () => {
    expect(packageName).toBe('@sport-performance/domain');
  });
});
