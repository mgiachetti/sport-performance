import { describe, expect, it } from 'vitest';
import type { RunState } from '../stack/state.ts';
import {
  DEMO_ACCOUNTS,
  activePlayers,
  categoryOn,
  childrenOf,
  coachRugbySeniorScope,
  demoDataset,
  demoEmail,
  recentlyHeldPlayers,
  rosterName,
  userByEmail,
} from './demo.ts';

const state: RunState = {
  startedAt: '2026-08-20T12:00:00.000Z',
  asOf: '2026-08-20',
  slug: 'demo-e2e',
  seed: 'e2e',
  historyDays: 7,
  emailDomain: 'example.com',
  apiUrl: 'http://127.0.0.1:3100',
  webUrl: 'http://127.0.0.1:4174',
  injuryFixture: {
    playerId: '00000000-0000-4000-8000-000000000000',
    diagnosis: 'Lesión ficticia (knee) E2E',
    validFrom: '2026-08-17',
    validTo: '2026-09-10',
  },
  files: false,
};
const dataset = demoDataset(state);

describe('demo dataset of the run', () => {
  it('is the generator output for the options of the stack', () => {
    expect(dataset.club.slug).toBe('demo-e2e');
    expect(demoDataset(state).players.map((p) => p.id)).toEqual(dataset.players.map((p) => p.id));
  });

  it('has every account the scenarios sign in with', () => {
    for (const local of Object.values(DEMO_ACCOUNTS)) {
      expect(userByEmail(dataset, demoEmail(state, local)).email).toBe(
        `demo-e2e.${local}@example.com`,
      );
    }
    expect(() => userByEmail(dataset, 'nadie@example.com')).toThrow();
  });

  it('finds the active players of some categories on the run day', () => {
    const senior = activePlayers(dataset, coachRugbySeniorScope);
    expect(senior.length).toBeGreaterThan(0);
    for (const player of senior) {
      expect(player.sport).toBe('rugby');
      expect(player.leftOn).toBeNull();
      expect(['m17', 'm19']).toContain(categoryOn(dataset, player, dataset.asOf)?.ageBandCode);
    }
    const first = senior[0];
    if (first !== undefined) {
      expect(rosterName(first)).toBe(`${first.lastName}, ${first.firstName}`);
    }
  });

  it('gives the featured family two children', () => {
    const guardian = userByEmail(dataset, demoEmail(state, DEMO_ACCOUNTS.family));
    const sports = childrenOf(dataset, guardian.id).map((p) => p.sport);
    expect(sports.sort()).toEqual(['hockey', 'rugby']);
  });

  it('finds players with an availability hold in the last days, with their injuries', () => {
    const held = recentlyHeldPlayers(dataset, dataset.players);
    expect(held.length).toBeGreaterThan(0);
    for (const { holds, injuries } of held) {
      expect(holds.length).toBeGreaterThan(0);
      expect(injuries.map((i) => i.id).sort()).toEqual(holds.map((h) => h.injuryId).sort());
    }
  });
});
