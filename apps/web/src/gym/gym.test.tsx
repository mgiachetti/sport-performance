import type { GymProgram, GymSet } from '@sport-performance/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { reply } from '../test/fake-api';
import * as fixtures from '../test/fixtures';
import { renderApp, signedIn } from '../test/render-app';
import { emptyProgramForm, issuePaths, planInput, programForm, withChoice } from './model';

const AT = '2026-03-01T12:00:00.000Z';
const PROGRAM_ID = '0192e7a0-9999-7000-8000-000000000001';
const PLAYER_ID = '0192e7a0-5555-7000-8000-000000000001';

function program(overrides: Partial<GymProgram> = {}): GymProgram {
  return {
    id: PROGRAM_ID as GymProgram['id'],
    name: 'Fuerza M15',
    categoryId: fixtures.M15_RUGBY.id,
    playerId: null,
    stage: 'development',
    plan: {
      days: [
        {
          key: 'a',
          name: 'Inferior',
          exercises: [
            {
              exerciseCode: 'trap_bar_deadlift',
              name: null,
              loadKind: 'external',
              measure: 'reps',
              sets: 3,
              repsMin: 3,
              repsMax: 5,
              durationS: null,
              targetRir: 2,
              loadKg: 60,
              restS: 120,
              notes: null,
            },
          ],
        },
      ],
    },
    notes: null,
    validFrom: '2026-03-01' as GymProgram['validFrom'],
    validTo: null,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: '1',
    ...overrides,
  };
}

function gymSet(overrides: Partial<GymSet> = {}): GymSet {
  return {
    id: '0192e7a0-8888-7000-8000-000000000001' as GymSet['id'],
    playerId: PLAYER_ID as GymSet['playerId'],
    gymProgramId: null,
    dayKey: null,
    performedOn: '2026-03-10' as GymSet['performedOn'],
    exerciseCode: 'trap_bar_deadlift',
    loadKind: 'external',
    setNumber: 2,
    reps: 5,
    loadKg: 65,
    rir: 0,
    techniqueScore: null,
    durationS: null,
    notes: null,
    strengthAssessment: 'estimated_rm',
    e1rmKg: null,
    warnings: ['to_failure'],
    voidedAt: null,
    voidReason: null,
    createdAt: AT,
    updatedAt: AT,
    version: '1',
    ...overrides,
  };
}

const sc = () => signedIn({ memberships: [fixtures.membership('sc')] });
const MODULES = {
  modules: {
    wellness: true,
    gym: true,
    gps: false,
    maturation: true,
    pain_report: false,
    menstrual_cycle: false,
  },
  version: '1',
};

describe('program form model', () => {
  it('turns the form into the plan of the contract, with numbers parsed in es-AR', () => {
    const form = emptyProgramForm(fixtures.M15_RUGBY.id, '2026-03-01');
    const day = form.days[0];
    if (day === undefined) throw new Error('a day');
    const exercise = {
      ...withChoice(day.exercises[0] ?? withChoiceSeed(), 'bench_press'),
      loadKg: '42,5',
    };
    const result = planInput({ ...form, days: [{ ...day, name: 'A', exercises: [exercise] }] });
    expect(result).toEqual({
      plan: {
        days: [
          {
            key: 'a',
            name: 'A',
            exercises: [
              expect.objectContaining({
                exerciseCode: 'bench_press',
                loadKind: 'external',
                measure: 'reps',
                sets: 3,
                repsMin: 8,
                repsMax: 10,
                targetRir: 2,
                loadKg: 42.5,
              }),
            ],
          },
        ],
      },
    });
  });

  it('reports what is missing or not a number before sending', () => {
    const form = emptyProgramForm(fixtures.M15_RUGBY.id, '2026-03-01');
    const day = form.days[0];
    if (day === undefined) throw new Error('a day');
    const exercise = { ...(day.exercises[0] ?? withChoiceSeed()), sets: '', targetRir: 'dos' };
    expect(planInput({ ...form, days: [{ ...day, exercises: [exercise] }] })).toEqual({
      issues: [
        { path: 'plan.days.0.name', code: 'required' },
        { path: 'plan.days.0.exercises.0.sets', code: 'required' },
        { path: 'plan.days.0.exercises.0.targetRir', code: 'number' },
      ],
    });
  });

  it('round-trips a stored program and maps the API issues to the form paths', () => {
    const form = programForm(program());
    expect(form.days[0]?.exercises[0]).toMatchObject({ choice: 'trap_bar_deadlift', loadKg: '60' });
    expect(
      issuePaths([
        {
          path: ['body', 'plan', 'days', 0, 'exercises', 0, 'targetRir'],
          code: 'custom',
          message: 'x',
        },
      ]),
    ).toEqual(new Map([['plan.days.0.exercises.0.targetRir', 'x']]));
  });
});

