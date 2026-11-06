import { isMessageKey, type MessageKey, type Translator } from '@sport-performance/i18n';
import type { StatusLevel } from '@sport-performance/ui-tokens';
import type { SyncIssue, SyncStatus } from './engine.ts';

export interface StatusLine {
  readonly level: StatusLevel;
  readonly text: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "Sincronizado hace 5 minutos": relative, so it needs no time zone. */
export function lastSyncedText(lastSyncedAt: number | null, nowMs: number, { t }: Translator) {
  if (lastSyncedAt === null) return t('sync.never');
  const age = Math.max(0, nowMs - lastSyncedAt);
  if (age < MINUTE_MS) return t('sync.lastSyncedNow');
  if (age < HOUR_MS) return t('sync.lastSyncedMinutes', { count: Math.floor(age / MINUTE_MS) });
  if (age < DAY_MS) return t('sync.lastSyncedHours', { count: Math.floor(age / HOUR_MS) });
  return t('sync.lastSyncedDays', { count: Math.floor(age / DAY_MS) });
}

/** What the quiet sync line shows: drives its icon. */
export type QuietSyncKind = 'offline' | 'failing' | 'sending' | 'pending';

export interface QuietSyncLine {
  readonly kind: QuietSyncKind;
  readonly text: string;
}

/**
 * The status the indicator shows when the session could not reach the
 * server (`session.offline`, ADR 0103). It says "no connection" only while
 * the engine has no fresher answer: a cycle in flight, or idle without ever
 * having synced. A failing server, a pause or a no-connection the engine
 * found itself are never hidden, and an idle engine that synced already
 * reached the server (the session is refreshed then, `refreshSessionAfterSync`).
 */
export function withSessionOffline(status: SyncStatus, sessionOffline: boolean): SyncStatus {
  if (!sessionOffline) return status;
  const noAnswer =
    status.phase === 'syncing' || (status.phase === 'idle' && status.lastSyncedAt === null);
  return noAnswer ? { ...status, phase: 'offline' } : status;
}

/**
 * The one quiet line of the sync indicator (ADR 0103), or `null` when all is
 * well: idle with nothing waiting, or syncing with nothing waiting (a fresh
 * login's first sync included). No signal or a failing server say so along
 * with what waits; during a pause it says only what waits, since the pause
 * has its own message. "Never synced" shows only without signal.
 */
export function quietSyncLine(status: SyncStatus, { t }: Translator): QuietSyncLine | null {
  const count = status.pendingCount;
  switch (status.phase) {
    case 'offline':
      return {
        kind: 'offline',
        text:
          count === 0 && status.lastSyncedAt === null
            ? t('sync.quiet.offlineNever')
            : t('sync.quiet.offline', { count }),
      };
    case 'failing':
      return { kind: 'failing', text: t('sync.quiet.failed', { count }) };
    case 'syncing':
      return count === 0 ? null : { kind: 'sending', text: t('sync.quiet.sending', { count }) };
    case 'idle':
    case 'paused':
      return count === 0 ? null : { kind: 'pending', text: t('sync.pending', { count }) };
  }
}

/**
 * What needs the user to act, kept prominent (ADR 0103): a pause until an
 * app update or a new sign-in, and the changes the server did not apply.
 * Always text with the level's icon, never color alone.
 */
export function syncAlerts(status: SyncStatus, { t }: Translator): StatusLine[] {
  const lines: StatusLine[] = [];
  if (status.phase === 'paused') {
    lines.push({
      level: 'warning',
      text: status.pause === 'update' ? t('sync.pausedForUpdate') : t('sync.paused'),
    });
  }
  if (status.issueCount > 0) {
    lines.push({ level: 'critical', text: t('sync.issues.summary', { count: status.issueCount }) });
  }
  return lines;
}

function reasonKey(code: string | null): MessageKey {
  const own = `sync.reason.${code ?? ''}`;
  if (isMessageKey(own)) return own;
  const shared = `error.code.${code ?? ''}`;
  if (isMessageKey(shared)) return shared;
  return 'error.generic';
}

/** Title and explanation of an issue of the queue. */
export function syncIssueText(
  issue: SyncIssue,
  { t }: Translator,
): { title: string; body: string } {
  const opKey = `sync.op.${issue.op}`;
  const title = isMessageKey(opKey) ? t(opKey) : t('sync.title');
  if (issue.kind === 'superseded') return { title, body: t('sync.issue.superseded') };
  return { title, body: t('sync.issue.rejected', { reason: t(reasonKey(issue.errorCode)) }) };
}
