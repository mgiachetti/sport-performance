import { describe, expect, it } from 'vitest';
import {
  createInvitation,
  createPlayerGuardian,
  endpointErrorCodes,
  issuePlayerAccessCode,
  issuedPlayerAccessCodeSchema,
  listMyChildren,
  listPlayerGuardians,
  PLAYER_ACCESS_CODE_ALPHABET,
  PLAYER_ACCESS_CODE_EXPIRES_IN_S,
  PLAYER_ACCESS_CODE_LENGTH,
  redeemPlayerAccess,
  updateGuardian,
} from '../index.js';

const PLAYER = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';
const TOKEN = 'a'.repeat(43);

describe('guardian endpoints', () => {
  it('links a parent membership with a relationship of the domain', () => {
    expect(
      createPlayerGuardian.body.safeParse({ membershipId: PLAYER, relationship: 'mother' }).success,
    ).toBe(true);
    expect(
      createPlayerGuardian.body.safeParse({ membershipId: PLAYER, relationship: 'aunt' }).success,
    ).toBe(false);
    expect(updateGuardian.body.safeParse({ relationship: 'father' }).success).toBe(false);
    expect(endpointErrorCodes(createPlayerGuardian)).toContain('conflict');
  });

  it('lists current links by default and children by name', () => {
    expect(listPlayerGuardians.query.parse({})).toMatchObject({ status: 'current', limit: 50 });
    expect(listMyChildren.query.parse({})).toMatchObject({ sort: 'name' });
    expect(listMyChildren.auth).toBe('club');
  });

  it('lets an admin invitation carry a player and a relationship', () => {
    expect(
      createInvitation.body.parse({
        email: 'mama@example.com',
        role: 'parent',
        playerId: PLAYER,
        relationship: 'mother',
      }),
    ).toMatchObject({ playerId: PLAYER, relationship: 'mother' });
  });
});

describe('player access by code or link', () => {
  it('uses a short alphabet without ambiguous characters', () => {
    expect(PLAYER_ACCESS_CODE_ALPHABET).not.toMatch(/[01ILO]/);
    expect(new Set(PLAYER_ACCESS_CODE_ALPHABET).size).toBe(PLAYER_ACCESS_CODE_ALPHABET.length);
    expect(PLAYER_ACCESS_CODE_ALPHABET).toHaveLength(31);
    expect(PLAYER_ACCESS_CODE_LENGTH).toBe(8);
    expect(PLAYER_ACCESS_CODE_EXPIRES_IN_S).toBeLessThanOrEqual(60 * 60);
  });

  it('accepts the code as typed (any case, with or without separator), or the token', () => {
    for (const code of ['K7QM-2XPA', 'k7qm2xpa', 'K7QM 2XPA']) {
      expect(redeemPlayerAccess.body.safeParse({ code }).success, code).toBe(true);
    }
    expect(redeemPlayerAccess.body.safeParse({ token: TOKEN }).success).toBe(true);
    for (const body of [
      {},
      { code: 'K7QM-2XP' },
      { code: 'K7QM--2XPA' },
      { token: 'short' },
      { code: 'K7QM-2XPA', token: TOKEN },
      { code: 'K7QM-2XPA', transport: 'cookie' },
    ]) {
      expect(redeemPlayerAccess.body.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(redeemPlayerAccess.auth).toBe('public');
  });

  it('only ever hands out codes of the alphabet', () => {
    const issued = {
      accessCode: {
        id: PLAYER,
        playerId: PLAYER,
        status: 'pending',
        issuedBy: { userId: PLAYER, name: 'Ana' },
        expiresAt: '2026-11-01T12:15:00.000Z',
        createdAt: '2026-11-01T12:00:00.000Z',
        usedAt: null,
        revokedAt: null,
      },
      links: { app: 'sportperformance://player-access/x', web: 'https://app.example.com/x' },
    };
    expect(issuedPlayerAccessCodeSchema.safeParse({ ...issued, code: 'K7QM-2XPA' }).success).toBe(
      true,
    );
    expect(issuedPlayerAccessCodeSchema.safeParse({ ...issued, code: 'K7QO-2XPA' }).success).toBe(
      false,
    );
    expect('body' in issuePlayerAccessCode).toBe(false);
  });
});
