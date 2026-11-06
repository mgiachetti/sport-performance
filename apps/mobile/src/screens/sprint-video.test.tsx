// @vitest-environment jsdom
import type { LocalDate } from '@sport-performance/domain';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SprintVideoPlayer } from '../sprint-video/attempt.ts';
import { parseLayoutDraft } from '../sprint-video/layout.ts';
import {
  initialSprintMarking,
  sprintMarkingReducer,
  type SprintMarkingAction,
  type SprintMarkingState,
} from '../sprint-video/marking.ts';
import { membership } from '../test/fixtures.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { HomeScreen } from './app.tsx';
import {
  SprintVideoDaysScreen,
  SprintVideoMarkScreen,
  SprintVideoPlayersScreen,
  SprintVideoRecordScreen,
  SprintVideoSetupScreen,
} from './sprint-video.tsx';

const { t } = translator;
const SC = membership('a4444444-4444-4444-8444-444444444444', 'sc');
const PLAYER: SprintVideoPlayer = {
  id: 'p1',
  name: 'Díaz, Juan',
  sex: 'male',
  recording: 'allowed',
  video: 'allowed',
  applicable: true,
};

function run(state: SprintMarkingState, ...actions: SprintMarkingAction[]): SprintMarkingState {
  return actions.reduce(sprintMarkingReducer, state);
}

describe('HomeScreen: sprint by video', () => {
  it('opens it only when the route allows it', () => {
    const onOpen = vi.fn();
    const props = { userName: 'Ana', membership: SC, clubTheme: null, offline: false };
    const { unmount } = renderScreen(<HomeScreen {...props} onOpenSprintVideo={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: t('sprintVideo.open') }));
    expect(onOpen).toHaveBeenCalled();
    unmount();
    renderScreen(<HomeScreen {...props} />);
    expect(screen.queryByRole('button', { name: t('sprintVideo.open') })).toBeNull();
  });
});

describe('SprintVideoDaysScreen', () => {
  it('lists the days of the phone and says when there are none', () => {
    const onPick = vi.fn();
    const { unmount } = renderScreen(
      <SprintVideoDaysScreen
        days={[{ id: 'd1', scheduledOn: '2026-11-03' as LocalDate, location: 'Cancha 2' }]}
        onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '03/11/2026 · Cancha 2' }));
    expect(onPick).toHaveBeenCalledWith('d1');
    unmount();
    renderScreen(<SprintVideoDaysScreen days={[]} onPick={onPick} />);
    expect(screen.getByText(t('sprintVideo.days.empty'))).toBeTruthy();
  });
});

describe('SprintVideoSetupScreen', () => {
  it('says where each cone goes, in es-AR', () => {
    const draft = { cameraDistance: '30', poleOffset: '1,5' };
    const onContinue = vi.fn();
    renderScreen(
      <SprintVideoSetupScreen
        draft={draft}
        parsed={parseLayoutDraft(draft)}
        mainCameraMinDistanceM={35}
        onChange={vi.fn()}
        onContinue={onContinue}
        onBack={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        'Línea de 0 m: cono 1 m antes de la línea de salida, 1,5 m detrás del carril.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Línea de 10 m: cono en los 9,5 m, 1,5 m detrás del carril.'),
    ).toBeTruthy();
    expect(
      screen.getByText('Línea de 40 m: cono en los 41 m, 1,5 m detrás del carril.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('sprintVideo.setup.continue') }));
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ cameraDistanceM: 30 }));
  });

  it('explains a wrong distance and warns when the camera is too close', () => {
    const wrong = { cameraDistance: '30.5', poleOffset: '1' };
    const onContinue = vi.fn();
    const { unmount } = renderScreen(
      <SprintVideoSetupScreen
        draft={wrong}
        parsed={parseLayoutDraft(wrong)}
        mainCameraMinDistanceM={35}
        onChange={vi.fn()}
        onContinue={onContinue}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(t('sprintVideo.setup.cameraDistance.invalid'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('sprintVideo.setup.continue') }));
    expect(onContinue).not.toHaveBeenCalled();
    unmount();
    const close = { cameraDistance: '10', poleOffset: '1' };
    renderScreen(
      <SprintVideoSetupScreen
        draft={close}
        parsed={parseLayoutDraft(close)}
        mainCameraMinDistanceM={35}
        onChange={vi.fn()}
        onContinue={onContinue}
        onBack={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('alert', { name: new RegExp(t('sprintVideo.setup.oblique')) }),
    ).toBeTruthy();
  });
});

