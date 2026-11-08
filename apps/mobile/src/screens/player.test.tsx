// @vitest-environment jsdom
import type { MyTestDay, PlayerConsents, PlayerPercentile } from '@sport-performance/contracts';
import { localDate, parseTimeZone } from '@sport-performance/domain';
import { formatLocalDateLong } from '@sport-performance/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RpeSession } from '../player/today.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { forgetRememberedSegments } from '../ui/segmented-tabs.tsx';
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
/** The collapsed line of a loaded check-in, by the start of its accessible name. */
const WELLNESS_LINE = new RegExp(`^${t('playerApp.today.wellnessDone')}`);
const LOADED = {
  kind: 'form' as const,
  itemCount: 3 as const,
  items: ['sleep', 'fatigue', 'soreness'] as const,
  entry: {
    scores: { sleep: 4, fatigue: 3, soreness: 4 },
    target: { id: 'a1111111-1111-4111-8111-111111111111' },
    pending: false,
  },
};

/** Whether `a` is drawn before `b` on the screen. */
function before(a: HTMLElement, b: HTMLElement): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

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
    // Loaded: one collapsed line with the pending mark, the form closed.
    expect(screen.getByLabelText(t('playerApp.pending'))).toBeDefined();
    expect(screen.getByText(t('sync.item.pending'))).toBeDefined();
    expect(screen.queryByRole('radio', { name: 'Sueño: Bien' })).toBeNull();
    expect(screen.queryByRole('button', { name: t('playerApp.wellness.correct') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: WELLNESS_LINE }));
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

