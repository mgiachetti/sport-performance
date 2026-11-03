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

/**
 * The one line of an idle queue with nothing waiting (one ICU message, so it
 * never says "all synced" next to "never synced"): when it last synced, or
 * that this phone never did yet.
 */
export function idleSummary(
  lastSyncedAt: number | null,
  nowMs: number,
  { t }: Translator,
): StatusLine {
  if (lastSyncedAt === null) {
    return { level: 'warning', text: t('sync.idleSummary', { since: 'never', count: 0 }) };
  }
  const age = Math.max(0, nowMs - lastSyncedAt);
  const [since, count] =
    age < MINUTE_MS
      ? (['now', 0] as const)
      : age < HOUR_MS
        ? (['minutes', Math.floor(age / MINUTE_MS)] as const)
        : age < DAY_MS
          ? (['hours', Math.floor(age / HOUR_MS)] as const)
          : (['days', Math.floor(age / DAY_MS)] as const);
  return { level: 'ok', text: t('sync.idleSummary', { since, count }) };
}

/**
 * What the sync indicator says (ADR 0069), most important first: a pause,
 * no signal or a failing server, then what waits to be sent and what could
 * not be applied. Always text with the level's icon, never color alone.
 */
export function syncStatusLines(
  status: SyncStatus,
  nowMs: number,
  translator: Translator,
): StatusLine[] {
  const { t } = translator;
  const lines: StatusLine[] = [];
  if (status.phase === 'paused') {
    lines.push({
      level: 'warning',
      text: status.pause === 'update' ? t('sync.pausedForUpdate') : t('sync.paused'),
    });
  } else if (status.phase === 'offline') {
    lines.push({ level: 'warning', text: t('sync.offline') });
  } else if (status.phase === 'failing') {
    lines.push({ level: 'warning', text: t('sync.failed') });
  } else if (status.phase === 'syncing') {
    lines.push({ level: 'ok', text: t('sync.syncing') });
  }
  if (status.pendingCount > 0) {
    lines.push({ level: 'warning', text: t('sync.pending', { count: status.pendingCount }) });
  } else if (status.phase === 'idle') {
    lines.push(idleSummary(status.lastSyncedAt, nowMs, translator));
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
