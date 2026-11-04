import {
  createApiClient,
  type GymProgram,
  type GymSet,
  type SyncChange,
} from '@sport-performance/contracts';
import { parseLocalDate } from '@sport-performance/domain';
import { createTranslator } from '@sport-performance/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../offline/db/database.ts';
import { createSyncEngine } from '../offline/engine.ts';
import type { LocalRow } from '../offline/local-store.ts';
import { createFakeApi } from '../test/fake-api.ts';
import { PLAYER_ID, T0, createFakeSyncServer, uuid } from '../test/fake-sync-server.ts';
import { programDto } from '../test/gym-fixtures.ts';
import { nodeSqliteDriver } from '../test/node-sqlite.ts';
import {
  bestE1rms,
  canLogGym,
  exerciseName,
  logSetInput,
  nextSetNumber,
  parseSetForm,
  prefilledForm,
  programsInForce,
  sessionSets,
} from './model.ts';

const TODAY = parseLocalDate('2026-11-03');
const AT = '2026-11-01T12:00:00.000Z';
const SCOPE = { membershipId: 'a1111111-1111-4111-8111-111111111111', userId: 'u1' };

function setDto(overrides: Partial<GymSet> = {}): GymSet {
  return {
    id: uuid() as GymSet['id'],
    playerId: PLAYER_ID as GymSet['playerId'],
    gymProgramId: null,
    dayKey: null,
    performedOn: TODAY,
    exerciseCode: 'trap_bar_deadlift',
    loadKind: 'external',
    setNumber: 1,
    reps: 5,
    loadKg: 60,
    rir: 2,
    techniqueScore: null,
    durationS: null,
    notes: null,
    strengthAssessment: 'estimated_rm',
    e1rmKg: 74,
    warnings: [],
    voidedAt: null,
    voidReason: null,
    createdAt: AT,
    updatedAt: AT,
    version: '1',
    ...overrides,
  };
}

const row = <C extends 'gym_program' | 'gym_set'>(
  data: C extends 'gym_program' ? GymProgram : GymSet,
): LocalRow<C> =>
  ({ id: data.id, clientUuid: null, data, pending: false }) as unknown as LocalRow<C>;

describe('gym model', () => {
  it('lets only the player log from the phone', () => {
    expect(canLogGym('player')).toBe(true);
    expect(canLogGym('sc')).toBe(false);
  });

  it('keeps the programs in force, the player’s own first', () => {
    const own = programDto({
      name: 'Zeta',
      playerId: PLAYER_ID as GymProgram['playerId'],
      categoryId: null,
    });
    const group = programDto({ name: 'Alfa' });
    const archived = programDto({ archivedAt: AT });
    const future = programDto({ validFrom: parseLocalDate('2026-12-01') });
    const ended = programDto({ validTo: TODAY });
    expect(
      programsInForce([group, own, archived, future, ended].map(row<'gym_program'>), TODAY).map(
        (p) => p.name,
      ),
    ).toEqual(['Zeta', 'Alfa']);
  });

  it('parses the form in es-AR against what the exercise records', () => {
    const external = { loadKind: 'external', measure: 'reps' } as const;
    expect(parseSetForm({ reps: '5', loadKg: '62,5', rir: '2', durationS: '' }, external)).toEqual({
      set: { reps: 5, loadKg: 62.5, rir: 2, durationS: null },
    });
    expect(parseSetForm({ reps: '', loadKg: '62.5', rir: '', durationS: '' }, external)).toEqual({
      errors: { reps: 'required', loadKg: 'number', rir: 'required' },
    });
    const hold = { loadKind: 'bodyweight', measure: 'duration' } as const;
    expect(parseSetForm({ reps: '', loadKg: '', rir: '', durationS: '45' }, hold)).toEqual({
      set: { reps: null, loadKg: null, rir: null, durationS: 45 },
    });
    const weighted = { loadKind: 'bodyweight_plus', measure: 'reps' } as const;
    expect(parseSetForm({ reps: '4', loadKg: '0', rir: '3', durationS: '' }, weighted)).toEqual({
      set: { reps: 4, loadKg: 0, rir: 3, durationS: null },
    });
  });

  it('prefills the form with the prescription', () => {
    const exercise = programDto().plan.days[0]?.exercises[0];
    if (exercise === undefined) throw new Error('an exercise');
    expect(prefilledForm(exercise)).toEqual({ reps: '5', loadKg: '62,5', rir: '2', durationS: '' });
  });

  it('names the exercises of the library and of the club', () => {
    const translator = createTranslator();
    expect(exerciseName('trap_bar_deadlift', null, translator)).toBe(
      'Peso muerto con barra hexagonal',
    );
    expect(exerciseName('sled_push', 'Empuje de trineo', translator)).toBe('Empuje de trineo');
  });

  it('gives the best e1RM per exercise from the served sets', () => {
    const sets = [
      setDto({ e1rmKg: 74, performedOn: parseLocalDate('2026-10-20') }),
      setDto({ e1rmKg: 80, voidedAt: AT }),
      setDto({ e1rmKg: null, exerciseCode: 'push_up', loadKind: 'bodyweight', loadKg: null }),
    ].map(row<'gym_set'>);
    expect(bestE1rms(sets)).toEqual([
      expect.objectContaining({ exerciseCode: 'trap_bar_deadlift', bestE1rmKg: 74 }),
    ]);
  });
});

