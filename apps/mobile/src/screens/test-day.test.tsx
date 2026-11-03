// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';
import type { TestDaySheet } from '@sport-performance/contracts';
import { DEFAULT_CLUB_TIME_ZONE } from '@sport-performance/domain';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  defaultStationSettings,
  fieldResults,
  playerStation,
  type FieldWrite,
  type WriteContext,
} from '../test-day/model.ts';
import { USER } from '../test/fixtures.ts';
import { must } from '../test/must.ts';
import { renderScreen, translator } from '../test/render.tsx';
import {
  ANA_ID,
  BRUNO_ID,
  DIEGO_ID,
  IFT,
  SESSION_ID,
  SPRINT,
  sheet as sheetFixture,
  sprintResult,
  testSession,
} from '../test/test-day-fixtures.ts';
import { StationScreen, TestDayListScreen, TestDayScreen } from './test-day.tsx';

const { t } = translator;

function station(sheet: TestDaySheet, synced = [sprintResult(ANA_ID)]) {
  const results = fieldResults({
    sheet,
    synced: synced.map((r) => ({ id: r.id, clientUuid: null, data: r, pending: false })),
    queue: [],
    viewer: 'sc',
  });
  const rows = sheet.players.map((p) => playerStation(SPRINT, p, results));
  const settings = defaultStationSettings(SPRINT);
  const writeContext = (): WriteContext => ({
    sheet,
    station: SPRINT,
    settings,
    evaluatorId: USER.id,
    uuid: randomUUID,
    nowIso: '2026-04-14T13:00:00.000Z',
  });
  const onSubmit = vi.fn<(writes: readonly FieldWrite[]) => Promise<void>>(() => Promise.resolve());
  renderScreen(
    <StationScreen
      sheet={sheet}
      station={SPRINT}
      rows={rows}
      settings={settings}
      viewer="sc"
      writeContext={writeContext}
      onSubmit={onSubmit}
      onChangeSettings={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  return { onSubmit };
}

describe('TestDayListScreen', () => {
  it('lists the days, says which ones work without signal and opens one', () => {
    const onOpen = vi.fn();
    const later = testSession({ id: 'c2222222-2222-4222-8222-222222222222' as never });
    renderScreen(
      <TestDayListScreen
        state={{ status: 'ready', upcoming: [testSession(), later], recent: [] }}
        categoryName={() => 'M15'}
        windowName={(id) => (id === null ? t('testDay.window.none') : 'V2')}
        savedSheets={new Map([[SESSION_ID, Date.UTC(2026, 3, 14, 12, 0)]])}
        timeZone={DEFAULT_CLUB_TIME_ZONE}
        offline={false}
        onOpen={onOpen}
      />,
    );
    // The window of each day and when its saved sheet was last updated.
    expect(
      screen.getByText(t('fieldTest.day.offlineReadyAt', { date: '14/04/2026 09:00' })),
    ).toBeDefined();
    expect(screen.getAllByText(`V2 · ${t('testDay.status.in_progress')}`).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(t('fieldTest.day.notDownloaded'))).toBeDefined();
    expect(screen.getByText(t('testDay.list.emptyPast'))).toBeDefined();
    fireEvent.click(
      must(
        screen.getAllByRole('button', {
          name: t('fieldTest.day.open', { date: '14/04/2026', category: 'M15', window: 'V2' }),
        })[0],
      ),
    );
    expect(onOpen).toHaveBeenCalledWith(SESSION_ID);
  });
});

describe('TestDayScreen', () => {
  it('shows the stations with their progress and when the sheet was saved', () => {
    const onOpenStation = vi.fn();
    const sheet = sheetFixture();
    renderScreen(
      <TestDayScreen
        state={{
          status: 'ready',
          sheet,
          savedAt: Date.UTC(2026, 3, 14, 12, 0),
          refreshing: false,
          refreshFailed: true,
          progress: new Map([['sprint_40', { recorded: 1, total: 3 }]]),
        }}
        categoryName={() => 'M15'}
        timeZone={DEFAULT_CLUB_TIME_ZONE}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        onOpenStation={onOpenStation}
      />,
    );
    expect(screen.getByText(t('testDay.title', { category: 'M15' }))).toBeDefined();
    expect(
      screen.getByText(t('fieldTest.day.savedAt', { date: '14/04/2026 09:00' })),
    ).toBeDefined();
    expect(screen.getByText(t('fieldTest.day.refreshFailed'))).toBeDefined();
    expect(screen.getByText(t('testDay.station.progress', { done: 1, total: 3 }))).toBeDefined();
    fireEvent.click(
      screen.getByRole('button', {
        name: t('fieldTest.station.open', { station: t('test.sprint_40') }),
      }),
    );
    expect(onOpenStation).toHaveBeenCalledWith('sprint_40');
  });

  it('says when the day was never downloaded and there is no signal', () => {
    renderScreen(
      <TestDayScreen
        state={{ status: 'unavailable', message: t('fieldTest.day.unavailableOffline') }}
        categoryName={() => 'M15'}
        timeZone={DEFAULT_CLUB_TIME_ZONE}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        onOpenStation={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(t('fieldTest.day.unavailableOffline'));
  });
});

describe('StationScreen', () => {
  it('shows the protocol, the previous result and the best attempt with text', () => {
    station(sheetFixture());
    expect(screen.getByText(t('testDay.protocol.show', { version: 1 }))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('fieldTest.protocol.show') }));
    expect(screen.getByText('Entrada en calor estandarizada antes del test.')).toBeDefined();
    fireEvent.click(
      screen.getByRole('button', { name: t('fieldTest.player.open', { player: 'Juan Álvarez' }) }),
    );
    expect(screen.getByText(/Anterior: 40 m: 5,60/)).toBeDefined();
    // The previous one was manual and this result is by photocell: not comparable directly.
    expect(
      screen.getByText(t('testDay.previous.otherMethod', { method: t('method.manual') })),
    ).toBeDefined();
    expect(screen.getByText(t('testDay.best.marker'))).toBeDefined();
    expect(screen.getByText(t('fieldTest.sync.saved'))).toBeDefined();
  });

  it('adds an attempt, asking to confirm a value out of range first', async () => {
    const { onSubmit } = station(sheetFixture());
    fireEvent.click(
      screen.getByRole('button', { name: t('fieldTest.player.open', { player: 'Juan Álvarez' }) }),
    );
    fireEvent.change(screen.getByLabelText(t('testDay.field.split20S')), {
      target: { value: '1,0' },
    });
    fireEvent.change(screen.getByLabelText(t('testDay.field.split40S')), {
      target: { value: '1,9' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: t('fieldTest.attempt.save', { number: 2 }) }),
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: t('fieldTest.attempt.saveAnyway') })).toBeDefined();
    });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t('fieldTest.attempt.saveAnyway') }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    const [write] = must(onSubmit.mock.calls[0])[0];
    expect(write?.op).toBe('test_result.add_entries');
    expect(screen.getByText(t('fieldTest.attempt.saved', { number: 2 }))).toBeDefined();
  });

  it('stops a typing problem with its reason and records a player as not done', async () => {
    const { onSubmit } = station(sheetFixture(), []);
    fireEvent.click(
      screen.getByRole('button', { name: t('fieldTest.player.open', { player: 'Juan Benítez' }) }),
    );
    fireEvent.change(screen.getByLabelText(t('testDay.field.split20S')), {
      target: { value: 'abc' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: t('fieldTest.attempt.save', { number: 1 }) }),
    );
    await waitFor(() => {
      expect(screen.getByText(t('testDay.problem.number'))).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: t('fieldTest.notDone.open') }));
    fireEvent.click(screen.getByRole('radio', { name: t('testDay.reason.unavailable') }));
    fireEvent.click(screen.getByRole('button', { name: t('fieldTest.notDone.save') }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(must(onSubmit.mock.calls[0])[0][0]?.input).toMatchObject({
      body: { results: [{ status: 'not_done', notDoneReason: 'injured' }] },
    });
  });

  it('records the players out of their stage once, even with a double tap', async () => {
    const base = sheetFixture();
    const sheet = {
      ...base,
      players: base.players.map((p) =>
        p.id === BRUNO_ID
          ? {
              ...p,
              tests: p.tests.map((test) => ({
                ...test,
                applicable: false,
                reason: 'not_in_battery' as const,
              })),
            }
          : p,
      ),
    };
    const { onSubmit } = station(sheet);
    const button = screen.getByRole('button', {
      name: t('fieldTest.notApplicable.all', { count: 1 }),
    });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByText(t('fieldTest.notApplicable.saved', { count: 1 }))).toBeDefined();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows a player without consent but offers nothing to load', () => {
    station(sheetFixture());
    fireEvent.click(
      screen.getByRole('button', { name: t('fieldTest.player.open', { player: 'Juan Díaz' }) }),
    );
    expect(screen.getByText(t('testDay.row.missingConsent'))).toBeDefined();
    expect(
      screen.queryByRole('button', { name: t('fieldTest.attempt.save', { number: 1 }) }),
    ).toBeNull();
  });
});

