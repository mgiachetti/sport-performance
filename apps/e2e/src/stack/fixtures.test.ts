import { describe, expect, it } from 'vitest';
import { parseLocalDate } from '@sport-performance/domain';
import {
  DEMO_ACCOUNTS,
  activePlayers,
  coachRugbySeniorScope,
  demoDataset,
  demoEmail,
} from '../harness/demo.ts';
import { fixturePlayer } from './fixtures.ts';

describe('player of the injury fixture', () => {
  // In season and in the summer break, when the demo has no recent injury in these categories.
  it.each(['2026-11-04', '2027-01-20'])('is a player of the rugby coach on %s', (asOf) => {
    const options = {
      asOf: parseLocalDate(asOf),
      slug: 'demo-e2e',
      seed: 'e2e',
      historyDays: 7,
      emailDomain: 'example.com',
    };
    const dataset = demoDataset(options);
    const player = fixturePlayer(dataset);
    expect(activePlayers(dataset, coachRugbySeniorScope)).toContain(player);
    const signedIn = Object.values(DEMO_ACCOUNTS).map((local) => demoEmail(options, local));
    const email = dataset.users.find((u) => u.id === player.userId)?.email;
    expect(signedIn).not.toContain(email);
  });
});
