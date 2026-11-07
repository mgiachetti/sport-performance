// @vitest-environment jsdom
import { ApiError, type InvitationPreview } from '@sport-performance/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { COACH_AT_ORC, ORC_THEME, PARENT_AT_ORC, PLAYER_AT_OTHER } from '../test/fixtures.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { AccountScreen, HomeScreen, UpdateRequiredScreen, homeToolGroups } from './app.tsx';
import { NoClubScreen, SelectClubScreen } from './clubs.tsx';
import { InvitationScreen } from './invitation.tsx';
import { SyncIndicator } from './sync.tsx';
import { toolGridColumns } from '../ui/tiles.tsx';

const { t } = translator;

describe('SelectClubScreen', () => {
  it('lists each membership as club and role, marks the current one and selects', () => {
    const onSelect = vi.fn();
    renderScreen(
      <SelectClubScreen
        memberships={[COACH_AT_ORC, PARENT_AT_ORC, PLAYER_AT_OTHER]}
        activeMembershipId={PARENT_AT_ORC.id}
        notice={null}
        onSelect={onSelect}
      />,
    );
    expect(
      screen.getByRole('button', {
        name: t('club.select.asRole', { clubName: 'Olivos Rugby Club', role: t('role.parent') }),
      }).textContent,
    ).toContain(t('club.select.current'));
    expect(screen.getAllByText(t('club.select.current'))).toHaveLength(1);
    fireEvent.click(
      screen.getByRole('button', {
        name: t('club.select.asRole', { clubName: 'Atlético Otro', role: t('role.player') }),
      }),
    );
    expect(onSelect).toHaveBeenCalledWith(PLAYER_AT_OTHER.id);
  });

  it('explains a membership that was closed', () => {
    renderScreen(
      <SelectClubScreen
        memberships={[COACH_AT_ORC, PLAYER_AT_OTHER]}
        activeMembershipId={null}
        notice="membershipLost"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(t('club.membershipLost'));
  });

  it('tells a user without clubs how to get one', () => {
    const onSignOut = vi.fn();
    renderScreen(<NoClubScreen offline={false} onRetry={vi.fn()} onSignOut={onSignOut} />);
    expect(screen.getByText(t('club.none.body'))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('auth.signOut') }));
    expect(onSignOut).toHaveBeenCalled();
  });
});

describe('InvitationScreen', () => {
  const preview: InvitationPreview = {
    club: { id: COACH_AT_ORC.club.id, slug: 'orc', name: 'Olivos Rugby Club' },
    role: 'coach',
    status: 'pending',
    expiresAt: '2026-11-10T12:00:00.000Z',
    emailHint: 'a***@example.com',
  };

  function setup(
    props: Partial<Parameters<typeof InvitationScreen>[0]> = {},
  ): Parameters<typeof InvitationScreen>[0] {
    const all = {
      state: { status: 'ready', preview } as const,
      signedIn: true,
      accept: vi.fn(() => Promise.resolve()),
      onSignIn: vi.fn(),
      onDone: vi.fn(),
      onRetry: vi.fn(),
      ...props,
    };
    renderScreen(<InvitationScreen {...all} />);
    return all;
  }

  it('asks to sign in with the invited email first', () => {
    const { onSignIn } = setup({ signedIn: false });
    expect(
      screen.getByText(t('invitation.signInFirst', { emailHint: 'a***@example.com' })),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('invitation.signIn') }));
    expect(onSignIn).toHaveBeenCalled();
  });

  it('accepts and then enters the club', async () => {
    const { accept, onDone } = setup();
    expect(
      screen.getByText(t('invitation.title', { clubName: 'Olivos Rugby Club' })),
    ).toBeDefined();
    expect(screen.getByText(t('invitation.asRole', { role: t('role.coach') }))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('invitation.accept') }));
    expect(
      await screen.findByText(t('invitation.accepted', { clubName: 'Olivos Rugby Club' })),
    ).toBeDefined();
    expect(accept).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: t('invitation.goToClub') }));
    expect(onDone).toHaveBeenCalled();
  });

  it('explains an invitation for another email', async () => {
    setup({
      accept: () =>
        Promise.reject(
          new ApiError({
            operationId: 'acceptInvitation',
            status: 403,
            code: 'forbidden',
            message: 'x',
          }),
        ),
    });
    fireEvent.click(screen.getByRole('button', { name: t('invitation.accept') }));
    expect(await screen.findByText(t('invitation.error.wrongEmail'))).toBeDefined();
  });

  it('does not offer to accept an expired, revoked or used invitation', () => {
    setup({ state: { status: 'ready', preview: { ...preview, status: 'expired' } } });
    expect(screen.getByText(t('invitation.status.expired'))).toBeDefined();
    expect(screen.getByText(t('invitation.error.unavailable'))).toBeDefined();
    expect(screen.queryByRole('button', { name: t('invitation.accept') })).toBeNull();
  });

  it('explains a malformed link', () => {
    setup({ state: { status: 'invalidLink' } });
    expect(screen.getByText(t('invitation.invalidLink'))).toBeDefined();
  });

  it('retries a failed preview', async () => {
    const { onRetry } = setup({
      state: {
        status: 'error',
        error: new ApiError({ operationId: 'p', status: 404, code: 'not_found', message: 'x' }),
      },
    });
    expect(screen.getByText(t('invitation.error.unavailable'))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('common.retry') }));
    await waitFor(() => {
      expect(onRetry).toHaveBeenCalled();
    });
  });
});

