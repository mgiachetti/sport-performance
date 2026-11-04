// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { programDto } from '../test/gym-fixtures.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { GymScreen, type GymData } from './gym.tsx';

const { t } = translator;

const data = (overrides: Partial<GymData> = {}): GymData => ({
  programs: [programDto()],
  sets: [],
  best: [],
  ...overrides,
});

function render(props: Partial<Parameters<typeof GymScreen>[0]> = {}) {
  const onLog = vi.fn(() => Promise.resolve('logged' as const));
  renderScreen(
    <GymScreen
      moduleOn
      allowed
      state={{ status: 'ready', data: data() }}
      offline={false}
      programId={null}
      dayKey={null}
      onPickProgram={vi.fn()}
      onPickDay={vi.fn()}
      onLog={onLog}
      {...props}
    />,
  );
  return { onLog };
}

describe('GymScreen', () => {
  it('says the club turned the module off and shows no program', () => {
    const { onLog } = render({ moduleOn: false });
    expect(screen.getByText(t('gym.mobile.moduleOff'))).toBeDefined();
    expect(screen.queryByText('Fuerza M15')).toBeNull();
    expect(screen.queryByRole('button', { name: t('gym.mobile.log', { number: 1 }) })).toBeNull();
    expect(onLog).not.toHaveBeenCalled();
  });

  it('shows the day of the program with what is prescribed', () => {
    render();
    expect(screen.getByText('Fuerza M15')).toBeDefined();
    expect(screen.getByText('Inferior')).toBeDefined();
    expect(screen.getByText('Peso muerto con barra hexagonal')).toBeDefined();
    expect(
      screen.getByText(/Indicado: 3 × 3–5 rep\. · RIR 2 · 62,5\skg sugeridos · Pausa/),
    ).toBeDefined();
  });

  it('logs a set with the prefilled prescription', async () => {
    const { onLog } = render();
    fireEvent.click(screen.getByRole('button', { name: t('gym.mobile.log', { number: 1 }) }));
    await waitFor(() => {
      expect(onLog).toHaveBeenCalledTimes(1);
    });
    expect(onLog.mock.calls[0]).toEqual([
      expect.objectContaining({ name: 'Fuerza M15' }),
      'a',
      'trap_bar_deadlift',
      1,
      { reps: 5, loadKg: 62.5, rir: 2, durationS: null },
    ]);
    expect(await screen.findByText(t('gym.mobile.logged'))).toBeDefined();
  });

  it('warns about a set to failure and explains a field it cannot read', () => {
    const { onLog } = render();
    fireEvent.change(screen.getByLabelText(t('gym.mobile.field.rir')), { target: { value: '0' } });
    expect(screen.getByText(t('gym.mobile.toFailure'))).toBeDefined();
    fireEvent.change(screen.getByLabelText(t('gym.mobile.field.loadKg')), {
      target: { value: '62.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('gym.mobile.log', { number: 1 }) }));
    expect(screen.getByText(t('gym.mobile.error.number'))).toBeDefined();
    expect(onLog).not.toHaveBeenCalled();
  });

  it('marks the sets still in the queue and shows the best e1RM', () => {
    render({
      state: {
        status: 'ready',
        data: data({
          sets: [
            {
              key: 'k',
              exerciseCode: 'trap_bar_deadlift',
              setNumber: 1,
              reps: 5,
              loadKg: 60,
              rir: 2,
              durationS: null,
              techniqueScore: null,
              e1rmKg: null,
              warnings: [],
              pending: true,
            },
          ],
          best: [
            {
              exerciseCode: 'trap_bar_deadlift',
              setsN: 3,
              lastPerformedOn: '2026-11-03' as never,
              bestE1rmKg: 74,
              bestOn: '2026-10-20' as never,
              series: [],
            },
          ],
        }),
      },
    });
    expect(screen.getByText(t('gym.mobile.set.pending'))).toBeDefined();
    expect(screen.getByRole('button', { name: t('gym.mobile.log', { number: 2 }) })).toBeDefined();
    expect(
      screen.getByText(/Peso muerto con barra hexagonal: 74,0\skg \(20\/10\/2026\)/),
    ).toBeDefined();
  });

  it('says when there is no program and when the role does not log from the phone', () => {
    render({ state: { status: 'ready', data: data({ programs: [] }) } });
    expect(screen.getByText(t('gym.mobile.noProgram'))).toBeDefined();
  });

  it('sends the staff to the web', () => {
    render({ allowed: false });
    expect(screen.getByText(t('gym.mobile.staffOnWeb'))).toBeDefined();
  });
});