describe('SprintVideoPlayersScreen', () => {
  it('films only players with image consent and says why not', () => {
    const onFilm = vi.fn();
    renderScreen(
      <SprintVideoPlayersScreen
        rows={[
          { player: PLAYER, attempts: 1 },
          {
            player: { ...PLAYER, id: 'p2', name: 'Gómez, Tomás', video: 'missing_consent' },
            attempts: 0,
          },
        ]}
        plannedAttempts={3}
        offline
        notice={null}
        onFilm={onFilm}
        onLayout={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText('1 intento de 3')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: t('sprintVideo.player.filmName', { name: 'Díaz, Juan' }),
      }),
    );
    expect(onFilm).toHaveBeenCalledWith('p1');
    expect(
      screen.queryByRole('button', {
        name: t('sprintVideo.player.filmName', { name: 'Gómez, Tomás' }),
      }),
    ).toBeNull();
    expect(screen.getByText(t('sprintVideo.block.missing_image_consent'))).toBeTruthy();
    expect(screen.getByText(t('sync.offline'))).toBeTruthy();
  });
});

describe('SprintVideoRecordScreen', () => {
  it('records once the camera is ready at a frame rate that is enough', () => {
    const onStart = vi.fn();
    const props = {
      playerName: 'Díaz, Juan',
      recording: false,
      maxDurationS: 20,
      camera: null,
      importState: { status: 'idle' } as const,
      onStart,
      onStop: vi.fn(),
      onImport: vi.fn(),
      onCancel: vi.fn(),
    };
    const { unmount } = renderScreen(
      <SprintVideoRecordScreen {...props} cameraState={{ status: 'unsupported' }} />,
    );
    expect(screen.getByText(t('sprintVideo.record.unsupported'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('sprintVideo.record.start') }));
    expect(onStart).not.toHaveBeenCalled();
    unmount();
    renderScreen(
      <SprintVideoRecordScreen {...props} cameraState={{ status: 'ready', frameRateFps: 240 }} />,
    );
    expect(
      screen.getByText(t('sprintVideo.record.ready', { fps: '240', seconds: 20 })),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('sprintVideo.record.start') }));
    expect(onStart).toHaveBeenCalled();
  });
});

describe('SprintVideoRecordScreen: a video from the gallery (ADR 0102)', () => {
  const props = {
    playerName: 'Díaz, Juan',
    recording: false,
    maxDurationS: 20,
    camera: null,
    cameraState: { status: 'unsupported' } as const,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onCancel: vi.fn(),
  };

  it('picks one and says why it was refused', () => {
    const onImport = vi.fn();
    const { rerender } = renderScreen(
      <SprintVideoRecordScreen {...props} importState={{ status: 'idle' }} onImport={onImport} />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('sprintVideo.import.pick') }));
    expect(onImport).toHaveBeenCalled();
    rerender(
      <SprintVideoRecordScreen
        {...props}
        importState={{ status: 'rejected', rejection: { reason: 'too_slow', fps: 60 } }}
        onImport={onImport}
      />,
    );
    expect(screen.getByText(t('sprintVideo.import.too_slow', { fps: 60 }))).toBeTruthy();
    rerender(
      <SprintVideoRecordScreen
        {...props}
        importState={{ status: 'rejected', rejection: { reason: 'unreadable' } }}
        onImport={onImport}
      />,
    );
    expect(screen.getByText(t('sprintVideo.import.unreadable'))).toBeTruthy();
  });
});

