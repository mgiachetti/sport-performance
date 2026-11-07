// @vitest-environment jsdom
import {
  DEFAULT_IFT_3015_SIGNAL_PROTOCOL,
  ift3015MomentAt,
  ift3015PlayerResult,
  ift3015Schedule,
  ift3015StageStartMs,
  newIft3015PlayerMarks,
  recordIft3015Miss,
  stopIft3015Player,
} from '@sport-performance/domain';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resultRows, runRows } from '../ift/roster.ts';
import { COACH_AT_ORC } from '../test/fixtures.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { HomeScreen } from './app.tsx';
import {
  IftInterruptedScreen,
  IftResultsScreen,
  IftRunScreen,
  IftSetupScreen,
} from './ift-3015.tsx';

const { t } = translator;
const P = DEFAULT_IFT_3015_SIGNAL_PROTOCOL;
const SCHEDULE = ift3015Schedule(P);
const ROSTER = [
  { id: 'a', name: 'Juan Pérez' },
  { id: 'b', name: 'Tomás Gómez' },
];
const NAMES = new Map(ROSTER.map((p) => [p.id, p.name]));

describe('HomeScreen field tools', () => {
  it('opens the 30-15 IFT only when the route allows it', () => {
    const onOpen = vi.fn();
    const props = { userName: 'Ana', membership: COACH_AT_ORC, clubTheme: null, offline: false };
    const { unmount } = renderScreen(<HomeScreen {...props} onOpenIft3015={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: t('home.tile.ift') }));
    expect(onOpen).toHaveBeenCalled();
    unmount();
    renderScreen(<HomeScreen {...props} />);
    expect(screen.queryByRole('button', { name: t('home.tile.ift') })).toBeNull();
  });
});