function withChoiceSeed() {
  return withChoice(
    {
      key: 'k',
      choice: 'goblet_squat',
      customCode: '',
      customName: '',
      loadKind: 'external',
      measure: 'reps',
      sets: '3',
      repsMin: '8',
      repsMax: '10',
      durationS: '',
      targetRir: '2',
      loadKg: '',
      restS: '90',
      notes: '',
    },
    'goblet_squat',
  );
}

describe('gym programs', () => {
  it('lists the programs of the scope from the navigation, and archives one', async () => {
    const { api, user } = renderApp({
      path: '/',
      handlers: {
        ...sc(),
        getClubModules: () => MODULES,
        listGymPrograms: () => fixtures.page([program()]),
        archiveGymProgram: () => program({ archivedAt: AT }),
      },
    });
    await user.click(await screen.findByRole('link', { name: 'Gimnasio' }));
    expect(await screen.findByRole('heading', { name: 'Programas de gimnasio' })).toBeVisible();
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: 'Fuerza M15' })).toBeVisible();
    expect(within(table).getByText('M15, solo M15/M16 (desarrollo)')).toBeVisible();
    expect(within(table).getByText('Activo')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Nuevo programa' })).toBeVisible();
    await user.click(within(table).getByRole('button', { name: 'Archivar Fuerza M15' }));
    await waitFor(() => {
      expect(api.callsTo('archiveGymProgram')).toHaveLength(1);
    });
    expect(api.callsTo('listGymPrograms')[0]?.url.searchParams.get('status')).toBe('active');
  });

  it('is read only for the coach', async () => {
    renderApp({
      path: '/gym',
      handlers: {
        ...signedIn(),
        getClubModules: () => MODULES,
        listGymPrograms: () => fixtures.page([program()]),
      },
    });
    expect(await screen.findByRole('table')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Nuevo programa' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Archivar/ })).toBeNull();
  });

  it('creates a program and shows the stage rules the API answers at their field', async () => {
    let calls = 0;
    const { api, user, app } = renderApp({
      path: '/gym/new',
      handlers: {
        ...sc(),
        listPlayers: () => fixtures.page([]),
        createGymProgram: () => {
          calls += 1;
          return calls === 1
            ? reply(400, {
                error: {
                  code: 'validation_failed',
                  message: 'The plan breaks the rules of the stage',
                  details: [
                    {
                      path: ['body', 'plan', 'days', 0, 'exercises', 0, 'targetRir'],
                      code: 'custom',
                      message: 'M15/M16: nunca al fallo',
                    },
                  ],
                },
              })
            : program();
        },
        getGymProgram: () => program(),
      },
    });
    await user.type(await screen.findByLabelText('Nombre'), 'Fuerza M15');
    await user.type(screen.getByLabelText('Nombre del día 1'), 'Inferior');
    fireEvent.change(screen.getByLabelText('RIR objetivo'), { target: { value: '0' } });
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('M15/M16: nunca al fallo')).toBeVisible();
    const first = api.callsTo('createGymProgram')[0]?.body as {
      clientUuid: string;
      categoryId: string;
      plan: { days: { exercises: { targetRir: number }[] }[] };
    };
    expect(first.categoryId).toBe(fixtures.M15_RUGBY.id);
    expect(first.plan.days[0]?.exercises[0]?.targetRir).toBe(0);
    fireEvent.change(screen.getByLabelText('RIR objetivo'), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      expect(app.router.state.location.pathname).toBe(`/gym/${PROGRAM_ID}`);
    });
    const second = api.callsTo('createGymProgram')[1]?.body as { clientUuid: string };
    // The same create, retried: idempotent by its clientUuid.
    expect(second.clientUuid).toBe(first.clientUuid);
  });
});

