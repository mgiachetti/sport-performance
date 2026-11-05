// @vitest-environment jsdom
import type { MyTestDay, PlayerConsents, PlayerPercentile } from '@sport-performance/contracts';
import { localDate, parseTimeZone } from '@sport-performance/domain';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RpeSession } from '../player/today.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { PlayerConsentsScreen } from './player-consents.tsx';
import { PlayerTestsScreen } from './player-tests.tsx';
import {
  PlayerTodayScreen,
  type PlayerTodayActions,
  type PlayerTodayData,
} from './player-today.tsx';

const { t } = translator;
const TODAY = localDate(2026, 11, 3);
const TIME_ZONE = parseTimeZone('America/Argentina/Buenos_Aires');
const SESSION_ID = 'c1111111-1111-4111-8111-111111111111';

function actions() {
  return {
    onSubmitWellness: vi.fn<PlayerTodayActions['onSubmitWellness']>(() => Promise.resolve()),
    onCorrectWellness: vi.fn<PlayerTodayActions['onCorrectWellness']>(() => Promise.resolve()),
    onSubmitRpe: vi.fn<PlayerTodayActions['onSubmitRpe']>(() => Promise.resolve()),
    onRetry: vi.fn<PlayerTodayActions['onRetry']>(),
  };
}

const rpeSession: RpeSession = {
  session: {
    id: SESSION_ID as RpeSession['session']['id'],
    sport: 'rugby',
    kind: 'training',
    categoryId: null,
    title: null,
    startsAt: '2026-11-03T22:00:00.000Z',
    localDate: TODAY,
    plannedDurationMin: 90,
    archivedAt: null,
  },
  closesAt: '2026-11-05T03:00:00.000Z',
  rpe: null,
  minutes: 90,
  pending: false,
  canSubmit: true,
};

function data(overrides: Partial<PlayerTodayData> = {}): PlayerTodayData {
  return {
    today: TODAY,
    timeZone: TIME_ZONE,
    wellness: {
      kind: 'form',
      itemCount: 3,
      items: ['sleep', 'fatigue', 'soreness'],
      entry: null,
    },
    rpe: { allowed: true, sessions: [rpeSession] },
    streak: { days: 0, includesToday: false },
    nextTestDay: null,
    ...overrides,
  };
}

function renderToday(overrides: Partial<PlayerTodayData> = {}, handlers = actions()) {
  renderScreen(
    <PlayerTodayScreen
      greeting="Hola, Tomás"
      state={{ status: 'ready', data: data(overrides) }}
      notice={null}
      actions={handlers}
    />,
  );
  return handlers;
}

describe('PlayerTodayScreen: wellness', () => {
  it('asks M13/M14 three items with faces, one tap each', async () => {
    const handlers = renderToday();
    expect(screen.queryByRole('radio', { name: 'Estrés: Bien' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Sueño: Bien' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Fatiga: Normal' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dolor muscular: Muy bien' }));
    fireEvent.click(screen.getByRole('button', { name: t('playerApp.wellness.send') }));
    await waitFor(() => {
      expect(handlers.onSubmitWellness).toHaveBeenCalledWith({ sleep: 4, fatigue: 3, soreness: 5 });
    });
  });

  it('says which items are missing', () => {
    const handlers = renderToday();
    fireEvent.click(screen.getByRole('radio', { name: 'Sueño: Bien' }));
    fireEvent.click(screen.getByRole('button', { name: t('playerApp.wellness.send') }));
    expect(
      screen.getByText(t('playerApp.wellness.missing', { items: 'Fatiga, Dolor muscular' })),
    ).toBeDefined();
    expect(handlers.onSubmitWellness).not.toHaveBeenCalled();
  });

  it('asks five items from 1 to 5 with the anchors of each one', () => {
    renderToday({
      wellness: {
        kind: 'form',
        itemCount: 5,
        items: ['sleep', 'fatigue', 'soreness', 'stress', 'mood'],
        entry: null,
      },
    });
    expect(screen.getByRole('radio', { name: 'Ánimo: 5 de 5' })).toBeDefined();
    expect(screen.getByText(`1 · ${t('playerApp.wellness.low.stress')}`)).toBeDefined();
    expect(screen.queryByRole('radio', { name: 'Ánimo: Muy bien' })).toBeNull();
  });

  it('shows a check-in waiting for signal and corrects it with a reason', async () => {
    const handlers = renderToday({
      wellness: {
        kind: 'form',
        itemCount: 3,
        items: ['sleep', 'fatigue', 'soreness'],
        entry: {
          scores: { sleep: 2, fatigue: 3, soreness: 4 },
          target: { clientUuid: 'd1111111-1111-4111-8111-111111111111' },
          pending: true,
        },
      },
    });
    expect(screen.getByText(t('playerApp.pending'))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('playerApp.wellness.correct') }));
    fireEvent.click(screen.getByRole('radio', { name: 'Sueño: Bien' }));
    fireEvent.click(screen.getByRole('button', { name: t('playerApp.wellness.saveCorrection') }));
    expect(screen.getByText(t('playerApp.reason.required'))).toBeDefined();
    fireEvent.change(screen.getByLabelText(t('playerApp.reason.label')), {
      target: { value: 'Toqué la carita equivocada' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('playerApp.wellness.saveCorrection') }));
    await waitFor(() => {
      expect(handlers.onCorrectWellness).toHaveBeenCalledWith(
        { clientUuid: 'd1111111-1111-4111-8111-111111111111' },
        { sleep: 4 },
        'Toqué la carita equivocada',
      );
    });
  });

  it('offers "¿Te duele algo?" after the check-in only when the club asks it (B-609)', () => {
    const submitted = {
      wellness: {
        kind: 'form' as const,
        itemCount: 3 as const,
        items: ['sleep', 'fatigue', 'soreness'] as const,
        entry: {
          scores: { sleep: 4, fatigue: 4, soreness: 2 },
          target: { clientUuid: 'd2222222-2222-4222-8222-222222222222' },
          pending: false,
        },
      },
    };
    const onOpenPainReport = vi.fn();
    const { unmount } = renderScreen(
      <PlayerTodayScreen
        greeting="Hola, Tomás"
        state={{ status: 'ready', data: data(submitted) }}
        notice={null}
        actions={{ ...actions(), onOpenPainReport }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('pain.title') }));
    expect(onOpenPainReport).toHaveBeenCalledOnce();
    unmount();
    renderToday(submitted);
    expect(screen.queryByRole('button', { name: t('pain.title') })).toBeNull();
  });

  it('opens "Otra actividad" from Hoy only for whoever reports it (B-511)', () => {
    const onOpenExternalLoad = vi.fn();
    const { unmount } = renderScreen(
      <PlayerTodayScreen
        greeting="Hola, Tomás"
        state={{ status: 'ready', data: data() }}
        notice={null}
        actions={{ ...actions(), onOpenExternalLoad }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('externalLoad.open') }));
    expect(onOpenExternalLoad).toHaveBeenCalledOnce();
    unmount();
    renderToday();
    expect(screen.queryByRole('button', { name: t('externalLoad.open') })).toBeNull();
  });

  it('explains why there is nothing to load without a data consent', () => {
    renderToday({
      wellness: { kind: 'unavailable', reason: 'no_consent' },
      rpe: { allowed: false, sessions: [] },
    });
    expect(screen.getByText(t('playerApp.wellness.noConsent'))).toBeDefined();
    expect(screen.getByText(t('playerApp.rpe.noConsent'))).toBeDefined();
  });
});