function iftStation(
  stages: readonly { playerId: string; lastCompletedStage: number }[],
  onSubmit = vi.fn<(writes: readonly FieldWrite[]) => Promise<void>>(() => Promise.resolve()),
) {
  const sheet = sheetFixture({ stations: [IFT] });
  const results = fieldResults({ sheet, synced: [], queue: [], viewer: 'sc' });
  const rows = sheet.players.map((p) => playerStation(IFT, p, results));
  const settings = defaultStationSettings(IFT);
  const onMarkSaved = vi.fn<(playerIds: readonly string[]) => void>();
  const onDiscard = vi.fn(() => Promise.resolve());
  renderScreen(
    <StationScreen
      sheet={sheet}
      station={IFT}
      rows={rows}
      settings={settings}
      viewer="sc"
      writeContext={() => ({
        sheet,
        station: IFT,
        settings,
        evaluatorId: USER.id,
        uuid: randomUUID,
        nowIso: '2026-04-14T13:00:00.000Z',
      })}
      onSubmit={onSubmit}
      onChangeSettings={vi.fn()}
      onBack={vi.fn()}
      ift={{
        run: { status: 'finished', stages, savedCount: 0 },
        onOpenRunner: vi.fn(),
        onMarkSaved,
        onDiscard,
      }}
    />,
  );
  return { onSubmit, onMarkSaved, onDiscard };
}