describe('gym block of the player profile', () => {
  it('shows the best e1RM per exercise, the warnings, and lets the S&C staff log and void', async () => {
    const { api, user } = renderApp({
      path: `/players/${PLAYER_ID}?tab=gym`,
      handlers: {
        ...sc(),
        getPlayer: () => ({
          id: PLAYER_ID as never,
          firstName: 'Juan',
          lastName: 'Pérez',
          birthDate: '2011-05-01' as never,
          sex: 'male',
          sport: 'rugby',
          dominantSide: 'right',
          positionIds: [],
          currentCategoryIds: [fixtures.M15_RUGBY.id],
          joinedOn: '2020-01-01' as never,
          leftOn: null,
          leftReason: null,
          leftNote: null,
          hasAccount: true,
          archivedAt: null,
          createdAt: AT,
          updatedAt: AT,
          version: '1',
        }),
        listPositions: () => fixtures.page([]),
        getPlayerGymSummary: () => ({
          playerId: PLAYER_ID as never,
          from: '2025-11-03' as never,
          to: '2026-11-03' as never,
          exercises: [
            {
              exerciseCode: 'trap_bar_deadlift',
              setsN: 4,
              lastPerformedOn: '2026-03-10' as never,
              bestE1rmKg: 74,
              bestOn: '2026-03-03' as never,
              series: [
                { on: '2026-03-03' as never, e1rmKg: 74 },
                { on: '2026-03-10' as never, e1rmKg: 72 },
              ],
            },
          ],
        }),
        listGymSets: () => fixtures.page([gymSet()]),
        logGymSets: () => ({ items: [{ outcome: 'created' as const, set: gymSet() }] }),
        voidGymSet: () => gymSet({ voidedAt: AT, voidReason: 'Error' }),
      },
    });
    const card = await screen.findByRole('region', { name: 'Gimnasio' });
    await within(card).findByRole('table', { name: 'Mejor e1RM por ejercicio' });
    const best = within(card).getByRole('table', { name: 'Mejor e1RM por ejercicio' });
    expect(await within(best).findByText('74,0 kg')).toBeVisible();
    expect(
      within(card).getByText('Serie al fallo (RIR 0): en esta etapa nunca se va al fallo.'),
    ).toBeVisible();
    expect(within(card).getByRole('figure', { name: /e1RM de Peso muerto/ })).toBeVisible();

    await user.selectOptions(within(card).getByLabelText('Ejercicio'), 'Press de banca');
    await user.type(within(card).getByLabelText('Repeticiones'), '5');
    await user.type(within(card).getByLabelText('Kilos (o kilos de lastre)'), '42,5');
    await user.type(within(card).getByLabelText('RIR'), '2');
    await user.selectOptions(within(card).getByLabelText('Nota técnica'), '3');
    await user.click(within(card).getByRole('button', { name: 'Cargar la serie' }));
    await waitFor(() => {
      expect(api.callsTo('logGymSets')).toHaveLength(1);
    });
    expect(api.callsTo('logGymSets')[0]?.body).toMatchObject({
      playerId: PLAYER_ID,
      sets: [{ exerciseCode: 'bench_press', reps: 5, loadKg: 42.5, rir: 2, techniqueScore: 3 }],
    });

    await user.click(within(card).getByRole('button', { name: 'Anular la serie 2' }));
    await user.type(within(card).getByLabelText('Motivo'), 'Cargada dos veces');
    await user.click(within(card).getByRole('button', { name: 'Anular' }));
    await waitFor(() => {
      expect(api.callsTo('voidGymSet')[0]?.body).toEqual({ reason: 'Cargada dos veces' });
    });
  });
});