describe('PlayerTodayScreen: RPE, streak and next test day', () => {
  it('sends the CR-10 RPE of a session', async () => {
    const handlers = renderToday();
    fireEvent.click(screen.getByRole('radio', { name: 'RPE 7: Muy duro' }));
    expect(screen.getByText('Elegiste 7: Muy duro')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('playerApp.rpe.send') }));
    await waitFor(() => {
      expect(handlers.onSubmitRpe).toHaveBeenCalledWith(SESSION_ID, 7, null);
    });
  });

  it('shows a sent RPE with the session load and corrects it with a reason', async () => {
    const handlers = renderToday({ rpe: { allowed: true, sessions: [{ ...rpeSession, rpe: 5 }] } });
    expect(screen.getByText(t('playerApp.rpe.value', { value: 5 }))).toBeDefined();
    expect(screen.getByText(t('rpe.sessionLoad', { load: '450' }))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('playerApp.wellness.correct') }));
    fireEvent.click(screen.getByRole('radio', { name: 'RPE 6' }));
    fireEvent.change(screen.getByLabelText(t('playerApp.reason.label')), {
      target: { value: 'Fue más dura' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('playerApp.rpe.send') }));
    await waitFor(() => {
      expect(handlers.onSubmitRpe).toHaveBeenCalledWith(SESSION_ID, 6, 'Fue más dura');
    });
  });

  it('shows the streak and the next test day with its tests', () => {
    const next: MyTestDay = {
      id: 'e1111111-1111-4111-8111-111111111111' as MyTestDay['id'],
      scheduledOn: localDate(2026, 11, 10),
      status: 'scheduled',
      location: 'Cancha 2',
      testWindow: {
        id: 'f1111111-1111-4111-8111-111111111111' as never,
        number: 4,
        label: 'V4',
      },
      testCodes: ['sprint_40', 'cmj'],
    };
    renderToday({ streak: { days: 11, includesToday: false }, nextTestDay: next });
    // The streak is a KPI tile: the figure and its unit apart, read as one sentence.
    expect(
      screen.getByLabelText(
        `${t('playerApp.streak.title')}: ${t('wellness.streak', { days: 11 })}. ${t('playerApp.streak.keepAlive')}`,
      ),
    ).toBeDefined();
    expect(screen.getByText(t('playerApp.streak.unit', { days: 11 }))).toBeDefined();
    expect(screen.getByText(t('playerApp.streak.keepAlive'))).toBeDefined();
    expect(screen.getByText('V4 · Cancha 2')).toBeDefined();
    expect(
      screen.getByText(
        t('playerApp.testDays.tests', {
          tests: 'Sprint 10/20/40 m, Salto con contramovimiento (CMJ)',
        }),
      ),
    ).toBeDefined();
  });
});

