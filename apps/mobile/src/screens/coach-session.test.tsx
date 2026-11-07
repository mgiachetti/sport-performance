// @vitest-environment jsdom
import { PARTICIPATION_CONTACTS_MAX } from '@sport-performance/contracts';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SheetPlayer } from '../coach-session/view.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { forgetRememberedSegments } from '../ui/segmented-tabs.tsx';
import {
  CoachSessionListScreen,
  CoachSessionSheetScreen,
  sheetSegmentScope,
} from './coach-session.tsx';

const { t } = translator;

function player(overrides: Partial<SheetPlayer> = {}): SheetPlayer {
  return {
    id: 'a',
    name: 'Pérez, Juan',
    calledUp: false,
    availability: { status: 'available', staffNotes: [] },
    readOnly: null,
    row: { status: 'full', minutes: '60', contacts: '2' },
    errors: [],
    edited: false,
    unsent: false,
    rpe: null,
    srpeAu: null,
    field: null,
    playsWhileUnavailable: false,
    ...overrides,
  };
}

function openTab(name: string) {
  fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));
}

beforeEach(() => {
  forgetRememberedSegments();
});

const summary = { present: 1, absent: 0, unavailable: 0, pending: 0, minutes: 60, contacts: 2 };

type SheetProps = Parameters<typeof CoachSessionSheetScreen>[0];

function sheetProps(overrides: Partial<SheetProps> = {}): SheetProps {
  return {
    title: 'Entrenamiento M17',
    when: 'Entrenamiento · 03/11/2026 18:00',
    plannedMinutes: 90,
    roster: { status: 'ready', players: [player()], staleSince: null },
    clock: { status: 'off' },
    summary,
    changeCount: 0,
    needsReason: false,
    reason: '',
    reasonMissing: false,
    saving: false,
    notice: null,
    confirmDiscard: false,
    onBack: vi.fn(),
    onRetryRoster: vi.fn(),
    onStatus: vi.fn(),
    onMinutes: vi.fn(),
    onContacts: vi.fn(),
    onContactsText: vi.fn(),
    onToggleField: vi.fn(),
    onStartClock: vi.fn(),
    onPauseClock: vi.fn(),
    onFinishClock: vi.fn(),
    onFillPresent: vi.fn(),
    onReason: vi.fn(),
    onSave: vi.fn(),
    onDiscard: vi.fn(),
    onCancelDiscard: vi.fn(),
    ...overrides,
  };
}

function sheet(overrides: Partial<SheetProps> = {}) {
  const props = sheetProps(overrides);
  renderScreen(<CoachSessionSheetScreen {...props} />);
  return props;
}

describe('CoachSessionListScreen', () => {
  it("shows today's and the week's sessions, marks drafts and opens one", () => {
    const onOpen = vi.fn();
    renderScreen(
      <CoachSessionListScreen
        today={[
          { id: 's1', title: 'Partido contra Hindú', when: 'Partido · 03/11', drafted: true },
        ]}
        recent={[]}
        recentDays={7}
        loading={false}
        neverSynced={false}
        rostersFailed={2}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText(t('coachSession.list.emptyRecent'))).toBeTruthy();
    expect(screen.getByText(t('coachSession.list.drafted'))).toBeTruthy();
    expect(
      screen.getByRole('alert', {
        name: new RegExp(t('coachSession.list.rostersFailed', { count: 2 })),
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: t('coachSession.list.open', { title: 'Partido contra Hindú' }),
      }),
    );
    expect(onOpen).toHaveBeenCalledWith('s1');
  });

  it('keeps showing the drafts of sessions that left the list', () => {
    const onOpen = vi.fn();
    renderScreen(
      <CoachSessionListScreen
        today={[]}
        recent={[]}
        recentDays={7}
        olderDrafts={[{ id: 'old', title: 'Entrenamiento M17', when: '20/10', drafted: true }]}
        loading={false}
        neverSynced={false}
        rostersFailed={0}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText(t('coachSession.list.olderDrafts'))).toBeTruthy();
    expect(screen.getByText(t('coachSession.list.olderDraftsHint'))).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: t('coachSession.list.open', { title: 'Entrenamiento M17' }),
      }),
    );
    expect(onOpen).toHaveBeenCalledWith('old');
  });

  it('says when the sessions never came down to the phone', () => {
    renderScreen(
      <CoachSessionListScreen
        today={[]}
        recent={[]}
        recentDays={7}
        loading={false}
        neverSynced
        rostersFailed={0}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText(t('coachSession.list.neverSynced'))).toBeTruthy();
  });
});

