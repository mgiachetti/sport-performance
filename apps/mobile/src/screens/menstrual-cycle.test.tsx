// @vitest-environment jsdom
import { SYNC_OPERATION_INPUTS, type MenstrualCycleStatus } from '@sport-performance/contracts';
import type { LocalDate } from '@sport-performance/domain';
import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_CYCLE_DRAFT,
  cycleDraftProblem,
  cycleScreenState,
  menstrualCycleMutation,
  setFlow,
  setNote,
  toggleSymptom,
  type CycleDraft,
  type CycleScreenState,
} from '../menstrual-cycle/model.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { MenstrualCycleScreen } from './menstrual-cycle.tsx';

const { t } = translator;
const CLIENT_UUID = '0b8f7a8e-5d0c-4c2e-9d55-6c1f3c1b2a10';
const TODAY = '2026-11-04' as LocalDate;
const YESTERDAY = '2026-11-03' as LocalDate;

function status(overrides: Partial<MenstrualCycleStatus> = {}): MenstrualCycleStatus {
  return {
    playerId: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f' as MenstrualCycleStatus['playerId'],
    localDate: TODAY,
    available: true,
    unavailableReason: null,
    tracking: true,
    trackingSince: '2026-11-01T12:00:00.000Z',
    viewers: [],
    candidates: [
      {
        membershipId: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e01' as never,
        role: 'medical',
        name: 'Laura Médica',
        authorized: false,
      },
    ],
    ...overrides,
  };
}

describe('the draft of a day', () => {
  it('needs the bleeding; symptoms in order, each once; a note of at most 280', () => {
    expect(cycleDraftProblem(EMPTY_CYCLE_DRAFT)).toBe('no_flow');
    let draft = setFlow(EMPTY_CYCLE_DRAFT, 'light');
    draft = toggleSymptom(toggleSymptom(draft, 'fatigue'), 'cramps');
    expect(draft.symptoms).toEqual(['cramps', 'fatigue']);
    expect(toggleSymptom(draft, 'fatigue').symptoms).toEqual(['cramps']);
    expect(cycleDraftProblem(setNote(draft, 'x'.repeat(281)))).toBe('note_too_long');
    expect(cycleDraftProblem(draft)).toBeNull();
  });

  it('is the body of the queued mutation, which the contract accepts', () => {
    const draft = setNote(toggleSymptom(setFlow(EMPTY_CYCLE_DRAFT, 'heavy'), 'cramps'), '  ok ');
    const input = menstrualCycleMutation(draft, { clientUuid: CLIENT_UUID, localDate: TODAY });
    expect(input).toEqual({
      body: {
        clientUuid: CLIENT_UUID,
        localDate: TODAY,
        flow: 'heavy',
        symptoms: ['cramps'],
        note: 'ok',
      },
    });
    expect(SYNC_OPERATION_INPUTS['menstrual_cycle.log'].safeParse(input).success).toBe(true);
    expect(() => menstrualCycleMutation(EMPTY_CYCLE_DRAFT, { clientUuid: CLIENT_UUID })).toThrow();
  });
});

describe('cycleScreenState', () => {
  it('reads the server, never a kept copy', () => {
    expect(cycleScreenState({ status: undefined, failed: false, offline: true })).toEqual({
      kind: 'offline',
    });
    expect(cycleScreenState({ status: undefined, failed: true, offline: false }).kind).toBe(
      'error',
    );
    expect(
      cycleScreenState({
        status: status({ unavailableReason: 'missing_consent', available: false }),
        failed: false,
        offline: false,
      }),
    ).toEqual({ kind: 'unavailable', reason: 'missing_consent', tracking: true });
    expect(
      cycleScreenState({ status: status({ tracking: false }), failed: false, offline: false }),
    ).toEqual({ kind: 'off' });
  });
});

function Harness({
  state,
  onSave = vi.fn(),
  onStart = vi.fn(),
  onAuthorize = vi.fn(),
  onRevoke = vi.fn(),
}: {
  readonly state: CycleScreenState;
  readonly onSave?: () => void;
  readonly onStart?: () => void;
  readonly onAuthorize?: (membershipId: string) => void;
  readonly onRevoke?: (shareId: string) => void;
}) {
  const [draft, setDraft] = useState<CycleDraft>(EMPTY_CYCLE_DRAFT);
  return (
    <MenstrualCycleScreen
      state={state}
      today={TODAY}
      yesterday={YESTERDAY}
      day={TODAY}
      onPickDay={vi.fn()}
      days={null}
      draft={draft}
      onChange={setDraft}
      onSave={onSave}
      saving={false}
      saved={null}
      error={null}
      onStart={onStart}
      onEnd={vi.fn()}
      onAuthorize={onAuthorize}
      onRevoke={onRevoke}
      busy={false}
      settingsError={null}
      onRetry={vi.fn()}
    />
  );
}

describe('MenstrualCycleScreen', () => {
  it('off: she decides to turn it on, told who sees it', () => {
    const onStart = vi.fn();
    renderScreen(<Harness state={{ kind: 'off' }} onStart={onStart} />);
    expect(screen.getByText(t('cycle.privacy'))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('cycle.start') }));
    expect(onStart).toHaveBeenCalled();
  });

  it('unavailable: says what is missing', () => {
    renderScreen(
      <Harness state={{ kind: 'unavailable', reason: 'missing_consent', tracking: false }} />,
    );
    expect(screen.getByText(t('cycle.unavailable.missing_consent'))).toBeDefined();
    expect(screen.queryByRole('button', { name: t('cycle.save') })).toBeNull();
  });

  it('on: a day in two taps, and she authorizes or removes someone', () => {
    const onSave = vi.fn();
    const onAuthorize = vi.fn();
    const onRevoke = vi.fn();
    const viewer = {
      id: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e02' as never,
      membershipId: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e03' as never,
      role: 'sc' as const,
      name: 'Pablo PF',
      authorizedAt: '2026-11-02T12:00:00.000Z',
    };
    renderScreen(
      <Harness
        state={{ kind: 'on', status: status({ viewers: [viewer] }) }}
        onSave={onSave}
        onAuthorize={onAuthorize}
        onRevoke={onRevoke}
      />,
    );
    const save = screen.getByRole('button', { name: t('cycle.save') });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: t('cycle.flow.moderate') }));
    fireEvent.click(screen.getByRole('button', { name: t('cycle.save') }));
    expect(onSave).toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: t('cycle.viewers.authorize', { name: 'Laura Médica' }) }),
    );
    expect(onAuthorize).toHaveBeenCalledWith('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e01');
    fireEvent.click(
      screen.getByRole('button', { name: t('cycle.viewers.revoke', { name: 'Pablo PF' }) }),
    );
    expect(onRevoke).toHaveBeenCalledWith(viewer.id);
  });
});
