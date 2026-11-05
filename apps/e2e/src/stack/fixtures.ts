import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { addDays, type LocalDate } from '@sport-performance/domain';
import {
  DEMO_INJURY_DIAGNOSIS_PREFIX,
  DEMO_MARK,
  type DemoDataset,
  type DemoPlayer,
} from '@sport-performance/db/seeds';
import { DEMO_ACCOUNTS, activePlayers, coachRugbySeniorScope } from '../harness/demo.ts';
import type { InjuryFixture } from './state.ts';

/** The open hold of the fixture starts a few days before the run and ends weeks after it. */
const HOLD_STARTED_DAYS_AGO = 3;
const HOLD_LASTS_DAYS = 21;

/**
 * The player of the injury fixture: the first active player of the rugby
 * coach's categories on the run day that no scenario signs in as
 * (`DEMO_ACCOUNTS`), so the player scenarios are not affected.
 */
export function fixturePlayer(dataset: DemoDataset): DemoPlayer {
  const signedIn = Object.values(DEMO_ACCOUNTS).map((local) => `${dataset.club.slug}.${local}@`);
  const accountOf = new Map(dataset.users.map((u) => [u.id, u.email]));
  const player = activePlayers(dataset, coachRugbySeniorScope).find((p) => {
    const email = p.userId === null ? undefined : accountOf.get(p.userId);
    return email === undefined || !signedIn.some((prefix) => email.startsWith(prefix));
  });
  if (player === undefined) {
    throw new Error('The demo has no active player of rugby M17/M19 for the injury fixture.');
  }
  return player;
}

/**
 * The injury of the run: the demo only injures players in season (February to
 * November), so in the summer break no player of the rugby coach's
 * categories has a hold in the last 90 days. The stack adds one that is open
 * today, with a diagnosis unique to the run, so the "no disponible, never the
 * diagnosis" scenario runs every day of the year instead of being skipped.
 *
 * Written like the demo seed writes health data (owner connection, the club
 * of the transaction set; the medical triggers log it), on {@link fixturePlayer}.
 */
export async function addInjuryFixture(
  ownerUrl: string,
  clubId: string,
  dataset: DemoDataset,
): Promise<InjuryFixture> {
  const player = fixturePlayer(dataset);
  const today: LocalDate = dataset.asOf;
  const fixture: InjuryFixture = {
    playerId: player.id,
    diagnosis: `${DEMO_INJURY_DIAGNOSIS_PREFIX} (knee) E2E ${randomUUID()}. ${DEMO_MARK}`,
    validFrom: addDays(today, -HOLD_STARTED_DAYS_AGO),
    validTo: addDays(today, HOLD_LASTS_DAYS),
  };
  const client = new pg.Client({
    connectionString: ownerUrl,
    application_name: 'sport-performance-e2e',
  });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.club_id', $1, true)`, [clubId]);
    const { rows } = await client.query<{ id: string }>(
      `insert into medical.injury
         (club_id, player_id, onset_on, context, body_region, side, onset, mechanism,
          diagnosis, expected_return_on)
       values ($1, $2, $3, 'training', 'knee', 'left', 'acute', 'non_contact', $4, $5)
       returning id`,
      [clubId, fixture.playerId, fixture.validFrom, fixture.diagnosis, fixture.validTo],
    );
    const injuryId = rows[0]?.id;
    if (injuryId === undefined) throw new Error('unreachable: the fixture injury was not written');
    await client.query(
      `insert into medical.hold
         (club_id, player_id, injury_id, training, match, valid_from, valid_to, staff_note)
       values ($1, $2, $3, 'unavailable', 'unavailable', $4, $5, 'Sin entrenamiento ni partido')`,
      [clubId, fixture.playerId, injuryId, fixture.validFrom, fixture.validTo],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
  return fixture;
}
