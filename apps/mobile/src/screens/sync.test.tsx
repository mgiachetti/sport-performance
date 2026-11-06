// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { nativeThemeFor } from '../branding/club-branding.ts';
import { TranslatorProvider } from '../ui/i18n.tsx';
import { ThemeProvider } from '../ui/theme.tsx';
import type { SyncIssue, SyncStatus } from '../offline/engine.ts';
import { COACH_AT_ORC } from '../test/fixtures.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { AccountScreen } from './app.tsx';
import { SyncIndicator, SyncIssuesList } from './sync.tsx';

const { t } = translator;
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

/** A new screen in place of the last one (the providers come with `renderScreen`). */
function renderAgain(ui: Parameters<typeof renderScreen>[0]) {
  cleanup();
  return renderScreen(ui);
}

const idle: SyncStatus = {
  membershipId: COACH_AT_ORC.id,
  phase: 'idle',
  pause: null,
  pendingCount: 0,
  issueCount: 0,
  lastSyncedAt: NOW - 5 * 60_000,
  nextAttemptAt: null,
};

function issue(overrides: Partial<SyncIssue> = {}): SyncIssue {
  return {
    id: 1,
    mutationId: 'm1',
    op: 'wellness.submit',
    kind: 'rejected',
    errorCode: 'conflict',
    errorPaths: [],
    fields: [],
    input: { body: { scores: {} } },
    recordedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

describe('SyncIndicator', () => {
  it('renders nothing when all is synced', () => {
    const { container } = renderScreen(
      <SyncIndicator status={idle} nowMs={NOW} onSyncNow={vi.fn()} />,
    );
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('stays silent during the first sync of a fresh login, without "never synced"', () => {
    const fresh = { ...idle, lastSyncedAt: null };
    const first = renderScreen(
      <SyncIndicator status={{ ...fresh, phase: 'syncing' }} nowMs={NOW} onSyncNow={vi.fn()} />,
    );
    expect(first.container.textContent).toBe('');
    renderAgain(<SyncIndicator status={fresh} nowMs={NOW} onSyncNow={vi.fn()} />);
    expect(document.body.textContent).toBe('');
  });

  it('says it never synced only without signal', () => {
    renderScreen(
      <SyncIndicator
        status={{ ...idle, phase: 'offline', lastSyncedAt: null }}
        nowMs={NOW}
        onSyncNow={vi.fn()}
      />,
    );
    expect(screen.getByText(t('sync.quiet.offlineNever'))).toBeDefined();
  });

  it('puts no signal and what waits in one line that syncs now when pressed', () => {
    const onSyncNow = vi.fn();
    renderScreen(
      <SyncIndicator
        status={{ ...idle, phase: 'offline', pendingCount: 3, nextAttemptAt: NOW }}
        nowMs={NOW}
        onSyncNow={onSyncNow}
      />,
    );
    expect(screen.getByText('Sin conexión · 3 cambios sin enviar')).toBeDefined();
    // One quiet line: no status boxes and no separate button.
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    const line = screen.getByRole('button', {
      name: `${t('status.warning')}: Sin conexión · 3 cambios sin enviar`,
    });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(line);
    expect(onSyncNow).toHaveBeenCalledTimes(1);
  });

  it('says no connection for an offline session only while the engine has no fresher answer', () => {
    renderScreen(
      <SyncIndicator
        status={{ ...idle, phase: 'syncing', pendingCount: 2 }}
        offline
        nowMs={NOW}
        onSyncNow={vi.fn()}
      />,
    );
    expect(screen.getByText(t('sync.quiet.offline', { count: 2 }))).toBeDefined();
    // Idle after a successful sync: the engine reached the server, so nothing shows.
    const { container } = renderAgain(
      <SyncIndicator status={idle} offline nowMs={NOW} onSyncNow={vi.fn()} />,
    );
    expect(container.textContent).toBe('');
  });

  it('never hides a pause or a failing server behind an offline session', () => {
    renderScreen(
      <SyncIndicator
        status={{ ...idle, phase: 'paused', pause: 'session' }}
        offline
        nowMs={NOW}
        onSyncNow={vi.fn()}
      />,
    );
    expect(screen.getByText(t('sync.paused'))).toBeDefined();
    expect(screen.queryByText(/Sin conexión/)).toBeNull();
    renderAgain(
      <SyncIndicator
        status={{ ...idle, phase: 'failing' }}
        offline
        nowMs={NOW}
        onSyncNow={vi.fn()}
      />,
    );
    expect(screen.getByText('No pudimos sincronizar')).toBeDefined();
    expect(screen.queryByText(/Sin conexión/)).toBeNull();
  });

  it('lets the user sync now while paused: a forced sync resumes the pause', () => {
    const onSyncNow = vi.fn();
    renderScreen(
      <SyncIndicator
        status={{ ...idle, phase: 'paused', pause: 'session', pendingCount: 2 }}
        nowMs={NOW}
        onSyncNow={onSyncNow}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '2 cambios sin enviar' }));
    expect(onSyncNow).toHaveBeenCalledTimes(1);
  });

  it('says what waits, what it is sending and that the server fails, each in one line', () => {
    renderScreen(
      <SyncIndicator status={{ ...idle, pendingCount: 1 }} nowMs={NOW} onSyncNow={vi.fn()} />,
    );
    expect(screen.getByText('1 cambio sin enviar')).toBeDefined();
    renderAgain(
      <SyncIndicator
        status={{ ...idle, phase: 'syncing', pendingCount: 3 }}
        nowMs={NOW}
        onSyncNow={vi.fn()}
      />,
    );
    expect(screen.getByText('Enviando 3 cambios…')).toBeDefined();
    // While it sends there is nothing to press.
    expect(screen.queryByRole('button')).toBeNull();
    renderAgain(
      <SyncIndicator
        status={{ ...idle, phase: 'failing', pendingCount: 3 }}
        nowMs={NOW}
        onSyncNow={vi.fn()}
      />,
    );
    expect(screen.getByText('No pudimos sincronizar · 3 sin enviar')).toBeDefined();
    renderAgain(
      <SyncIndicator status={{ ...idle, phase: 'failing' }} nowMs={NOW} onSyncNow={vi.fn()} />,
    );
    expect(screen.getByText('No pudimos sincronizar')).toBeDefined();
  });

  it('announces a new kind of line to screen readers, not the same one again', () => {
    const announce = vi.spyOn(AccessibilityInfo, 'announceForAccessibility');
    announce.mockClear();
    const offline: SyncStatus = { ...idle, phase: 'offline', pendingCount: 1 };
    const wrap = (status: SyncStatus) => (
      <TranslatorProvider translator={translator}>
        <ThemeProvider
          value={{
            theme: nativeThemeFor(null, 'dark'),
            variant: 'dark',
            setVariant: () => undefined,
          }}
        >
          <SyncIndicator status={status} nowMs={NOW} onSyncNow={vi.fn()} />
        </ThemeProvider>
      </TranslatorProvider>
    );
    // The same tree each time, so the indicator stays mounted and sees the change.
    const { rerender } = render(wrap(idle));
    expect(announce).not.toHaveBeenCalled();
    rerender(wrap(offline));
    expect(announce).toHaveBeenCalledWith(
      `${t('status.warning')}: Sin conexión · 1 cambio sin enviar`,
    );
    rerender(wrap({ ...offline, pendingCount: 2 }));
    expect(announce).toHaveBeenCalledTimes(1);
    announce.mockRestore();
  });

  it('keeps prominent what needs the user: a pause and the changes not applied', () => {
    renderScreen(
      <SyncIndicator status={{ ...idle, phase: 'paused', pause: 'update' }} nowMs={NOW} />,
    );
    expect(screen.getByRole('alert').getAttribute('aria-label')).toBe(
      `${t('status.warning')}: ${t('sync.pausedForUpdate')}`,
    );
    renderAgain(<SyncIndicator status={{ ...idle, issueCount: 1 }} nowMs={NOW} />);
    expect(screen.getByRole('alert').getAttribute('aria-label')).toBe(
      `${t('status.critical')}: ${t('sync.issues.summary', { count: 1 })}`,
    );
  });

  it('shows on the account when it last synced and lets the user sync now', () => {
    const onSyncNow = vi.fn();
    renderScreen(<SyncIndicator status={idle} nowMs={NOW} detailed onSyncNow={onSyncNow} />);
    expect(screen.getByText(t('sync.lastSyncedMinutes', { count: 5 }))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('sync.now') }));
    expect(onSyncNow).toHaveBeenCalledTimes(1);
  });

  it('turns the account button off while it syncs and keeps it on while paused', () => {
    renderScreen(
      <SyncIndicator
        status={{ ...idle, phase: 'syncing' }}
        nowMs={NOW}
        detailed
        onSyncNow={vi.fn()}
      />,
    );
    expect(screen.getByText(t('sync.syncing'))).toBeDefined();
    expect(screen.getByRole('button', { name: t('sync.now') }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    const onSyncNow = vi.fn();
    renderAgain(
      <SyncIndicator
        status={{ ...idle, phase: 'paused', pause: 'session' }}
        nowMs={NOW}
        detailed
        onSyncNow={onSyncNow}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('sync.now') }));
    expect(onSyncNow).toHaveBeenCalledTimes(1);
  });
});