describe('the 30-15 station', () => {
  it('saves the stages the signals left on the phone and then forgets the run', async () => {
    const { onSubmit, onMarkSaved, onDiscard } = iftStation([
      { playerId: ANA_ID, lastCompletedStage: 20 },
      { playerId: BRUNO_ID, lastCompletedStage: 17 },
    ]);
    expect(screen.getByText(t('fieldTest.ift.pending', { count: 2 }))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('fieldTest.ift.save') }));
    await waitFor(() => {
      expect(onDiscard).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onMarkSaved).toHaveBeenCalledWith([ANA_ID, BRUNO_ID]);
    expect(screen.getByText(t('fieldTest.ift.saved', { count: 2 }))).toBeDefined();
  });

  it('keeps the run and lists the players it cannot save until the staff dismisses it', async () => {
    const { onSubmit, onMarkSaved, onDiscard } = iftStation([
      { playerId: ANA_ID, lastCompletedStage: 20 },
      { playerId: DIEGO_ID, lastCompletedStage: 18 },
    ]);
    // Diego has no consent: his stage is shown for the staff to load by hand.
    expect(screen.getByText(t('fieldTest.ift.skippedList', { count: 1 }))).toBeDefined();
    expect(
      screen.getByText(t('fieldTest.ift.skippedPlayer', { player: 'Juan Díaz', stage: 18 })),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: t('fieldTest.ift.discard') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('fieldTest.ift.save') }));
    await waitFor(() => {
      expect(onMarkSaved).toHaveBeenCalledWith([ANA_ID]);
    });
    expect(must(onSubmit.mock.calls[0])[0][0]?.input).toMatchObject({
      body: { results: [{ playerId: ANA_ID, entries: [{ lastCompletedStage: 20 }] }] },
    });
    expect(onDiscard).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        `${t('fieldTest.ift.saved', { count: 1 })} ${t('fieldTest.ift.skipped', { count: 1 })}`,
      ),
    ).toBeDefined();
  });

  it('offers only to dismiss the run when nothing left can be saved here', async () => {
    const { onSubmit, onDiscard } = iftStation([{ playerId: DIEGO_ID, lastCompletedStage: 18 }]);
    expect(screen.queryByRole('button', { name: t('fieldTest.ift.save') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('fieldTest.ift.discard') }));
    await waitFor(() => {
      expect(onDiscard).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the run when the stages could not be queued', async () => {
    const { onMarkSaved, onDiscard } = iftStation(
      [{ playerId: ANA_ID, lastCompletedStage: 20 }],
      vi.fn<(writes: readonly FieldWrite[]) => Promise<void>>(() =>
        Promise.reject(new Error('disk full')),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: t('fieldTest.ift.save') }));
    await waitFor(() => {
      expect(screen.getByText(t('fieldTest.ift.saveFailed'))).toBeDefined();
    });
    expect(onMarkSaved).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