const percentile: PlayerPercentile = {
  metricCode: 'cmj_height_cm',
  testCode: 'cmj',
  exercise: null,
  unit: 'cm',
  direction: 'higher_is_better',
  value: 38.5,
  measuredOn: localDate(2026, 10, 1),
  method: 'app',
  protocolVersion: 1,
  status: 'ok',
  percentile: 72,
  sampleSize: 18,
  grouping: { dimensions: ['sex', 'category'], seasonsAccumulated: 1 },
  seasonFrom: 2026,
  seasonTo: 2026,
  median: 36,
  mixedMethods: false,
};

describe('PlayerTestsScreen', () => {
  it('keeps percentiles away from M13/M14', () => {
    renderScreen(
      <PlayerTestsScreen
        notice={null}
        records={[]}
        percentiles={{ kind: 'hidden' }}
        history={[]}
        testDays={[]}
      />,
    );
    expect(screen.getByText(t('playerApp.percentiles.fromM15'))).toBeDefined();
    expect(screen.getByText(t('playerApp.records.none'))).toBeDefined();
    expect(screen.getByText(t('playerApp.testDays.none'))).toBeDefined();
  });

  it('shows own percentiles as aggregates only, and records with their method', () => {
    renderScreen(
      <PlayerTestsScreen
        notice="Sin conexión"
        records={[
          {
            key: 'sprint_40_s:',
            metricCode: 'sprint_40_s',
            testCode: 'sprint_40',
            exercise: null,
            unit: 's',
            direction: 'lower_is_better',
            value: 5.4,
            measuredOn: localDate(2026, 9, 2),
            method: 'manual',
            resultCount: 2,
            mixedMethods: true,
          },
        ]}
        percentiles={{
          kind: 'ready',
          items: [
            percentile,
            {
              ...percentile,
              metricCode: 'sprint_40_s',
              status: 'insufficient_sample',
              percentile: null,
              sampleSize: null,
            },
          ],
        }}
        history={[]}
        testDays={[]}
      />,
    );
    expect(screen.getByText(t('playerApp.percentiles.value', { percentile: '72' }))).toBeDefined();
    expect(screen.getByText(/Mediana del grupo: 36,0\s?cm · 18 jugadores\/as/)).toBeDefined();
    expect(screen.getByText(t('playerApp.percentiles.insufficient'))).toBeDefined();
    expect(screen.getByText(t('playerApp.records.mixedMethods'))).toBeDefined();
    expect(screen.getByText('02/09/2026 · Manual')).toBeDefined();
  });
});

function consents(ofAge: boolean, actionsOf: ('sign' | 'revoke')[]): PlayerConsents {
  return {
    playerId: 'b1111111-1111-4111-8111-111111111111',
    playerOfAge: ofAge,
    requiredSigner: ofAge ? 'player' : 'guardian',
    guardianSignaturesLapseOn: localDate(2027, 1, 1),
    types: [
      {
        type: 'data',
        state: 'missing',
        consent: null,
        currentDocument: {
          id: 'a9999999-1111-4111-8111-111111111111',
          type: 'data',
          version: '2026-11',
          locale: 'es-AR',
          title: 'Datos personales',
          bodySha256: 'a'.repeat(64),
          publishedAt: '2026-11-01T12:00:00.000Z',
          current: true,
        },
        actions: actionsOf,
      },
    ],
  } as PlayerConsents;
}

function renderConsents(value: PlayerConsents, offline = false) {
  const handlers = {
    onRead: vi.fn(),
    onSign: vi.fn(),
    onRevoke: vi.fn(),
    onCloseDocument: vi.fn(),
    onBack: vi.fn(),
    onRetry: vi.fn(),
  };
  renderScreen(
    <PlayerConsentsScreen
      state={{ status: 'ready', consents: value, timeZone: TIME_ZONE }}
      document={null}
      offline={offline}
      busy={false}
      notice={null}
      error={null}
      actions={handlers}
    />,
  );
  return handlers;
}

describe('PlayerConsentsScreen', () => {
  it('tells a minor that the guardian signs, with the state as icon and text', () => {
    renderConsents(consents(false, []));
    expect(screen.getByText(t('playerApp.consents.minor'))).toBeDefined();
    expect(screen.getByText(t('guardian.consents.state.missing'))).toBeDefined();
    expect(screen.queryByRole('button', { name: t('guardian.consents.read') })).toBeNull();
  });

  it('lets an adult read and sign, only with connection', () => {
    const handlers = renderConsents(consents(true, ['sign', 'revoke']));
    expect(screen.getByText(t('playerApp.consents.adult'))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('guardian.consents.read') }));
    expect(handlers.onRead).toHaveBeenCalledWith('a9999999-1111-4111-8111-111111111111');
  });

  it('asks for connection to sign offline', () => {
    renderConsents(consents(true, ['sign']), true);
    expect(screen.getByText(t('playerApp.consents.needsConnection'))).toBeDefined();
    expect(screen.queryByRole('button', { name: t('guardian.consents.read') })).toBeNull();
  });
});
