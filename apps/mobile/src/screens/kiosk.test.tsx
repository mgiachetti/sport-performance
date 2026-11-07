// @vitest-environment jsdom
import { parseTimeZone } from '@sport-performance/domain';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KioskPlayer } from '../kiosk/roster.ts';
import { COACH_AT_ORC } from '../test/fixtures.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { HomeScreen } from './app.tsx';
import {
  KIOSK_DONE_MS,
  KIOSK_IDLE_MS,
  KioskExitScreen,
  KioskPickScreen,
  KioskSetupScreen,
  KioskTurn,
} from './kiosk.tsx';

const { t } = translator;
const TZ = parseTimeZone('America/Argentina/Buenos_Aires');

afterEach(() => {
  vi.useRealTimers();
});

function player(overrides: Partial<KioskPlayer> = {}): KioskPlayer {
  return {
    id: 'p1',
    firstName: 'Juan',
    lastName: 'Pérez',
    displayName: 'Juan P.',
    categoryIds: ['m13'],
    canReport: true,
    wellness: { itemCount: 3, items: ['sleep', 'fatigue', 'soreness'] },
    wellnessDone: false,
    rpe: [],
    ...overrides,
  };
}

/** Lets the queued promise of a step settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('HomeScreen', () => {
  it('opens the kiosk only when the route allows it', () => {
    const onOpenKiosk = vi.fn();
    const props = { userName: 'Ana', membership: COACH_AT_ORC, clubTheme: null, offline: false };
    const { unmount } = renderScreen(<HomeScreen {...props} onOpenKiosk={onOpenKiosk} />);
    fireEvent.click(screen.getByRole('button', { name: t('home.tile.kiosk') }));
    expect(onOpenKiosk).toHaveBeenCalled();
    unmount();
    renderScreen(<HomeScreen {...props} />);
    expect(screen.queryByRole('button', { name: t('home.tile.kiosk') })).toBeNull();
  });
});

describe('KioskSetupScreen', () => {
  const categories = {
    status: 'ready',
    data: [
      { id: 'm13', name: 'M13' },
      { id: 'm14', name: 'M14' },
    ],
  } as const;

  function fill(label: string, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }

  it('asks for a category and a PIN that is not trivial and matches', () => {
    const onStart = vi.fn();
    renderScreen(
      <KioskSetupScreen
        categories={categories}
        starting={false}
        error={null}
        onStart={onStart}
        onCancel={vi.fn()}
      />,
    );
    const start = screen.getByRole('button', { name: t('kiosk.setup.start') });
    fireEvent.click(start);
    expect(screen.getByText(t('kiosk.setup.pickCategory'))).toBeDefined();

    fireEvent.click(screen.getByRole('checkbox', { name: 'M13' }));
    expect(screen.getByRole('checkbox', { name: 'M13' }).getAttribute('aria-checked')).toBe('true');
    fill(t('kiosk.setup.pin'), '1234');
    fill(t('kiosk.setup.pinConfirm'), '1234');
    fireEvent.click(start);
    expect(screen.getByText(t('kiosk.setup.pin.weak'))).toBeDefined();

    fill(t('kiosk.setup.pin'), '2580');
    fill(t('kiosk.setup.pinConfirm'), '2581');
    fireEvent.click(start);
    expect(screen.getByText(t('kiosk.setup.pin.mismatch'))).toBeDefined();

    fill(t('kiosk.setup.pinConfirm'), '2580');
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledWith(['m13'], '2580');
    // How to pin the app in the system is always said.
    expect(screen.getByText(t('kiosk.setup.pinning'))).toBeDefined();
  });

  it('says when the staff has no category and when the rosters did not come', () => {
    renderScreen(
      <KioskSetupScreen
        categories={{ status: 'ready', data: [] }}
        starting={false}
        error={t('kiosk.setup.needsConnection')}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(t('kiosk.setup.noCategories'))).toBeDefined();
    expect(screen.getByText(t('kiosk.setup.needsConnection'))).toBeDefined();
  });
});

describe('KioskPickScreen', () => {
  const players = [
    player({ id: 'p1', firstName: 'Ana', lastName: 'Acosta', displayName: 'Ana A.' }),
    player({
      id: 'p2',
      firstName: 'Tomás',
      lastName: 'Gómez',
      displayName: 'Tomás G.',
      wellness: null,
      wellnessDone: true,
    }),
  ];

  it('shows names only, finds by name and picks', () => {
    const onPick = vi.fn();
    const onExit = vi.fn();
    renderScreen(
      <KioskPickScreen
        title="Kiosco · M13"
        players={{ status: 'ready', data: players }}
        keptAt={null}
        timeZone={TZ}
        onPick={onPick}
        onExit={onExit}
      />,
    );
    expect(screen.getByRole('button', { name: 'Ana A.' })).toBeDefined();
    // Nothing says who already loaded.
    expect(screen.queryByText(/cargó|cargaste/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(t('kiosk.search')), { target: { value: 'tomas' } });
    expect(screen.queryByRole('button', { name: 'Ana A.' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tomás G.' }));
    expect(onPick).toHaveBeenCalledWith('p2');
    fireEvent.change(screen.getByLabelText(t('kiosk.search')), { target: { value: 'zz' } });
    expect(screen.getByText(t('kiosk.noMatch'))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('kiosk.exit') }));
    expect(onExit).toHaveBeenCalled();
  });

  it('says when the roster shown is the one kept without signal', () => {
    renderScreen(
      <KioskPickScreen
        title="Kiosco · M13"
        players={{ status: 'ready', data: players }}
        keptAt={Date.UTC(2026, 10, 3, 12, 30)}
        timeZone={TZ}
        onPick={vi.fn()}
        onExit={vi.fn()}
      />,
    );
    expect(screen.getByText(t('kiosk.kept', { date: '03/11/2026', time: '09:30' }))).toBeDefined();
  });
});

describe('KioskTurn', () => {
  const session = {
    sessionId: 's1',
    title: null,
    kind: 'training' as const,
    startsAt: '2026-11-03T21:00:00.000Z',
  };

  it('confirms the name, asks the faces of M13/M14 and the RPE, thanks and goes back', async () => {
    vi.useFakeTimers();
    const onSubmitWellness = vi.fn(() => Promise.resolve());
    const onSubmitRpe = vi.fn(() => Promise.resolve());
    const onFinish = vi.fn();
    renderScreen(
      <KioskTurn
        player={player({ rpe: [session] })}
        timeZone={TZ}
        actions={{ onSubmitWellness, onSubmitRpe, onFinish }}
      />,
    );
    expect(screen.getByText(t('kiosk.turn.confirm', { name: 'Juan P.' }))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('kiosk.turn.yes') }));

    expect(screen.getByText(t('kiosk.turn.step', { step: 1, total: 2 }))).toBeDefined();
    const sleep = t('wellness.item.sleep');
    fireEvent.click(
      screen.getByRole('radio', { name: t('kiosk.choice.face', { item: sleep, label: 'Bien' }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: t('kiosk.turn.next') }));
    expect(screen.getByRole('alert').textContent).toContain(
      t('kiosk.turn.missing', {
        items: `${t('wellness.item.fatigue')}, ${t('wellness.item.soreness')}`,
      }),
    );
    for (const item of ['fatigue', 'soreness'] as const) {
      fireEvent.click(
        screen.getByRole('radio', {
          name: t('kiosk.choice.face', { item: t(`wellness.item.${item}`), label: 'Normal' }),
        }),
      );
    }
    fireEvent.click(screen.getByRole('button', { name: t('kiosk.turn.next') }));
    await settle();
    expect(onSubmitWellness).toHaveBeenCalledWith({ sleep: 4, fatigue: 3, soreness: 3 });

    expect(
      screen.getByText(t('kiosk.turn.sessionUntitled.training', { time: '18:00' })),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('kiosk.turn.send') }));
    expect(screen.getByRole('alert').textContent).toContain(t('kiosk.turn.pickRpe'));
    fireEvent.click(
      screen.getByRole('radio', {
        name: t('kiosk.choice.rpeLabelled', { value: 7, label: t('rpe.scale.7') }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: t('kiosk.turn.send') }));
    await settle();
    expect(onSubmitRpe).toHaveBeenCalledWith('s1', 7);

    expect(screen.getByText(t('kiosk.turn.done', { name: 'Juan' }))).toBeDefined();
    expect(onFinish).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(KIOSK_DONE_MS);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('asks the five items from 1 to 5 from M15 on', () => {
    renderScreen(
      <KioskTurn
        player={player({
          wellness: { itemCount: 5, items: ['sleep', 'fatigue', 'soreness', 'stress', 'mood'] },
        })}
        timeZone={TZ}
        actions={{ onSubmitWellness: vi.fn(), onSubmitRpe: vi.fn(), onFinish: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('kiosk.turn.yes') }));
    expect(screen.getAllByRole('radiogroup')).toHaveLength(5);
    expect(
      screen.getByRole('radio', {
        name: t('kiosk.choice.score', { item: t('wellness.item.mood'), score: 5 }),
      }),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: t('kiosk.turn.send') })).toBeDefined();
  });

  it('only says "ya cargaste" when nothing is left, and never a value', () => {
    renderScreen(
      <KioskTurn
        player={player({ wellness: null, wellnessDone: true })}
        timeZone={TZ}
        actions={{ onSubmitWellness: vi.fn(), onSubmitRpe: vi.fn(), onFinish: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('kiosk.turn.yes') }));
    expect(screen.getByText(t('kiosk.turn.nothingLeft'))).toBeDefined();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('says a player without permission to load asks the staff, without the reason', () => {
    renderScreen(
      <KioskTurn
        player={player({ canReport: false })}
        timeZone={TZ}
        actions={{ onSubmitWellness: vi.fn(), onSubmitRpe: vi.fn(), onFinish: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('kiosk.turn.yes') }));
    expect(screen.getByText(t('kiosk.turn.unavailable'))).toBeDefined();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('goes back on "No soy yo" and after a minute alone, dropping the answers', () => {
    vi.useFakeTimers();
    const onFinish = vi.fn();
    const onSubmitWellness = vi.fn();
    renderScreen(
      <KioskTurn
        player={player()}
        timeZone={TZ}
        actions={{ onSubmitWellness, onSubmitRpe: vi.fn(), onFinish }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('kiosk.turn.notMe') }));
    expect(onFinish).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: t('kiosk.turn.yes') }));
    fireEvent.click(
      screen.getByRole('radio', {
        name: t('kiosk.choice.face', { item: t('wellness.item.sleep'), label: 'Bien' }),
      }),
    );
    act(() => {
      vi.advanceTimersByTime(KIOSK_IDLE_MS - 1);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onFinish).toHaveBeenCalledTimes(2);
    expect(onSubmitWellness).not.toHaveBeenCalled();
  });

  it('says when the device could not save, and stays on the step', async () => {
    const onSubmitWellness = vi.fn(() => Promise.reject(new Error('disk')));
    renderScreen(
      <KioskTurn
        player={player()}
        timeZone={TZ}
        actions={{ onSubmitWellness, onSubmitRpe: vi.fn(), onFinish: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('kiosk.turn.yes') }));
    for (const item of ['sleep', 'fatigue', 'soreness'] as const) {
      fireEvent.click(
        screen.getByRole('radio', {
          name: t('kiosk.choice.face', { item: t(`wellness.item.${item}`), label: 'Bien' }),
        }),
      );
    }
    fireEvent.click(screen.getByRole('button', { name: t('kiosk.turn.send') }));
    await settle();
    await settle();
    expect(screen.getByRole('alert').textContent).toContain(t('kiosk.turn.saveError'));
  });
});

describe('KioskExitScreen', () => {
  it('tells a wrong PIN, the wait after too many, and leaves with the right one', async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'wrong', lockedUntilMs: null })
      .mockResolvedValueOnce({
        ok: false,
        reason: 'wrong',
        lockedUntilMs: Date.UTC(2026, 10, 3, 12, 30, 30),
      })
      .mockResolvedValueOnce({ ok: true });
    renderScreen(<KioskExitScreen timeZone={TZ} onSubmit={onSubmit} onCancel={vi.fn()} />);
    const field = screen.getByLabelText(t('kiosk.exit.pin'));
    const confirm = screen.getByRole('button', { name: t('kiosk.exit.confirm') });

    fireEvent.change(field, { target: { value: '1111' } });
    fireEvent.click(confirm);
    await settle();
    expect(screen.getByText(t('kiosk.exit.wrong'))).toBeDefined();

    fireEvent.change(field, { target: { value: '2222' } });
    fireEvent.click(confirm);
    await settle();
    expect(screen.getByText(t('kiosk.exit.locked', { time: '09:30' }))).toBeDefined();

    fireEvent.change(field, { target: { value: '2580' } });
    fireEvent.click(confirm);
    await settle();
    expect(onSubmit).toHaveBeenLastCalledWith('2580');
    expect(screen.getByText(t('kiosk.exit.forgot'))).toBeDefined();
  });
});