describe('SyncIssuesList', () => {
  it('names each change, says why and lets the user dismiss it', () => {
    const onDismiss = vi.fn();
    const onDismissAll = vi.fn();
    renderScreen(
      <SyncIssuesList
        issues={[
          issue(),
          issue({ id: 2, op: 'wellness.correct', kind: 'superseded', errorCode: null }),
        ]}
        onDismiss={onDismiss}
        onDismissAll={onDismissAll}
      />,
    );
    expect(screen.getByText(t('sync.op.wellness.submit'))).toBeDefined();
    expect(
      screen.getByText(t('sync.issue.rejected', { reason: t('sync.reason.conflict') })),
    ).toBeDefined();
    expect(screen.getByText(t('sync.issue.superseded'))).toBeDefined();
    fireEvent.click(screen.getAllByRole('button', { name: t('sync.issue.dismiss') })[0] as Element);
    expect(onDismiss).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: t('sync.issues.dismissAll') }));
    expect(onDismissAll).toHaveBeenCalled();
  });

  it('falls back to the shared error texts', () => {
    renderScreen(
      <SyncIssuesList
        issues={[issue({ errorCode: 'consent_required' }), issue({ id: 3, errorCode: 'teapot' })]}
        onDismiss={vi.fn()}
        onDismissAll={vi.fn()}
      />,
    );
    expect(
      screen.getByText(t('sync.issue.rejected', { reason: t('error.code.consent_required') })),
    ).toBeDefined();
    expect(
      screen.getByText(t('sync.issue.rejected', { reason: t('error.generic') })),
    ).toBeDefined();
  });
});

describe('AccountScreen with changes not sent', () => {
  it('warns that signing out loses them and asks to confirm', () => {
    const onSignOut = vi.fn();
    renderScreen(
      <AccountScreen
        email="ana@example.com"
        membership={COACH_AT_ORC}
        clubTheme={null}
        canChangeClub={false}
        version="1.0.0"
        offline={false}
        signingOut={false}
        pendingCount={2}
        confirmSignOut
        sync={<SyncIndicator status={{ ...idle, pendingCount: 2 }} nowMs={NOW} />}
        onChangeClub={vi.fn()}
        onSignOut={onSignOut}
      />,
    );
    expect(screen.getByText(t('account.signOut.pending', { count: 2 }))).toBeDefined();
    expect(screen.getByText(t('sync.title'))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('account.signOut.confirm') }));
    expect(onSignOut).toHaveBeenCalled();
  });
});
