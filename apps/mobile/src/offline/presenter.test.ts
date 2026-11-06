import { createTranslator } from '@sport-performance/i18n';
import { describe, expect, it } from 'vitest';
import type { SyncStatus } from './engine.ts';
import { quietSyncLine, syncAlerts, withSessionOffline } from './presenter.ts';

const translator = createTranslator();
const { t } = translator;
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

const idle: SyncStatus = {
  membershipId: 'm',
  phase: 'idle',
  pause: null,
  pendingCount: 0,
  issueCount: 0,
  lastSyncedAt: NOW - 60_000,
  nextAttemptAt: null,
};

describe('quietSyncLine', () => {
  it('says nothing when idle or syncing with nothing waiting', () => {
    expect(quietSyncLine(idle, translator)).toBeNull();
    expect(quietSyncLine({ ...idle, phase: 'syncing' }, translator)).toBeNull();
    expect(quietSyncLine({ ...idle, phase: 'syncing', lastSyncedAt: null }, translator)).toBeNull();
    expect(quietSyncLine({ ...idle, lastSyncedAt: null }, translator)).toBeNull();
  });

  it('puts no connection and what waits in one line', () => {
    expect(quietSyncLine({ ...idle, phase: 'offline', pendingCount: 3 }, translator)).toEqual({
      kind: 'offline',
      text: 'Sin conexión · 3 cambios sin enviar',
    });
    expect(quietSyncLine({ ...idle, phase: 'offline' }, translator)?.text).toBe('Sin conexión');
    expect(quietSyncLine({ ...idle, phase: 'offline', lastSyncedAt: null }, translator)?.text).toBe(
      t('sync.quiet.offlineNever'),
    );
  });

  it('says what waits, what it sends and that the server fails', () => {
    expect(quietSyncLine({ ...idle, pendingCount: 1 }, translator)).toEqual({
      kind: 'pending',
      text: '1 cambio sin enviar',
    });
    expect(quietSyncLine({ ...idle, phase: 'syncing', pendingCount: 2 }, translator)).toEqual({
      kind: 'sending',
      text: 'Enviando 2 cambios…',
    });
    expect(quietSyncLine({ ...idle, phase: 'failing' }, translator)?.text).toBe(
      'No pudimos sincronizar',
    );
    expect(quietSyncLine({ ...idle, phase: 'failing', pendingCount: 4 }, translator)?.text).toBe(
      'No pudimos sincronizar · 4 sin enviar',
    );
  });

  it('during a pause says only what waits (the pause has its own message)', () => {
    const paused: SyncStatus = { ...idle, phase: 'paused', pause: 'update' };
    expect(quietSyncLine(paused, translator)).toBeNull();
    expect(quietSyncLine({ ...paused, pendingCount: 2 }, translator)?.kind).toBe('pending');
  });
});

describe('syncAlerts', () => {
  it('has nothing to say when all is well, offline or failing', () => {
    expect(syncAlerts(idle, translator)).toEqual([]);
    expect(syncAlerts({ ...idle, phase: 'offline', pendingCount: 2 }, translator)).toEqual([]);
    expect(syncAlerts({ ...idle, phase: 'failing' }, translator)).toEqual([]);
  });

  it('keeps the pause and the changes not applied, most important first', () => {
    expect(
      syncAlerts({ ...idle, phase: 'paused', pause: 'session', issueCount: 2 }, translator),
    ).toEqual([
      { level: 'warning', text: t('sync.paused') },
      { level: 'critical', text: t('sync.issues.summary', { count: 2 }) },
    ]);
    expect(syncAlerts({ ...idle, phase: 'paused', pause: 'update' }, translator)).toEqual([
      { level: 'warning', text: t('sync.pausedForUpdate') },
    ]);
  });
});

describe('withSessionOffline', () => {
  it('says offline only while the engine has no fresher answer', () => {
    expect(withSessionOffline({ ...idle, phase: 'syncing' }, true).phase).toBe('offline');
    expect(withSessionOffline({ ...idle, lastSyncedAt: null }, true).phase).toBe('offline');
    // Idle after a sync: the engine reached the server.
    expect(withSessionOffline(idle, true)).toBe(idle);
  });

  it('never hides a pause or a failing server, and does nothing online', () => {
    const paused: SyncStatus = { ...idle, phase: 'paused', pause: 'session' };
    const failing: SyncStatus = { ...idle, phase: 'failing' };
    expect(withSessionOffline(paused, true)).toBe(paused);
    expect(withSessionOffline(failing, true)).toBe(failing);
    expect(withSessionOffline({ ...idle, phase: 'syncing' }, false).phase).toBe('syncing');
  });
});