describe('IftSetupScreen', () => {
  const base = {
    protocol: P,
    categories: {
      status: 'ready',
      data: [
        { id: 'm15', name: 'M15' },
        { id: 'm17', name: 'M17' },
      ],
    } as const,
    categoryId: 'm15',
    onSelectCategory: vi.fn(),
    players: { status: 'ready', data: ROSTER } as const,
    selected: new Set(['a']),
    onToggle: vi.fn(),
    onSelectAll: vi.fn(),
    onSelectNone: vi.fn(),
    onStart: vi.fn(),
    preparing: false,
    audioError: false,
    offline: true,
  };

  it('explains the protocol in es-AR and lets the staff pick the category and players', () => {
    const onSelectCategory = vi.fn();
    const onToggle = vi.fn();
    const onStart = vi.fn();
    renderScreen(
      <IftSetupScreen
        {...base}
        onSelectCategory={onSelectCategory}
        onToggle={onToggle}
        onStart={onStart}
      />,
    );
    expect(screen.getByText(/Arranca a 8,0 km\/h y suma 0,5 km\/h por etapa/)).toBeDefined();
    expect(screen.getByText(/3 faltas seguidas terminan el test/)).toBeDefined();
    // Works offline: the warning says so, the start is still there.
    expect(screen.getByRole('alert').textContent).toContain(t('sync.offline'));
    fireEvent.click(screen.getByRole('radio', { name: 'M17' }));
    expect(onSelectCategory).toHaveBeenCalledWith('m17');
    expect(screen.getByRole('checkbox', { name: 'Juan Pérez' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tomás Gómez' }));
    expect(onToggle).toHaveBeenCalledWith('b');
    expect(screen.getByText(t('ift.setup.players', { selected: 1, total: 2 }))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('ift.setup.start') }));
    expect(onStart).toHaveBeenCalled();
  });

  it('does not start without players, and reports an audio failure', () => {
    const onStart = vi.fn();
    renderScreen(
      <IftSetupScreen
        {...base}
        offline={false}
        selected={new Set()}
        audioError
        onStart={onStart}
      />,
    );
    const start = screen.getByRole('button', { name: t('ift.setup.start') });
    expect(start.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(start);
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(t('ift.setup.audioError'));
  });

  it('says when there is nothing to choose', () => {
    renderScreen(
      <IftSetupScreen
        {...base}
        offline={false}
        categories={{ status: 'ready', data: [] }}
        players={null}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(t('ift.setup.noCategories'));
  });
});

describe('IftRunScreen', () => {
  it('shows the stage board and marks each player by name', () => {
    const atMs = ift3015StageStartMs(3, P) + 10_000;
    let a = newIft3015PlayerMarks('a');
    const lastLine = SCHEDULE.filter((c) => c.lineIndex !== null && c.atMs <= atMs).at(-1);
    a = recordIft3015Miss(a, SCHEDULE, P, lastLine?.atMs ?? 0);
    const b = stopIft3015Player(newIft3015PlayerMarks('b'), P, ift3015StageStartMs(2, P) + 1_000);
    const onMiss = vi.fn();
    const onStop = vi.fn();
    const onUndo = vi.fn();
    const onFinish = vi.fn();
    renderScreen(
      <IftRunScreen
        moment={ift3015MomentAt(P, atMs)}
        protocol={P}
        rows={runRows([a, b], SCHEDULE, atMs, NAMES, translator)}
        skippedCues={2}
        allOut={false}
        onMiss={onMiss}
        onStop={onStop}
        onUndo={onUndo}
        onFinish={onFinish}
      />,
    );
    const board = screen.getByLabelText(
      t('ift.run.status', {
        phase: t('ift.phase.run'),
        stage: 3,
        speed: '9,0 km/h',
        seconds: 20,
      }),
    );
    expect(board.textContent).toContain('20 s');
    expect(screen.getByText(t('ift.run.misses', { count: 1, max: 3 }))).toBeDefined();
    expect(screen.getByText(t('ift.run.out', { stage: 1 }))).toBeDefined();
    expect(screen.getByRole('alert').textContent).toContain(t('ift.run.skipped', { count: 2 }));

    fireEvent.click(
      screen.getByRole('button', { name: t('ift.run.miss.a11y', { name: 'Juan Pérez' }) }),
    );
    expect(onMiss).toHaveBeenCalledWith('a');
    fireEvent.click(
      screen.getByRole('button', { name: t('ift.run.stop.a11y', { name: 'Juan Pérez' }) }),
    );
    expect(onStop).toHaveBeenCalledWith('a');
    // Out: no more marks, only undo.
    expect(
      screen.queryByRole('button', { name: t('ift.run.stop.a11y', { name: 'Tomás Gómez' }) }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: t('ift.run.undo.a11y', { name: 'Tomás Gómez' }) }),
    );
    expect(onUndo).toHaveBeenCalledWith('b');

    // Ending the test asks first.
    fireEvent.click(screen.getByRole('button', { name: t('ift.run.finish') }));
    expect(onFinish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t('ift.run.keepGoing') }));
    fireEvent.click(screen.getByRole('button', { name: t('ift.run.finish') }));
    fireEvent.click(screen.getByRole('button', { name: t('ift.run.finishYes') }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('never shows a name it does not have', () => {
    const atMs = 5_000;
    renderScreen(
      <IftRunScreen
        moment={ift3015MomentAt(P, atMs)}
        protocol={P}
        rows={runRows([newIft3015PlayerMarks('zz')], SCHEDULE, atMs, new Map(), translator)}
        skippedCues={0}
        allOut={false}
        onMiss={vi.fn()}
        onStop={vi.fn()}
        onUndo={vi.fn()}
        onFinish={vi.fn()}
      />,
    );
    expect(screen.getByText(t('ift.player.unknown', { number: 1 }))).toBeDefined();
  });

  it('keeps the test open when everybody is out, so a wrong last mark can be undone', () => {
    const atMs = ift3015StageStartMs(2, P) + 5_000;
    const a = stopIft3015Player(newIft3015PlayerMarks('a'), P, atMs);
    const onUndo = vi.fn();
    const onFinish = vi.fn();
    renderScreen(
      <IftRunScreen
        moment={ift3015MomentAt(P, atMs)}
        protocol={P}
        rows={runRows([a], SCHEDULE, atMs, NAMES, translator)}
        skippedCues={0}
        allOut
        onMiss={vi.fn()}
        onStop={vi.fn()}
        onUndo={onUndo}
        onFinish={onFinish}
      />,
    );
    expect(screen.getByText(t('ift.run.allOut'))).toBeDefined();
    fireEvent.click(
      screen.getByRole('button', { name: t('ift.run.undo.a11y', { name: 'Juan Pérez' }) }),
    );
    expect(onUndo).toHaveBeenCalledWith('a');
    // Nobody left running: ending needs no confirmation.
    fireEvent.click(screen.getByRole('button', { name: t('ift.run.finish') }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});

describe('IftInterruptedScreen', () => {
  it('offers to resume or end the run', () => {
    const onResume = vi.fn();
    const onFinish = vi.fn();
    renderScreen(
      <IftInterruptedScreen
        moment={ift3015MomentAt(P, ift3015StageStartMs(4, P) + 35_000)}
        resumable
        resuming={false}
        audioError={false}
        onResume={onResume}
        onFinish={onFinish}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      t('ift.interrupted.body', { stage: 4, phase: t('ift.phase.recovery') }),
    );
    fireEvent.click(screen.getByRole('button', { name: t('ift.interrupted.resume') }));
    fireEvent.click(screen.getByRole('button', { name: t('ift.interrupted.finish') }));
    expect(onResume).toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalled();
    expect(screen.getByText(t('ift.interrupted.resumable'))).toBeDefined();
  });

  it('only offers to end a run interrupted for too long', () => {
    renderScreen(
      <IftInterruptedScreen
        moment={ift3015MomentAt(P, ift3015StageStartMs(4, P) + 5_000)}
        resumable={false}
        resuming={false}
        audioError={false}
        onResume={vi.fn()}
        onFinish={vi.fn()}
      />,
    );
    expect(screen.getByText(t('ift.interrupted.tooLate'))).toBeDefined();
    expect(screen.queryByRole('button', { name: t('ift.interrupted.resume') })).toBeNull();
    expect(screen.getByRole('button', { name: t('ift.interrupted.finish') })).toBeDefined();
  });
});

describe('IftResultsScreen', () => {
  it('shows stage and VIFT in es-AR, lets the staff correct and asks before deleting', () => {
    const a = stopIft3015Player(newIft3015PlayerMarks('a'), P, ift3015StageStartMs(19, P) + 1_000);
    const b = stopIft3015Player(newIft3015PlayerMarks('b'), P, 3_000);
    expect(ift3015PlayerResult(a, P)?.viftKmh).toBe(16.5);
    const onAdjust = vi.fn();
    const onDiscard = vi.fn();
    renderScreen(
      <IftResultsScreen
        protocol={P}
        rows={resultRows(
          { players: [a, b], protocol: P, endedAtMs: null, endedBy: 'staff' },
          NAMES,
          translator,
        )}
        interrupted={false}
        onAdjust={onAdjust}
        onDiscard={onDiscard}
      />,
    );
    expect(screen.getByText(t('ift.results.stage', { stage: 18 }))).toBeDefined();
    expect(screen.getByText('VIFT 16,5 km/h')).toBeDefined();
    expect(screen.getByText(t('ift.results.noStage'))).toBeDefined();
    fireEvent.click(
      screen.getByRole('button', { name: t('ift.results.stageUp', { name: 'Juan Pérez' }) }),
    );
    expect(onAdjust).toHaveBeenCalledWith('a', 19);
    // Stage 0 cannot go lower.
    expect(
      screen
        .getByRole('button', { name: t('ift.results.stageDown', { name: 'Tomás Gómez' }) })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: t('ift.results.discard') }));
    expect(onDiscard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t('ift.results.discardYes') }));
    expect(onDiscard).toHaveBeenCalled();
    expect(screen.queryByText(t('ift.results.interrupted'))).toBeNull();
  });

  it('flags a run ended after the app was killed and the players cut short', () => {
    const endedAtMs = ift3015StageStartMs(5, P) + 1_000;
    const a = stopIft3015Player(newIft3015PlayerMarks('a'), P, ift3015StageStartMs(2, P));
    const b = stopIft3015Player(newIft3015PlayerMarks('b'), P, endedAtMs);
    renderScreen(
      <IftResultsScreen
        protocol={P}
        rows={resultRows(
          { players: [a, b], protocol: P, endedAtMs, endedBy: 'interrupted' },
          NAMES,
          translator,
        )}
        interrupted
        onAdjust={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(t('ift.results.interrupted'));
    expect(screen.getAllByText(t('ift.results.cutShort'))).toHaveLength(1);
  });
});
