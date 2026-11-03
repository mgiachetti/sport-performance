// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SyncIssue, SyncStatus } from '../offline/engine.ts';
import { COACH_AT_ORC } from '../test/fixtures.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { AccountScreen } from './app.tsx';
import { SyncIndicator, SyncIssuesList } from './sync.tsx';

const { t } = translator;
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

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
  it('says everything is synced and when, without a retry button', () => {
    renderScreen(<SyncIndicator status={idle} nowMs={NOW} onSyncNow={vi.fn()} />);
    expect(
      screen.getByText(`${t('sync.synced')}. ${t('sync.lastSyncedMinutes', { count: 5 })}`),
    ).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows no signal, what waits to be sent and what failed, with icon and text', () => {
    const onSyncNow = vi.fn();
    renderScreen(
      <SyncIndicator
        status={{ ...idle, phase: 'offline', pendingCount: 3, issueCount: 1, nextAttemptAt: NOW }}
        nowMs={NOW}
        onSyncNow={onSyncNow}
      />,
    );
    const alerts = screen.getAllByRole('alert').map((node) => node.getAttribute('aria-label'));
    expect(alerts).toEqual([
      `${t('status.warning')}: ${t('sync.offline')}`,
      `${t('status.warning')}: ${t('sync.pending', { count: 3 })}`,
      `${t('status.critical')}: ${t('sync.issues.summary', { count: 1 })}`,
    ]);
    fireEvent.click(screen.getByRole('button', { name: t('sync.now') }));
    expect(onSyncNow).toHaveBeenCalled();
  });

  it('explains a pause for an update', () => {
    renderScreen(
      <SyncIndicator status={{ ...idle, phase: 'paused', pause: 'update' }} nowMs={NOW} />,
    );
    expect(screen.getByText(t('sync.pausedForUpdate'))).toBeDefined();
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
