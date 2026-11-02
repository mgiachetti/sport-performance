import {
  PLAYER_ACCESS_CODE_ALPHABET,
  PLAYER_ACCESS_CODE_LENGTH,
  playerAccessCodeSchema,
} from '@sport-performance/contracts';
import { permissionCells } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import {
  accessCodeStatus,
  formatAccessCode,
  generateAccessCode,
  hashAccessCode,
  normalizeAccessCode,
  playerAccessLinks,
} from './access-codes.js';

describe('player access codes', () => {
  it('draws codes of the alphabet, uniformly enough', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 2000; i += 1) {
      const code = generateAccessCode();
      expect(code).toHaveLength(PLAYER_ACCESS_CODE_LENGTH);
      for (const char of code) {
        expect(PLAYER_ACCESS_CODE_ALPHABET).toContain(char);
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }
    // 16 000 draws over 31 symbols: every symbol shows up, none dominates.
    expect(counts.size).toBe(PLAYER_ACCESS_CODE_ALPHABET.length);
    for (const count of counts.values()) expect(count).toBeLessThan(1000);
  });

  it('shows the code split in two and reads it back however it was typed', () => {
    const code = 'K7QM2XPA';
    const shown = formatAccessCode(code);
    expect(shown).toBe('K7QM-2XPA');
    expect(playerAccessCodeSchema.safeParse(shown).success).toBe(true);
    for (const typed of ['K7QM-2XPA', 'k7qm2xpa', 'k7qm 2XPA']) {
      expect(normalizeAccessCode(typed)).toBe(code);
    }
  });

  it('hashes with the secret: the same code with another secret is another hash', () => {
    const a = hashAccessCode('secret-a', 'K7QM2XPA');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAccessCode('secret-a', 'K7QM2XPA')).toBe(a);
    expect(hashAccessCode('secret-b', 'K7QM2XPA')).not.toBe(a);
    expect(hashAccessCode('secret-a', 'K7QM2XPB')).not.toBe(a);
  });

  it('builds the universal link and the deep link of the token', () => {
    expect(
      playerAccessLinks('tok', { webAppUrl: 'https://app.example.com', appScheme: 'sp' }),
    ).toEqual({ app: 'sp://player-access/tok', web: 'https://app.example.com/player-access/tok' });
  });

  it('tells the status: used and revoked are final, then expiry', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    const later = new Date('2026-11-01T12:15:00Z');
    const earlier = new Date('2026-11-01T11:59:00Z');
    expect(accessCodeStatus({ expiresAt: later, consumedAt: null, revokedAt: null }, now)).toBe(
      'pending',
    );
    expect(accessCodeStatus({ expiresAt: earlier, consumedAt: null, revokedAt: null }, now)).toBe(
      'expired',
    );
    expect(accessCodeStatus({ expiresAt: earlier, consumedAt: now, revokedAt: null }, now)).toBe(
      'used',
    );
    expect(accessCodeStatus({ expiresAt: later, consumedAt: null, revokedAt: now }, now)).toBe(
      'revoked',
    );
  });
});

describe('the matrix cells of guardians and player accounts', () => {
  it('have no `assigned` scope (the player facts of the routes do not need a real sport)', () => {
    const cells = permissionCells().filter(
      (cell) => cell.kind === 'guardian_link' || cell.kind === 'player_account',
    );
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      if (cell.rule.effect === 'allow') expect(cell.rule.scope, cell.role).not.toBe('assigned');
    }
  });

  it('let a guardian manage the account of a minor only', () => {
    const cell = permissionCells().find(
      (c) => c.kind === 'player_account' && c.action === 'invite' && c.role === 'parent',
    );
    expect(cell?.rule).toMatchObject({ effect: 'allow', scope: 'guardian', conditions: ['minor'] });
  });
});
