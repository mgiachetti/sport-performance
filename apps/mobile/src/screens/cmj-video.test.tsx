// @vitest-environment jsdom
import { formatUnit } from '@sport-performance/i18n';
import { fireEvent, screen } from '@testing-library/react';
import { useReducer } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CmjVideoPlayer } from '../cmj-video/attempt.ts';
import type { CmjVideoCapture } from '../cmj-video/captures.ts';
import { initialMarking, markingReducer } from '../cmj-video/marking.ts';
import { COACH_AT_ORC } from '../test/fixtures.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { HomeScreen } from './app.tsx';
import {
  CmjVideoMarkScreen,
  CmjVideoPlayersScreen,
  CmjVideoRecordScreen,
  CmjVideoUploadsList,
} from './cmj-video.tsx';

const { t } = translator;

const PLAYER: CmjVideoPlayer = {
  id: 'p1',
  name: 'Díaz, Juan',
  sex: 'male',
  ageYears: 17.2,
  recording: 'allowed',
  video: 'allowed',
  applicable: true,
};

function capture(overrides: Partial<CmjVideoCapture> = {}): CmjVideoCapture {
  return {
    id: 'c1',
    uploadId: 'u1',
    userId: 'user',
    membershipId: 'm',
    playerId: 'p1',
    testSessionId: 's',
    attemptNumber: 2,
    videoFile: 'c1.mp4',
    contentType: 'video/mp4',
    frameRateFps: 240,
    durationMs: 3000,
    recordedAt: 0,
    sizeBytes: null,
    checksumSha256: null,
    state: 'waiting',
    failure: null,
    tries: 0,
    nextTryAt: null,
    refusedUploads: 0,
    ...overrides,
  };
}

describe('HomeScreen', () => {
  it('opens the CMJ by video only when the route allows it', () => {
    const onOpen = vi.fn();
    const props = { userName: 'Ana', membership: COACH_AT_ORC, clubTheme: null, offline: false };
    const { unmount } = renderScreen(<HomeScreen {...props} onOpenCmjVideo={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: t('cmjVideo.title') }));
    expect(onOpen).toHaveBeenCalled();
    unmount();
    renderScreen(<HomeScreen {...props} />);
    expect(screen.queryByRole('button', { name: t('cmjVideo.title') })).toBeNull();
  });
});

describe('CmjVideoPlayersScreen', () => {
  it('films only who may be filmed, and says why not with an icon and a text', () => {
    const onFilm = vi.fn();
    renderScreen(
      <CmjVideoPlayersScreen
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
        onBack={vi.fn()}
        uploads={null}
      />,
    );
    expect(screen.getByText(t('sync.offline'))).toBeTruthy();
    expect(screen.getByText(t('cmjVideo.player.attempts', { count: 1, planned: 3 }))).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: t('cmjVideo.player.film', { name: 'Díaz, Juan' }) }),
    );
    expect(onFilm).toHaveBeenCalledWith('p1');
    expect(
      screen.queryByRole('button', { name: t('cmjVideo.player.film', { name: 'Gómez, Tomás' }) }),
    ).toBeNull();
    expect(
      screen.getByRole('alert', {
        name: `${t('status.warning')}: ${t('cmjVideo.block.missing_image_consent')}`,
      }),
    ).toBeTruthy();
  });
});

describe('CmjVideoRecordScreen', () => {
  it('records only once the camera is ready, and says when it cannot', () => {
    const onStart = vi.fn();
    const props = {
      playerName: 'Díaz, Juan',
      camera: null,
      recording: false,
      maxDurationS: 8,
      attemptCount: 3,
      importState: { status: 'idle' } as const,
      onStart,
      onStop: vi.fn(),
      onImport: vi.fn(),
      onCancel: vi.fn(),
    };
    const { rerender } = renderScreen(
      <CmjVideoRecordScreen {...props} cameraState={{ status: 'preparing' }} />,
    );
    const record = screen.getByRole('button', { name: t('cmjVideo.record.start') });
    expect(record.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(t('cmjVideo.record.protocol', { count: 3 }))).toBeTruthy();
    rerender(
      <CmjVideoRecordScreen {...props} cameraState={{ status: 'ready', frameRateFps: 240 }} />,
    );
    expect(screen.getByText(t('cmjVideo.record.fps', { fps: 240 }))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('cmjVideo.record.start') }));
    expect(onStart).toHaveBeenCalled();
    rerender(<CmjVideoRecordScreen {...props} cameraState={{ status: 'unsupported' }} />);
    expect(screen.getByText(t('cmjVideo.record.unsupported'))).toBeTruthy();
  });
});