describe('CoachSessionSheetScreen', () => {
  it('changes the status, the minutes and the contacts, each in its tab, and fills everyone present', () => {
    const props = sheet();
    fireEvent.click(screen.getByRole('radio', { name: t('coachSession.status.absent') }));
    expect(props.onStatus).toHaveBeenCalledWith('a', 'absent');
    openTab(t('coachSession.tabs.minutes'));
    fireEvent.change(
      screen.getByLabelText(t('coachSession.player.minutesOf', { name: 'Pérez, Juan' })),
      { target: { value: '45' } },
    );
    expect(props.onMinutes).toHaveBeenCalledWith('a', '45');
    openTab(t('coachSession.tabs.contacts'));
    fireEvent.click(
      screen.getByRole('button', {
        name: t('coachSession.player.contactAddOf', { name: 'Pérez, Juan' }),
      }),
    );
    expect(props.onContacts).toHaveBeenCalledWith('a', 1);
    fireEvent.click(
      screen.getByRole('button', {
        name: t('coachSession.player.contactRemoveOf', { name: 'Pérez, Juan' }),
      }),
    );
    expect(props.onContacts).toHaveBeenCalledWith('a', -1);
    fireEvent.change(
      screen.getByLabelText(t('coachSession.player.contactsOf', { name: 'Pérez, Juan' })),
      { target: { value: '7' } },
    );
    expect(props.onContactsText).toHaveBeenCalledWith('a', '7');
    fireEvent.click(
      screen.getByRole('button', { name: t('coachSession.fillPresent', { minutes: 90 }) }),
    );
    expect(props.onFillPresent).toHaveBeenCalled();
  });

  it('says nothing of a plain available player, in any tab', () => {
    sheet({
      roster: {
        status: 'ready',
        staleSince: null,
        players: [player({ availability: { status: 'available', staffNotes: [] } })],
      },
    });
    expect(screen.queryByText(t('coachSession.player.availability.available'))).toBeNull();
    openTab(t('coachSession.tabs.minutes'));
    expect(screen.queryByText(t('coachSession.player.availability.available'))).toBeNull();
  });

  it('shows availability without the cause, the staff notes, and read-only players', () => {
    sheet({
      roster: {
        status: 'ready',
        staleSince: { date: '03/11/2026', time: '17:00' },
        players: [
          player({
            availability: { status: 'limited', staffNotes: ['Sin contacto'] },
          }),
          player({
            id: 'b',
            name: 'Gómez, Tomás',
            readOnly: 'noConsent',
            availability: null,
            row: { status: '', minutes: '', contacts: '' },
          }),
        ],
      },
    });
    expect(screen.getByText(t('coachSession.player.availability.limited'))).toBeTruthy();
    expect(
      screen.getByText(t('coachSession.player.staffNote', { note: 'Sin contacto' })),
    ).toBeTruthy();
    expect(screen.getByText(t('coachSession.player.noConsent'))).toBeTruthy();
    expect(screen.queryByText(t('coachSession.player.unavailablePlaying'))).toBeNull();
    expect(
      screen.getByText(t('coachSession.roster.stale', { date: '03/11/2026', time: '17:00' })),
    ).toBeTruthy();
    openTab(t('coachSession.tabs.contacts'));
    // The warnings go with the player in every tab.
    expect(screen.getByText(t('coachSession.player.availability.limited'))).toBeTruthy();
    expect(
      screen.getByText(t('coachSession.player.staffNote', { note: 'Sin contacto' })),
    ).toBeTruthy();
    expect(screen.getByText(t('coachSession.player.noConsent'))).toBeTruthy();
    const add = screen.getByRole('button', {
      name: t('coachSession.player.contactAddOf', { name: 'Gómez, Tomás' }),
    });
    expect(add.getAttribute('aria-disabled')).toBe('true');
  });

  it('warns, with icon and text, when an unavailable player is playing', () => {
    sheet({
      roster: {
        status: 'ready',
        staleSince: null,
        players: [
          player({
            availability: { status: 'unavailable', staffNotes: [] },
            playsWhileUnavailable: true,
          }),
        ],
      },
    });
    expect(screen.getByText(t('coachSession.player.unavailablePlaying'))).toBeTruthy();
  });

  it('asks for the reason of a correction and saves', () => {
    const props = sheet({ changeCount: 3, needsReason: true, reasonMissing: true });
    expect(screen.getByText(t('coachSession.reason.required'))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(t('coachSession.reason.label')), {
      target: { value: 'Error de carga' },
    });
    expect(props.onReason).toHaveBeenCalledWith('Error de carga');
    fireEvent.click(screen.getByRole('button', { name: t('coachSession.save', { count: 3 }) }));
    expect(props.onSave).toHaveBeenCalled();
  });

  it('runs the clock and marks who goes in and out', () => {
    const props = sheet({
      clock: { status: 'running', elapsedS: 125, onField: 1, periods: 0 },
      roster: {
        status: 'ready',
        staleSince: null,
        players: [player({ field: { on: true, minutes: 2 } })],
      },
    });
    expect(screen.getByText(t('coachSession.clock.running', { elapsed: '2:05' }))).toBeTruthy();
    openTab(t('coachSession.tabs.minutes'));
    expect(screen.getByText(t('coachSession.player.onField', { minutes: 2 }))).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: t('coachSession.player.goOutOf', { name: 'Pérez, Juan' }),
      }),
    );
    expect(props.onToggleField).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: t('coachSession.clock.pause') }));
    expect(props.onPauseClock).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t('coachSession.clock.finish') }));
    expect(props.onFinishClock).toHaveBeenCalled();
  });

  it('loads a hockey match by period, without contacts (B-803)', () => {
    const props = sheet({
      fieldRules: { contacts: false, byPeriod: true },
      clock: { status: 'running', elapsedS: 1000, onField: 1, periods: 2 },
      roster: {
        status: 'ready',
        staleSince: null,
        players: [
          player({
            row: { status: 'partial', minutes: '20', contacts: '', periods: '15,5' },
            field: { on: true, minutes: 20 },
          }),
        ],
      },
    });
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.queryByRole('tab', { name: t('coachSession.tabs.contacts') })).toBeNull();
    openTab(t('coachSession.tabs.minutes'));
    expect(screen.getByText(t('coachSession.player.periods', { periods: '15 · 5' }))).toBeTruthy();
    expect(screen.getByText(t('coachSession.clock.periods', { count: 2 }))).toBeTruthy();
    expect(
      screen.queryByLabelText(t('coachSession.player.contactsOf', { name: 'Pérez, Juan' })),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('coachSession.clock.endPeriod') }));
    expect(props.onPauseClock).toHaveBeenCalled();
  });

  it("splits the roster by dimension: only that tab's controls in each row", () => {
    sheet({
      roster: {
        status: 'ready',
        staleSince: null,
        players: [
          player(),
          player({
            id: 'b',
            name: 'Gómez, Tomás',
            row: { status: 'absent', minutes: '', contacts: '' },
          }),
        ],
      },
    });
    expect(screen.getByRole('tablist', { name: t('coachSession.tabs.label') })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(
      screen.getByRole('tab', { name: t('coachSession.tabs.attendance'), selected: true }),
    ).toBeTruthy();
    expect(screen.getAllByRole('radiogroup', { name: /^Estado de / })).toHaveLength(2);
    expect(
      screen.queryByLabelText(t('coachSession.player.minutesOf', { name: 'Pérez, Juan' })),
    ).toBeNull();
    // The clock and the summary stay above the tabs.
    expect(screen.getByText(t('coachSession.clock.title'))).toBeTruthy();
    expect(screen.getByText(t('coachSession.summary.title'))).toBeTruthy();

    openTab(t('coachSession.tabs.minutes'));
    expect(screen.queryByRole('radiogroup', { name: /^Estado de / })).toBeNull();
    expect(
      screen.getByLabelText(t('coachSession.player.minutesOf', { name: 'Pérez, Juan' })),
    ).toBeTruthy();
    expect(
      screen.getByText(t('coachSession.row.noLoad', { status: t('coachSession.status.absent') })),
    ).toBeTruthy();
    expect(screen.getByText(t('coachSession.clock.title'))).toBeTruthy();
    expect(screen.getByText(t('coachSession.summary.title'))).toBeTruthy();
  });

  it('counts the players without a status on the attendance tab', () => {
    sheet({
      roster: {
        status: 'ready',
        staleSince: null,
        players: [
          player({ row: { status: '', minutes: '', contacts: '' } }),
          player({ id: 'b', name: 'Gómez, Tomás', row: { status: '', minutes: '', contacts: '' } }),
        ],
      },
    });
    expect(
      screen.getByRole('tab', {
        name: t('tabs.withBadge', {
          label: t('coachSession.tabs.attendance'),
          badge: t('coachSession.tabs.noStatus', { count: 2 }),
        }),
      }),
    ).toBeTruthy();
  });

  it('keeps the unsaved and unsent marks of each player in every tab', () => {
    sheet({
      roster: {
        status: 'ready',
        staleSince: null,
        players: [
          player({
            edited: true,
            availability: { status: 'unavailable', staffNotes: [] },
            playsWhileUnavailable: true,
          }),
          player({ id: 'b', name: 'Gómez, Tomás', unsent: true, readOnly: 'leftClub' }),
        ],
      },
    });
    for (const tab of ['attendance', 'minutes', 'contacts'] as const) {
      openTab(t(`coachSession.tabs.${tab}`));
      expect(screen.getByText(t('coachSession.player.edited')), tab).toBeTruthy();
      expect(screen.getByText(t('sync.item.pending')), tab).toBeTruthy();
      expect(screen.getByText(t('coachSession.player.unavailablePlaying')), tab).toBeTruthy();
      // In attendance "No disponible" is also a status to choose.
      expect(
        screen.getAllByText(t('coachSession.player.availability.unavailable')).length,
        tab,
      ).toBeGreaterThan(0);
      expect(screen.getByText(t('coachSession.player.leftClub')), tab).toBeTruthy();
    }
  });

  it('badges a tab with an error and jumps to it on save', () => {
    const props = sheet({
      changeCount: 1,
      roster: {
        status: 'ready',
        staleSince: null,
        players: [
          player({ row: { status: 'full', minutes: '60', contacts: '999' }, errors: ['contacts'] }),
        ],
      },
    });
    const badged = t('tabs.withBadge', {
      label: t('coachSession.tabs.contacts'),
      badge: t('coachSession.tabs.errors', { count: 1 }),
    });
    expect(screen.getByRole('tab', { name: badged })).toBeTruthy();
    expect(screen.getByRole('tab', { name: t('coachSession.tabs.minutes') })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('coachSession.save', { count: 1 }) }));
    expect(props.onSave).toHaveBeenCalled();
    expect(
      screen.getByRole('tab', { name: t('coachSession.tabs.contacts'), selected: true }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        t('coachSession.player.error.contacts', { max: PARTICIPATION_CONTACTS_MAX }),
      ),
    ).toBeTruthy();
  });

  it('remembers the last tab of the sheet for the membership', () => {
    const first = renderScreen(<CoachSessionSheetScreen {...sheetProps()} segmentScope="m1" />);
    openTab(t('coachSession.tabs.minutes'));
    first.unmount();
    renderScreen(<CoachSessionSheetScreen {...sheetProps()} segmentScope="m1" />);
    expect(
      screen.getByRole('tab', { name: t('coachSession.tabs.minutes'), selected: true }),
    ).toBeTruthy();
  });

  it('opens another session on attendance', () => {
    const first = renderScreen(
      <CoachSessionSheetScreen {...sheetProps()} segmentScope={sheetSegmentScope('m1', 's1')} />,
    );
    openTab(t('coachSession.tabs.minutes'));
    first.unmount();
    renderScreen(
      <CoachSessionSheetScreen {...sheetProps()} segmentScope={sheetSegmentScope('m1', 's2')} />,
    );
    expect(
      screen.getByRole('tab', { name: t('coachSession.tabs.attendance'), selected: true }),
    ).toBeTruthy();
  });

  it('takes off the field a player on it marked absent', () => {
    const props = sheet({
      clock: { status: 'running', elapsedS: 600, onField: 1, periods: 0 },
      roster: {
        status: 'ready',
        staleSince: null,
        players: [
          player({
            row: { status: 'absent', minutes: '', contacts: '' },
            field: { on: true, minutes: 10 },
          }),
        ],
      },
    });
    openTab(t('coachSession.tabs.minutes'));
    expect(screen.getByText(t('coachSession.player.onField', { minutes: 10 }))).toBeTruthy();
    // On the field, the clock rewrites the status when it finishes: no "no load" yet.
    expect(
      screen.queryByText(t('coachSession.row.noLoad', { status: t('coachSession.status.absent') })),
    ).toBeNull();
    expect(
      screen.queryByLabelText(t('coachSession.player.minutesOf', { name: 'Pérez, Juan' })),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: t('coachSession.player.goOutOf', { name: 'Pérez, Juan' }),
      }),
    );
    expect(props.onToggleField).toHaveBeenCalledWith('a');
  });

  it('says who is called up from another category in every tab', () => {
    sheet({
      roster: { status: 'ready', staleSince: null, players: [player({ calledUp: true })] },
    });
    for (const tab of ['attendance', 'minutes', 'contacts'] as const) {
      openTab(t(`coachSession.tabs.${tab}`));
      expect(screen.getByText(t('coachSession.player.calledUp')), tab).toBeTruthy();
    }
  });

  it('says the roster is not on the phone instead of an empty sheet', () => {
    const props = sheet({ roster: { status: 'missing', retrying: false } });
    expect(screen.getByText(t('coachSession.roster.missing'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('coachSession.save', { count: 0 }) })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('coachSession.roster.retry') }));
    expect(props.onRetryRoster).toHaveBeenCalled();
  });
});