describe('PlayerTodayScreen: ordered by status', () => {
  it('opens what is pending first and collapses what is done below it', () => {
    renderToday({ rpe: { allowed: true, sessions: [{ ...rpeSession, rpe: 6 }] } });
    const form = screen.getByRole('button', { name: t('playerApp.wellness.send') });
    const done = screen.getByRole('button', {
      name: new RegExp(`^${t('playerApp.today.rpeDone', { value: 6 })}`),
    });
    expect(before(form, done)).toBe(true);
    expect(done.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(t('playerApp.today.allDone'))).toBeNull();
  });

  it('says "all done" on top when nothing is pending, and opens a line on tap', () => {
    renderToday({
      wellness: LOADED,
      rpe: { allowed: true, sessions: [{ ...rpeSession, rpe: 6 }] },
    });
    const allDone = screen.getByText(t('playerApp.today.allDone'));
    const line = screen.getByRole('button', { name: WELLNESS_LINE });
    expect(before(allDone, line)).toBe(true);
    expect(screen.queryByRole('button', { name: t('playerApp.wellness.send') })).toBeNull();
    expect(screen.getByText(t('playerApp.today.wellnessMean', { mean: '3,7' }))).toBeDefined();
    fireEvent.click(line);
    expect(line.getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByLabelText(t('playerApp.wellness.answer', { item: 'Sueño', score: 4 })),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: t('playerApp.wellness.correct') })).toBeDefined();
    fireEvent.click(line);
    expect(screen.queryByRole('button', { name: t('playerApp.wellness.correct') })).toBeNull();
  });

  it('shows no RPE form without a session, only one muted line', () => {
    renderToday({ wellness: LOADED, rpe: { allowed: true, sessions: [] } });
    expect(screen.getByText(t('playerApp.today.allDone'))).toBeDefined();
    expect(screen.getByText(t('playerApp.rpe.none'))).toBeDefined();
    expect(screen.queryByRole('radiogroup', { name: t('rpe.prompt') })).toBeNull();
  });

  it('puts a pending RPE first and the done wellness line after it', () => {
    renderToday({ wellness: LOADED });
    const send = screen.getByRole('button', { name: t('playerApp.rpe.send') });
    const line = screen.getByRole('button', { name: WELLNESS_LINE });
    expect(before(send, line)).toBe(true);
    expect(screen.queryByText(t('playerApp.today.allDone'))).toBeNull();
  });

  async function sendCheckIn() {
    fireEvent.click(screen.getByRole('radio', { name: 'Sueño: Bien' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Fatiga: Normal' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dolor muscular: Muy bien' }));
    fireEvent.click(screen.getByRole('button', { name: t('playerApp.wellness.send') }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: WELLNESS_LINE })).toBeDefined();
    });
  }

  it('says "¡Listo!" as a sent form folds into its line, until all is done', async () => {
    const announce = vi.spyOn(AccessibilityInfo, 'announceForAccessibility');
    announce.mockClear();
    renderScreen(<StatefulToday />);
    expect(screen.queryByText(t('wellness.submitted'))).toBeNull();
    await sendCheckIn();
    expect(screen.queryByRole('button', { name: t('playerApp.wellness.send') })).toBeNull();
    // A polite live region: Android (and the web) read it, nothing else is announced.
    expect(screen.getByText(t('wellness.submitted'))).toBeDefined();
    expect(announce).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: 'RPE 7: Muy duro' }));
    fireEvent.click(screen.getByRole('button', { name: t('playerApp.rpe.send') }));
    await waitFor(() => {
      expect(screen.getByText(t('playerApp.today.allDone'))).toBeDefined();
    });
    // "Todo listo por hoy" says it: no "¡Listo!" stacked over it.
    expect(screen.queryByText(t('playerApp.today.rpeSubmitted'))).toBeNull();
    expect(screen.queryByText(t('wellness.submitted'))).toBeNull();
    announce.mockRestore();
  });

  it('says "¡Listo!" for an RPE sent while the check-in is still pending', async () => {
    renderScreen(<StatefulToday />);
    fireEvent.click(screen.getByRole('radio', { name: 'RPE 7: Muy duro' }));
    fireEvent.click(screen.getByRole('button', { name: t('playerApp.rpe.send') }));
    await waitFor(() => {
      expect(screen.getByText(t('playerApp.today.rpeSubmitted'))).toBeDefined();
    });
  });

  it('announces the save on iOS, where a live region is not read', async () => {
    const announce = vi.spyOn(AccessibilityInfo, 'announceForAccessibility');
    announce.mockClear();
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    try {
      renderScreen(<StatefulToday />);
      await sendCheckIn();
      expect(announce).toHaveBeenCalledWith(t('wellness.submitted'));
    } finally {
      Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
      announce.mockRestore();
    }
  });

  it('says nothing for a check-in that arrives from elsewhere (a sync pull, a kiosk)', () => {
    const announce = vi.spyOn(AccessibilityInfo, 'announceForAccessibility');
    announce.mockClear();
    renderScreen(<StatefulToday />);
    fireEvent.click(screen.getByRole('button', { name: 'pull' }));
    expect(screen.getByRole('button', { name: WELLNESS_LINE })).toBeDefined();
    expect(screen.queryByText(t('wellness.submitted'))).toBeNull();
    expect(announce).not.toHaveBeenCalled();
    announce.mockRestore();
  });

  it('keeps an opened line open while its correction is in progress', () => {
    renderToday({ wellness: LOADED, rpe: { allowed: true, sessions: [] } });
    const line = screen.getByRole('button', { name: WELLNESS_LINE });
    fireEvent.click(line);
    fireEvent.click(screen.getByRole('button', { name: t('playerApp.wellness.correct') }));
    fireEvent.click(screen.getByRole('radio', { name: 'Sueño: Mal' }));
    fireEvent.change(screen.getByLabelText(t('playerApp.reason.label')), {
      target: { value: 'Toqué mal' },
    });
    fireEvent.click(line);
    expect(line.getAttribute('aria-expanded')).toBe('true');
    // The draft is still there: the reason typed before the tap.
    expect(screen.getByLabelText<HTMLInputElement>(t('playerApp.reason.label')).value).toBe(
      'Toqué mal',
    );
    fireEvent.click(screen.getByRole('button', { name: t('common.cancel') }));
    fireEvent.click(line);
    expect(line.getAttribute('aria-expanded')).toBe('false');
  });

  it('draws no empty "Además" card', () => {
    renderScreen(
      <PlayerTodayScreen
        greeting="Hola, Tomás"
        state={{ status: 'error', message: 'Sin datos' }}
        notice={null}
        actions={actions()}
      />,
    );
    expect(screen.queryByText(t('playerApp.today.more'))).toBeNull();
  });
});