describe('CmjVideoRecordScreen: a video from the gallery (ADR 0102)', () => {
  const props = {
    playerName: 'Díaz, Juan',
    camera: null,
    recording: false,
    maxDurationS: 8,
    attemptCount: 3,
    cameraState: { status: 'unsupported' } as const,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onCancel: vi.fn(),
  };

  it('picks one even when the camera cannot film at high speed', () => {
    const onImport = vi.fn();
    renderScreen(
      <CmjVideoRecordScreen {...props} importState={{ status: 'idle' }} onImport={onImport} />,
    );
    expect(screen.getByText(t('cmjVideo.record.unsupported'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('cmjVideo.import.pick') }));
    expect(onImport).toHaveBeenCalled();
  });

  it('says why a video was refused, with the frame rate it has', () => {
    const { rerender } = renderScreen(
      <CmjVideoRecordScreen
        {...props}
        importState={{
          status: 'rejected',
          rejection: { reason: 'too_slow', fps: 30, minFps: 120 },
        }}
        onImport={vi.fn()}
      />,
    );
    expect(screen.getByText(t('cmjVideo.import.too_slow', { fps: 30, minFps: 120 }))).toBeTruthy();
    rerender(
      <CmjVideoRecordScreen
        {...props}
        importState={{ status: 'rejected', rejection: { reason: 'variable_rate' } }}
        onImport={vi.fn()}
      />,
    );
    expect(screen.getByText(t('cmjVideo.import.variable_rate'))).toBeTruthy();
    rerender(
      <CmjVideoRecordScreen {...props} importState={{ status: 'failed' }} onImport={vi.fn()} />,
    );
    expect(screen.getByText(t('cmjVideo.import.failed'))).toBeTruthy();
  });

  it('does not pick another while one is read or while recording', () => {
    const onImport = vi.fn();
    const { rerender } = renderScreen(
      <CmjVideoRecordScreen {...props} importState={{ status: 'reading' }} onImport={onImport} />,
    );
    expect(screen.getByText(t('cmjVideo.import.reading'))).toBeTruthy();
    const pick = screen.getByRole('button', { name: t('cmjVideo.import.pick') });
    expect(pick.getAttribute('aria-disabled')).toBe('true');
    rerender(
      <CmjVideoRecordScreen
        {...props}
        recording
        importState={{ status: 'idle' }}
        onImport={onImport}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('cmjVideo.import.pick') }));
    expect(onImport).not.toHaveBeenCalled();
  });
});

function MarkHarness({ onSave, sex = 'male' }: { onSave: () => void; sex?: 'male' | 'female' }) {
  const [marking, dispatch] = useReducer(markingReducer, initialMarking(2_000, 240));
  return (
    <CmjVideoMarkScreen
      playerName="Díaz, Juan"
      sex={sex}
      ageYears={17.2}
      marking={marking}
      gravityMs2={9.81}
      attemptNumber={1}
      frameUri="file:///frame.jpg"
      frameFailed={false}
      saving={false}
      saveFailed={false}
      onStep={(delta) => {
        dispatch({ type: 'step', delta });
      }}
      onMarkTakeoff={() => {
        dispatch({ type: 'mark_takeoff' });
      }}
      onMarkLanding={() => {
        dispatch({ type: 'mark_landing' });
      }}
      onGoTo={(mark) => {
        dispatch({ type: 'go_to', mark });
      }}
      onSave={onSave}
      onDiscard={vi.fn()}
    />
  );
}

describe('CmjVideoMarkScreen', () => {
  const press = (name: string, times = 1) => {
    for (let i = 0; i < times; i += 1) fireEvent.click(screen.getByRole('button', { name }));
  };

  it('steps frame by frame, marks and shows the flight, height and precision in es-AR', () => {
    const onSave = vi.fn();
    renderScreen(<MarkHarness onSave={onSave} />);
    expect(screen.getByText(t('cmjVideo.mark.frame', { frame: 1, count: 480 }))).toBeTruthy();
    const save = screen.getByRole('button', { name: t('cmjVideo.mark.save', { number: 1 }) });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(t('cmjVideo.mark.takeoffAt', { frame: 'none' }))).toBeTruthy();

    press(t('cmjVideo.mark.forward10.label'));
    press(t('cmjVideo.mark.takeoff'));
    expect(screen.getByText(t('cmjVideo.mark.takeoffAt', { frame: '11' }))).toBeTruthy();
    press(t('cmjVideo.mark.forward10.label'), 12);
    press(t('cmjVideo.mark.landing'));
    // 120 frames at 240 fps: 0,500 s, 30,7 cm, ± 0,5 cm.
    expect(document.body.textContent).toContain(
      t('cmjVideo.mark.result', {
        flight: formatUnit(0.5, 's', { decimals: 3 }),
        height: formatUnit(30.7, 'cm', { decimals: 1 }),
        precision: formatUnit(0.5, 'cm', { decimals: 1 }),
      }),
    );
    press(t('cmjVideo.mark.save', { number: 1 }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('says when the landing is before the take-off', () => {
    renderScreen(<MarkHarness onSave={vi.fn()} />);
    press(t('cmjVideo.mark.forward10.label'));
    press(t('cmjVideo.mark.takeoff'));
    press(t('cmjVideo.mark.back1.label'));
    press(t('cmjVideo.mark.landing'));
    expect(screen.getByText(t('cmjVideo.mark.invalid'))).toBeTruthy();
  });

  it('asks to confirm an implausible height before saving it', () => {
    const onSave = vi.fn();
    renderScreen(<MarkHarness onSave={onSave} />);
    press(t('cmjVideo.mark.takeoff'));
    // 300 frames at 240 fps: 1,25 s in the air, ~190 cm.
    press(t('cmjVideo.mark.forward10.label'), 30);
    press(t('cmjVideo.mark.landing'));
    expect(screen.getByText(t('cmjVideo.mark.implausible'))).toBeTruthy();
    press(t('cmjVideo.mark.save', { number: 1 }));
    expect(onSave).not.toHaveBeenCalled();
    press(t('cmjVideo.mark.saveAnyway'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('CmjVideoUploadsList', () => {
  it('shows what waits and why a video did not go up', () => {
    const onDismiss = vi.fn();
    const failed = capture({ id: 'c2', state: 'failed', failure: 'consent' });
    renderScreen(
      <CmjVideoUploadsList
        captures={[capture(), failed]}
        playerNames={new Map([['p1', 'Díaz, Juan']])}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText(t('cmjVideo.uploads.count', { count: 1 }))).toBeTruthy();
    expect(screen.getByText(t('cmjVideo.uploads.waiting'))).toBeTruthy();
    expect(screen.getByText(t('cmjVideo.uploads.failed.consent'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('cmjVideo.uploads.dismiss') }));
    expect(onDismiss).toHaveBeenCalledWith(failed);
  });
});
