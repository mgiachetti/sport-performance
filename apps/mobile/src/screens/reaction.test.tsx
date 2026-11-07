// @vitest-environment jsdom
import {
  DEFAULT_REACTION_PROTOCOL,
  summarizeReactionSeries,
  type ReactionTrialRecord,
} from '@sport-performance/domain';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { COACH_AT_ORC } from '../test/fixtures.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { HomeScreen } from './app.tsx';
import {
  ReactionIntroScreen,
  ReactionResultScreen,
  ReactionRunScreen,
  ReactionSetupScreen,
} from './reaction.tsx';

const { t } = translator;
const P = DEFAULT_REACTION_PROTOCOL;

const setupProps = {
  offline: false,
  fromCache: false,
  hasDefinition: true,
  device: { kind: 'registered', label: 'Tablet 1' } as const,
  canManageDevice: true,
  deviceLabel: 'Pixel 9',
  onChangeDeviceLabel: vi.fn(),
  onRegisterDevice: vi.fn(),
  registering: false,
  registerFailed: false,
  categories: [{ id: 'm15', name: 'M15' }],
  categoryId: null,
  onSelectCategory: vi.fn(),
  players: null,
  onSelectPlayer: vi.fn(),
  notice: null,
};

function valid(times: number[]): ReactionTrialRecord[] {
  return times.map((reactionMs, index) => ({
    index,
    practice: false,
    stimulus: 'go',
    foreperiodMs: 1500,
    outcome: 'valid',
    reactionMs,
  }));
}

describe('HomeScreen', () => {
  it('opens the reaction test only when the route allows it', () => {
    const onOpen = vi.fn();
    const props = { userName: 'Ana', membership: COACH_AT_ORC, clubTheme: null, offline: false };
    const { unmount } = renderScreen(<HomeScreen {...props} onOpenReaction={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: t('home.tile.reaction') }));
    expect(onOpen).toHaveBeenCalled();
    unmount();
    renderScreen(<HomeScreen {...props} />);
    expect(screen.queryByRole('button', { name: t('home.tile.reaction') })).toBeNull();
  });
});