/** "Hoy" over its own state: what the player sends is laid over at once, as the queue does. */
function StatefulToday() {
  const [today, setToday] = useState(data());
  const handlers: PlayerTodayActions = {
    ...actions(),
    onSubmitWellness: (scores) => {
      setToday((current) => ({
        ...current,
        wellness: {
          kind: 'form',
          itemCount: 3,
          items: ['sleep', 'fatigue', 'soreness'],
          entry: {
            scores,
            target: { clientUuid: 'd9999999-9999-4999-8999-999999999999' },
            pending: true,
          },
        },
      }));
      return Promise.resolve();
    },
    onSubmitRpe: (sessionId, rpe) => {
      setToday((current) => ({
        ...current,
        rpe: {
          allowed: true,
          sessions: current.rpe.sessions.map((item) =>
            item.session.id === sessionId ? { ...item, rpe, pending: true } : item,
          ),
        },
      }));
      return Promise.resolve();
    },
  };
  return (
    <>
      {/* A check-in that lands without the form: a sync pull, or one loaded on a kiosk. */}
      <button
        type="button"
        onClick={() => {
          setToday((current) => ({ ...current, wellness: LOADED }));
        }}
      >
        pull
      </button>
      <PlayerTodayScreen
        greeting="Hola, Tomás"
        state={{ status: 'ready', data: today }}
        notice={null}
        actions={handlers}
      />
    </>
  );
}

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

  it('shows a sent RPE in one line, with the session load and a correction under it', async () => {
    const handlers = renderToday({ rpe: { allowed: true, sessions: [{ ...rpeSession, rpe: 5 }] } });
    const line = t('playerApp.today.rpeDone', { value: 5 });
    expect(screen.getByText(line)).toBeDefined();
    expect(screen.queryByText(t('rpe.sessionLoad', { load: '450' }))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${line}`) }));
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
    expect(
      screen.getByText(
        `${formatLocalDateLong(localDate(2026, 11, 10), { year: false })} · V4 · Cancha 2`,
      ),
    ).toBeDefined();
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

const testDay: MyTestDay = {
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

describe('PlayerTestsScreen', () => {
  beforeEach(() => {
    forgetRememberedSegments();
  });

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
    // No upcoming days: no badge.
    fireEvent.click(screen.getByRole('tab', { name: t('playerApp.tabs.upcoming') }));
    expect(screen.getByText(t('playerApp.testDays.none'))).toBeDefined();
  });

  it('splits records (with percentiles and protocols), history and upcoming days in tabs', () => {
    const onOpenProtocols = vi.fn();
    renderScreen(
      <PlayerTestsScreen
        notice="Sin conexión"
        records={[]}
        percentiles={{ kind: 'ready', items: [percentile] }}
        history={[]}
        testDays={[testDay]}
        onOpenProtocols={onOpenProtocols}
      />,
    );
    expect(screen.getByRole('tablist', { name: t('playerApp.tabs.label') })).toBeDefined();
    expect(
      screen.getByRole('tab', { name: t('playerApp.tabs.records'), selected: true }),
    ).toBeDefined();
    // The notice stays above the tabs, whichever is open.
    expect(screen.getByText('Sin conexión')).toBeDefined();
    expect(screen.getByText(t('playerApp.records.title'))).toBeDefined();
    expect(screen.getByText(t('playerApp.percentiles.title'))).toBeDefined();
    expect(screen.queryByText(t('playerApp.history.title'))).toBeNull();
    expect(screen.queryByText(t('playerApp.testDays.title'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('protocols.open')) }));
    expect(onOpenProtocols).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: t('playerApp.tabs.history') }));
    expect(screen.getByText(t('playerApp.history.none'))).toBeDefined();
    expect(screen.queryByText(t('playerApp.percentiles.title'))).toBeNull();
    expect(screen.getByText('Sin conexión')).toBeDefined();

    const upcoming = t('tabs.withBadge', {
      label: t('playerApp.tabs.upcoming'),
      badge: t('playerApp.tabs.upcomingBadge', { count: 1 }),
    });
    expect(upcoming).toBe('Próximos, 1 día de test');
    fireEvent.click(screen.getByRole('tab', { name: upcoming }));
    expect(screen.getByText(t('playerApp.testDays.title'))).toBeDefined();
    expect(screen.getByText('Cancha 2', { exact: false })).toBeDefined();
  });

  it('comes back to the last tab in the same app session', () => {
    const props = {
      notice: null,
      records: [],
      percentiles: { kind: 'hidden' } as const,
      history: [],
      testDays: [],
      segmentScope: 'm1',
    };
    const first = renderScreen(<PlayerTestsScreen {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: t('playerApp.tabs.history') }));
    first.unmount();
    renderScreen(<PlayerTestsScreen {...props} />);
    expect(
      screen.getByRole('tab', { name: t('playerApp.tabs.history'), selected: true }),
    ).toBeDefined();
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

  describe('location consent (B-913)', () => {
    function withLocation(state: 'granted' | 'outdated' | 'adult_signature_required') {
      const base = consents(true, ['sign', 'revoke']);
      const data = base.types[0];
      if (data === undefined) throw new Error('no data status');
      const document = data.currentDocument;
      if (document === null) throw new Error('no document');
      return {
        ...base,
        types: [
          {
            type: 'location',
            state,
            consent: {
              id: 'c9999999-1111-4111-8111-111111111111',
              playerId: base.playerId,
              type: 'location',
              documentId: 'a8888888-1111-4111-8111-111111111111',
              documentVersion: '2026-10',
              signerKind: state === 'adult_signature_required' ? 'guardian' : 'player',
              signedBy: 'user-1',
              signedAt: '2026-10-01T12:00:00.000Z',
              revokedAt: null,
              revokedBy: null,
            },
            currentDocument: { ...document, type: 'location', title: 'Ubicación con el pod' },
            actions: ['sign', 'revoke'],
          },
        ],
      } as PlayerConsents;
    }

    it('shows the location consent with its own name and help', () => {
      renderConsents(withLocation('granted'));
      expect(screen.getByText(t('guardian.consents.type.location'))).toBeDefined();
      expect(screen.getByText(t('playerApp.consents.typeHelpLocation'))).toBeDefined();
      expect(screen.getByText(/la administración del club/)).toBeDefined();
      expect(screen.getByText(t('guardian.consents.state.granted'))).toBeDefined();
    });

    it('an older text no longer counts: never "lo firmado sigue valiendo"', () => {
      renderConsents(withLocation('outdated'));
      expect(screen.getByText(t('playerApp.consents.outdatedLocation'))).toBeDefined();
      expect(screen.getByText(t('guardian.consents.state.outdatedGrantedOnly'))).toBeDefined();
      expect(screen.queryByText(t('guardian.consents.state.outdated'))).toBeNull();
      expect(screen.queryByText(t('guardian.consents.stateHelp.outdated'))).toBeNull();
      expect(screen.getByRole('button', { name: t('guardian.consents.readNew') })).toBeDefined();
    });

    it("an adult signs it: the guardian's signature does not count", () => {
      renderConsents(withLocation('adult_signature_required'));
      expect(screen.getByText(t('playerApp.consents.adultLocation'))).toBeDefined();
    });

    it('revoking warns that the traces are deleted', () => {
      const handlers = renderConsents(withLocation('granted'));
      fireEvent.click(screen.getByRole('button', { name: t('guardian.consents.revoke') }));
      expect(screen.getByText(t('playerApp.consents.revokeConfirmLocation'))).toBeDefined();
      fireEvent.click(
        screen.getByRole('button', { name: t('guardian.consents.revokeConfirmAction') }),
      );
      expect(handlers.onRevoke).toHaveBeenCalledWith('location');
    });
  });
});