describe('SprintVideoMarkScreen', () => {
  const callbacks = () => ({
    onStep: vi.fn(),
    onSelect: vi.fn(),
    onMark: vi.fn(),
    onGoTo: vi.fn(),
    onClear: vi.fn(),
    onSave: vi.fn(),
    onDiscard: vi.fn(),
  });

  it('steps through the frames and marks the current line', () => {
    const cb = callbacks();
    renderScreen(
      <SprintVideoMarkScreen
        playerName="Díaz, Juan"
        sex="male"
        marking={initialSprintMarking(9_000, 240)}
        attemptNumber={1}
        frameUri="file:///frame.jpg"
        frameFailed={false}
        saving={false}
        saveFailed={false}
        {...cb}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: t('sprintVideo.mark.forward', { count: 10 }) }),
    );
    expect(cb.onStep).toHaveBeenCalledWith(10);
    fireEvent.click(
      screen.getByRole('button', { name: t('sprintVideo.mark.back', { count: 60 }) }),
    );
    expect(cb.onStep).toHaveBeenCalledWith(-60);
    fireEvent.click(screen.getByRole('button', { name: /^Marcar: Salida \(0\sm\)$/ }));
    expect(cb.onMark).toHaveBeenCalled();
    expect(screen.getByRole('img', { name: 'Cuadro 1 de 2160' })).toBeTruthy();
    // Nothing to save before the start, 20 and 40 m are marked.
    fireEvent.click(screen.getByRole('button', { name: t('sprintVideo.mark.save') }));
    expect(cb.onSave).not.toHaveBeenCalled();
  });

  it('shows the splits, the Vmax and the precision, and saves', () => {
    const cb = callbacks();
    const marking = run(
      initialSprintMarking(9_000, 240),
      { type: 'seek', frame: 120 },
      { type: 'mark' },
      { type: 'seek', frame: 552 },
      { type: 'mark' },
      { type: 'seek', frame: 888 },
      { type: 'mark' },
      { type: 'seek', frame: 1488 },
      { type: 'mark' },
    );
    renderScreen(
      <SprintVideoMarkScreen
        playerName="Díaz, Juan"
        sex="male"
        marking={marking}
        attemptNumber={2}
        frameUri={null}
        frameFailed
        saving={false}
        saveFailed={false}
        {...cb}
      />,
    );
    expect(screen.getByText('10 m: 1,80 s')).toBeTruthy();
    expect(screen.getByText('40 m: 5,70 s')).toBeTruthy();
    expect(screen.getByText('Vmax (20–40 m): 8,00 m/s')).toBeTruthy();
    expect(screen.getByText(/Precisión: ±4 ms por tiempo/)).toBeTruthy();
    expect(screen.getByText(t('sprintVideo.mark.frameFailed'))).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: /^Ir al cuadro de la marca: Línea de 20\sm$/ }),
    );
    expect(cb.onGoTo).toHaveBeenCalledWith('line20');
    fireEvent.click(screen.getByRole('button', { name: t('sprintVideo.mark.save') }));
    expect(cb.onSave).toHaveBeenCalled();
  });

  it('warns of marks out of order and of values out of range, never blocking', () => {
    const cb = callbacks();
    const outOfRange = run(
      initialSprintMarking(20_000, 240),
      { type: 'mark' },
      { type: 'select', mark: 'line20' },
      { type: 'seek', frame: 2400 },
      { type: 'mark' },
      { type: 'seek', frame: 3600 },
      { type: 'mark' },
    );
    const { unmount } = renderScreen(
      <SprintVideoMarkScreen
        playerName="Díaz, Juan"
        sex="male"
        marking={outOfRange}
        attemptNumber={1}
        frameUri={null}
        frameFailed={false}
        saving={false}
        saveFailed={false}
        {...cb}
      />,
    );
    expect(screen.getByText(t('sprintVideo.mark.implausible'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('sprintVideo.mark.saveAnyway') }));
    expect(cb.onSave).toHaveBeenCalled();
    unmount();
    const backwards = run(
      initialSprintMarking(9_000, 240),
      { type: 'seek', frame: 500 },
      { type: 'mark' },
      { type: 'select', mark: 'line20' },
      { type: 'seek', frame: 400 },
      { type: 'mark' },
      { type: 'seek', frame: 900 },
      { type: 'mark' },
    );
    renderScreen(
      <SprintVideoMarkScreen
        playerName="Díaz, Juan"
        sex="male"
        marking={backwards}
        attemptNumber={1}
        frameUri={null}
        frameFailed={false}
        saving={false}
        saveFailed
        {...callbacks()}
      />,
    );
    expect(screen.getByText(t('sprintVideo.mark.invalid'))).toBeTruthy();
    expect(screen.getByText(t('sprintVideo.mark.saveFailed'))).toBeTruthy();
  });
});