describe('ReactionSetupScreen', () => {
  it('asks to register this phone before anything else', () => {
    const onRegister = vi.fn();
    renderScreen(
      <ReactionSetupScreen
        {...setupProps}
        device={{ kind: 'unregistered' }}
        onRegisterDevice={onRegister}
      />,
    );
    expect(screen.getByText(t('reaction.device.notRegistered'))).toBeTruthy();
    expect(screen.queryByText(t('reaction.category.title'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('reaction.device.register') }));
    expect(onRegister).toHaveBeenCalled();
  });

  it('needs a name and a connection to register', () => {
    renderScreen(
      <ReactionSetupScreen
        {...setupProps}
        device={{ kind: 'unregistered' }}
        deviceLabel=" "
        offline
      />,
    );
    expect(screen.getByText(t('reaction.device.labelRequired'))).toBeTruthy();
    expect(screen.getByText(t('reaction.device.needsConnection'))).toBeTruthy();
    const button = screen.getByRole('button', { name: t('reaction.device.register') });
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('tells a role that cannot register who can', () => {
    renderScreen(
      <ReactionSetupScreen
        {...setupProps}
        device={{ kind: 'unregistered' }}
        canManageDevice={false}
      />,
    );
    expect(screen.getByText(t('reaction.device.notAllowed'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('reaction.device.register') })).toBeNull();
  });

  it('offers to use a retired device again', () => {
    renderScreen(
      <ReactionSetupScreen {...setupProps} device={{ kind: 'retired', label: 'Tablet 1' }} />,
    );
    expect(screen.getByRole('button', { name: t('reaction.device.restore') })).toBeTruthy();
  });

  it('with the device registered, lists categories and players to pick', () => {
    const onSelectPlayer = vi.fn();
    renderScreen(
      <ReactionSetupScreen
        {...setupProps}
        categoryId="m15"
        players={{
          status: 'ready',
          data: [
            { id: 'p1', name: 'Ana Acosta' },
            { id: 'p2', name: 'Bruno Benítez' },
          ],
        }}
        onSelectPlayer={onSelectPlayer}
        fromCache
      />,
    );
    expect(screen.getByText(t('reaction.device.registered', { label: 'Tablet 1' }))).toBeTruthy();
    expect(screen.getByText(t('reaction.offlineCopy'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bruno Benítez' }));
    expect(onSelectPlayer).toHaveBeenCalledWith('p2');
  });

  it('says when the club has no version of the test in force', () => {
    renderScreen(<ReactionSetupScreen {...setupProps} hasDefinition={false} />);
    expect(screen.getByText(t('reaction.noDefinition'))).toBeTruthy();
    expect(screen.queryByText(t('reaction.category.title'))).toBeNull();
  });
});

describe('ReactionIntroScreen', () => {
  it('hands the phone to the player and explains the task and the practice', () => {
    const onBegin = vi.fn();
    renderScreen(
      <ReactionIntroScreen
        playerName="Ana Acosta"
        task="simple"
        taskIndex={0}
        taskCount={2}
        protocol={P}
        interrupted={false}
        onBegin={onBegin}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(t('reaction.handOver', { name: 'Ana Acosta' }))).toBeTruthy();
    expect(
      screen.getByText(
        t('reaction.intro.practice', { count: P.practiceTrials, valid: P.validTrials }),
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('reaction.begin') }));
    expect(onBegin).toHaveBeenCalled();
  });
});

describe('ReactionRunScreen', () => {
  const progress = { practice: false, valid: 2, needed: 5 };

  it('shows the stimulus with its words and reports the first frame and the touch', async () => {
    const onTouch = vi.fn();
    const onShown = vi.fn();
    renderScreen(
      <ReactionRunScreen
        view={{ phase: 'stimulus', stimulus: 'no_go', progress, trial: 4 }}
        onTouch={onTouch}
        onStimulusShown={onShown}
        now={() => 1234}
      />,
    );
    expect(screen.getByText(t('reaction.stimulus.no_go'))).toBeTruthy();
    expect(screen.getByText(t('reaction.progress.valid', { valid: 2, needed: 5 }))).toBeTruthy();
    await vi.waitFor(() => {
      expect(onShown).toHaveBeenCalledWith(1234);
    });
    // `onPressIn`: the press starts (a key here; a finger on the phone).
    fireEvent.keyDown(screen.getByRole('button', { name: t('reaction.area') }), { key: 'Enter' });
    expect(onTouch).toHaveBeenCalledWith(1234);
  });

  it('says what a stimulus ended as, in words', () => {
    renderScreen(
      <ReactionRunScreen
        view={{
          phase: 'feedback',
          progress,
          record: {
            index: 3,
            practice: false,
            stimulus: 'go',
            foreperiodMs: 1000,
            outcome: 'anticipation',
            reactionMs: 40,
          },
        }}
        onTouch={vi.fn()}
        onStimulusShown={vi.fn()}
        now={() => 0}
      />,
    );
    expect(screen.getByText(t('reaction.feedback.anticipation'))).toBeTruthy();
  });
});

describe('ReactionResultScreen', () => {
  const simple = summarizeReactionSeries('simple', valid([240, 250, 260, 250, 250]), P);

  it('compares only with the player on this device and saves', () => {
    const onSave = vi.fn();
    renderScreen(
      <ReactionResultScreen
        playerName="Ana Acosta"
        summaries={[simple]}
        history={{
          simple: [
            {
              key: 'r1:simple',
              playerId: 'p1',
              deviceId: 'd1',
              measuredOn: '2026-07-10',
              task: 'simple',
              valueMs: 262,
              pending: false,
            },
          ],
          go_no_go: [],
        }}
        validNeeded={5}
        saving={false}
        saveFailed={false}
        onSave={onSave}
        onRepeat={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByText(t('reaction.result.mean', { time: '250 ms' }))).toBeTruthy();
    expect(
      screen.getByText(t('reaction.result.previous', { time: '262 ms', date: '10/07/2026' })),
    ).toBeTruthy();
    expect(screen.getByText(t('reaction.result.historyHint'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('reaction.save') }));
    expect(onSave).toHaveBeenCalled();
  });

  it('saves nothing when no series is complete', () => {
    const incomplete = summarizeReactionSeries('simple', [], { ...P, maxTrialsPerSeries: 5 });
    renderScreen(
      <ReactionResultScreen
        playerName="Ana Acosta"
        summaries={[{ ...incomplete, status: 'incomplete' }]}
        history={null}
        validNeeded={5}
        saving={false}
        saveFailed={false}
        onSave={vi.fn()}
        onRepeat={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByText(t('reaction.result.nothingToSave'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('reaction.save') })).toBeNull();
  });
});