describe('gym sets through the offline queue', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  async function setup() {
    const api = createFakeApi();
    const server = createFakeSyncServer(api);
    const client = createApiClient({ baseUrl: api.baseUrl, fetch: api.fetch });
    const database = await openLocalDatabase(nodeSqliteDriver());
    const engine = createSyncEngine({
      database,
      api: client,
      randomUUID: uuid,
      now: () => T0,
      random: () => 0.5,
      setTimer: () => 1,
      clearTimer: () => undefined,
      reportError: () => undefined,
    });
    await engine.setScope(SCOPE);
    cleanups.push(() => {
      engine.dispose();
    });
    return { engine, server };
  }

  it('shows a set as pending until the pull brings it with its e1RM', async () => {
    const { engine, server } = await setup();
    const program = programDto();
    const clientUuid = uuid();
    await engine.enqueue(
      'gym_set.log',
      logSetInput({
        clientUuid,
        program,
        dayKey: 'a',
        exerciseCode: 'trap_bar_deadlift',
        setNumber: 1,
        set: { reps: 5, loadKg: 60, rir: 2, durationS: null },
      }),
    );
    const read = async () =>
      sessionSets(
        await engine.store.list(SCOPE.membershipId, 'gym_set'),
        await engine.store.pending(SCOPE.membershipId, ['gym_set.log']),
        TODAY,
      );
    let sets = await read();
    expect(sets).toEqual([
      expect.objectContaining({ key: clientUuid, setNumber: 1, pending: true, e1rmKg: null }),
    ]);
    expect(nextSetNumber(sets, 'trap_bar_deadlift')).toBe(2);

    await engine.syncNow();
    expect(server.pushes.flat().map((m) => m.op)).toEqual(['gym_set.log']);
    expect(server.pushes.flat()[0]?.body).toMatchObject({
      gymProgramId: program.id,
      dayKey: 'a',
      sets: [
        {
          clientUuid,
          exerciseCode: 'trap_bar_deadlift',
          setNumber: 1,
          reps: 5,
          loadKg: 60,
          rir: 2,
        },
      ],
    });
    const served = setDto({ gymProgramId: program.id, dayKey: 'a' });
    server.publish({
      collection: 'gym_set',
      op: 'upsert',
      id: served.id,
      clientUuid,
      data: served,
    } as SyncChange);
    await engine.syncNow();
    sets = await read();
    expect(sets).toEqual([expect.objectContaining({ key: served.id, pending: false, e1rmKg: 74 })]);
  });
});