describe('app screens', () => {
  it('groups the staff tools as tiles under their headings, with the full hint for a screen reader', () => {
    const onOpenKiosk = vi.fn();
    renderScreen(
      <HomeScreen
        userName="Ana"
        membership={COACH_AT_ORC}
        clubTheme={null}
        onOpenIft3015={vi.fn()}
        onOpenReaction={vi.fn()}
        onOpenWeeklyCmj={vi.fn()}
        onOpenAnthropometry={vi.fn()}
        onOpenSprintVideo={vi.fn()}
        onOpenCmjVideo={vi.fn()}
        onOpenKiosk={onOpenKiosk}
        onOpenProtocols={vi.fn()}
      />,
    );
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings).toEqual(
      expect.arrayContaining([t('home.group.field'), t('home.group.video'), t('home.group.more')]),
    );
    const tiles = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
      .filter((label) => label?.startsWith('Hola') !== true);
    expect(tiles).toEqual([
      t('home.tile.ift'),
      t('home.tile.reaction'),
      t('home.tile.weeklyCmj'),
      t('home.tile.anthropometry'),
      t('home.tile.sprintVideo'),
      t('home.tile.cmjVideo'),
      t('home.tile.kiosk'),
      t('home.tile.protocols'),
    ]);
    // The short line is visible under the title.
    const kiosk = screen.getByRole('button', { name: t('home.tile.kiosk') });
    expect(kiosk.textContent).toContain(t('home.tile.kiosk.hint'));
    fireEvent.click(kiosk);
    expect(onOpenKiosk).toHaveBeenCalled();
    // The kiosk is a tile now, not a card of its own; the legal caption stays.
    expect(screen.getByText(t('legal.notMedicalDevice'))).toBeDefined();
  });

  it('gives each tile its short title and the full hint it had as a row', () => {
    const groups = homeToolGroups(t, {
      ift: null,
      reaction: null,
      weeklyCmj: null,
      anthropometry: vi.fn(),
      sprintVideo: null,
      cmjVideo: null,
      kiosk: vi.fn(),
      protocols: vi.fn(),
    });
    expect(groups.map((group) => group.tools.map((tool) => tool.key))).toEqual([
      ['anthropometry'],
      [],
      ['kiosk', 'protocols'],
    ]);
    const [kiosk, protocols] = groups[2]?.tools ?? [];
    expect(kiosk?.title).toBe(t('home.tile.kiosk'));
    expect(kiosk?.accessibilityHint).toBe(t('kiosk.open.hint'));
    expect(protocols?.accessibilityHint).toBe(t('protocols.open.hint'));
    expect(groups[0]?.tools[0]?.accessibilityHint).toBe(t('anthropometry.field.subtitle'));
  });

  it('drops a group with no visible tools, heading included', () => {
    renderScreen(
      <HomeScreen
        userName="Ana"
        membership={COACH_AT_ORC}
        clubTheme={null}
        onOpenSprintVideo={vi.fn()}
        onOpenProtocols={vi.fn()}
      />,
    );
    expect(screen.queryByRole('heading', { name: t('home.group.field') })).toBeNull();
    expect(screen.getByRole('heading', { name: t('home.group.video') })).toBeDefined();
    expect(screen.getByRole('heading', { name: t('home.group.more') })).toBeDefined();
    expect(screen.queryByRole('button', { name: t('home.tile.cmjVideo') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('home.tile.kiosk') })).toBeNull();
    expect(screen.getByRole('button', { name: t('home.tile.sprintVideo') })).toBeDefined();
    expect(screen.getByRole('button', { name: t('home.tile.protocols') })).toBeDefined();
  });

  it('shows no tool heading at all when no tool is offered', () => {
    renderScreen(<HomeScreen userName="Ana" membership={COACH_AT_ORC} clubTheme={null} />);
    for (const group of ['home.group.field', 'home.group.video', 'home.group.more'] as const) {
      expect(screen.queryByRole('heading', { name: t(group) })).toBeNull();
    }
  });

  it('lays the tiles in two columns, one on a narrow screen or with a large font', () => {
    expect(toolGridColumns(390, 1)).toBe(2);
    expect(toolGridColumns(339, 1)).toBe(1);
    expect(toolGridColumns(390, 1.3)).toBe(1);
    expect(toolGridColumns(768, 2)).toBe(1);
  });

  it('greets the user in the club with its brand and no sync box when all is well', () => {
    const now = Date.UTC(2026, 10, 3, 12, 0, 0);
    renderScreen(
      <HomeScreen
        userName="Ana"
        membership={COACH_AT_ORC}
        clubTheme={ORC_THEME}
        sync={
          <SyncIndicator
            status={{
              membershipId: COACH_AT_ORC.id,
              phase: 'idle',
              pause: null,
              pendingCount: 0,
              issueCount: 0,
              lastSyncedAt: now - 60_000,
              nextAttemptAt: null,
            }}
            nowMs={now}
            onSyncNow={vi.fn()}
          />
        }
      />,
    );
    expect(screen.getByText(t('home.greeting', { name: 'Ana' }))).toBeDefined();
    expect(
      screen.getByLabelText(t('club.logoAlt', { clubName: 'Olivos Rugby Club' })),
    ).toBeDefined();
    expect(screen.getByText('ORC')).toBeDefined();
    // The idle indicator draws nothing: no summary, no line, no button.
    expect(screen.queryByLabelText(t('sync.title'))).toBeNull();
    expect(screen.queryByRole('button', { name: /sincroniz|sin enviar|Sin conexión/i })).toBeNull();
  });

  it('lets the user change club, switch to high contrast and sign out', () => {
    const onChangeClub = vi.fn();
    const onSignOut = vi.fn();
    renderScreen(
      <AccountScreen
        email="ana@example.com"
        membership={COACH_AT_ORC}
        clubTheme={null}
        canChangeClub
        version="1.0.0 (12)"
        offline={false}
        signingOut={false}
        onChangeClub={onChangeClub}
        onSignOut={onSignOut}
      />,
    );
    expect(screen.getByText(t('account.signedInAs', { email: 'ana@example.com' }))).toBeDefined();
    expect(screen.getByText(t('account.version', { version: '1.0.0 (12)' }))).toBeDefined();
    expect(screen.getByRole('switch', { name: t('account.highContrast') })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('club.switch') }));
    fireEvent.click(screen.getByRole('button', { name: t('auth.signOut') }));
    expect(onChangeClub).toHaveBeenCalled();
    expect(onSignOut).toHaveBeenCalled();
  });

  it('blocks the app with the store button when the version is no longer served', () => {
    const onOpenStore = vi.fn();
    renderScreen(
      <UpdateRequiredScreen
        prompt={{
          presentation: 'screen',
          title: t('appUpdate.required.title'),
          body: t('error.appUpdateRequired'),
          action: { label: t('appUpdate.required.action'), url: 'https://apps.apple.com/app/id1' },
          note: null,
          dismissLabel: null,
        }}
        onOpenStore={onOpenStore}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('appUpdate.required.action') }));
    expect(onOpenStore).toHaveBeenCalledWith('https://apps.apple.com/app/id1');
  });

  it('renders in the high-contrast variant', () => {
    renderScreen(<HomeScreen userName="" membership={COACH_AT_ORC} clubTheme={null} />, 'light-hc');
    expect(screen.getByText(t('home.greetingAnonymous'))).toBeDefined();
  });
});
