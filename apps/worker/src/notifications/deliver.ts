import {
  DEFAULT_RPE_WINDOW,
  allowedHoursFor,
  isMinorOn,
  isUndeliverableEmail,
  nextAllowedInstant,
  rpeSubmissionWindow,
  type AllowedHours,
  type ClubId,
  type LocalDate,
  type NotificationChannel,
  type NotificationKind,
  type NotificationSkipReason,
  type ParticipationStatus,
  type PlayerId,
  participationCarriesLoad,
} from '@sport-performance/domain';
import {
  EmailDeliveryError,
  NotificationEmail,
  renderEmail,
  type EmailTransport,
} from '@sport-performance/email';
import { createTranslator, type Translator } from '@sport-performance/i18n';
import type pg from 'pg';
import type { Logger } from 'pino';
import { createElement } from 'react';
import { inClubTransaction, type ClubTransaction } from '../database.js';
import {
  ClubPreferences,
  currentOn,
  playersWithDataConsent,
  staffOfCategories,
  staffOfPlayers,
  type NotificationClub,
} from './club.js';
import { isPlayerKind, notificationContent, type NotificationContent } from './content.js';
import {
  DEVICE_NOT_REGISTERED,
  PushDeliveryError,
  type PushMessage,
  type PushService,
  type PushTicket,
} from './expo.js';

/**
 * Delivery (B-328, ADR 0054), at least once and bounded:
 *
 * 1. In a transaction, due rows are claimed (`FOR UPDATE SKIP LOCKED`),
 *    checked again (`skipped` with the reason when they no longer apply,
 *    moved to the next opening when outside the recipient's allowed hours),
 *    given their text and destinations, and marked `sending`.
 * 2. Outside any transaction, the providers are called.
 * 3. In a second transaction, the results: `sent`, a retry later, or
 *    `failed` after {@link MAX_NOTIFICATION_ATTEMPTS}.
 *
 * A worker that dies between 1 and 3 leaves rows `sending`: after
 * {@link STUCK_SENDING_MS} they go back to `pending` (or fail, out of
 * attempts). Nothing personal is logged: ids and provider codes only.
 */

export const MAX_NOTIFICATION_ATTEMPTS = 3;
/** A row `sending` for longer than this was interrupted. */
export const STUCK_SENDING_MS = 10 * 60_000;
/** Wait before a retry, times the attempt number. */
export const RETRY_DELAY_MS = 5 * 60_000;
/** Rows claimed per round. */
export const CLAIM_BATCH = 200;
/** Expo asks to read receipts some minutes after sending; they are kept about a day. */
export const RECEIPT_DELAY_MS = 15 * 60_000;
export const RECEIPT_MAX_AGE_MS = 24 * 60 * 60_000;
/** Deliveries are kept this long, then the worker deletes them. */
export const NOTIFICATION_RETENTION_DAYS = 90;
/** Expo codes worth retrying: the rest are final. */
const TRANSIENT_PUSH_CODES = new Set(['MessageRateExceeded', 'NetworkError', 'InvalidResponse']);

export interface DeliveryDependencies {
  readonly pool: pg.Pool;
  readonly logger: Logger;
  readonly push: PushService;
  readonly email: EmailTransport;
  /** Base URL of the web app, without the trailing slash (links of the emails). */
  readonly webAppUrl: string;
}

interface DueRow {
  readonly id: string;
  readonly user_id: string;
  readonly kind: NotificationKind;
  readonly channel: NotificationChannel;
  readonly attempts: number;
  readonly player_id: PlayerId | null;
  readonly training_session_id: string | null;
  readonly alert_id: string | null;
}

interface Claimed {
  readonly row: DueRow;
  readonly content: NotificationContent;
  /** Push: the devices; email: the address. */
  readonly tokens: readonly { readonly id: string; readonly token: string }[];
  readonly emailTo: string | null;
}

type Outcome =
  | { readonly kind: 'sent' }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'failed'; readonly code: string };

interface TicketRecord {
  readonly notificationId: string;
  readonly pushTokenId: string;
  readonly ticket: PushTicket;
}

export interface DeliveryReport {
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
  readonly retried: number;
  /** Due outside the recipient's allowed hours: moved to the next opening. */
  readonly deferred: number;
  /** More due rows than one round claims. */
  readonly more: boolean;
}

// ---------------------------------------------------------------------------
// The checks of step 1, in bulk

interface SessionFacts {
  readonly kind: 'training' | 'match';
  readonly startsAt: Date;
  readonly localDate: LocalDate;
  readonly archived: boolean;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
}

interface PlayerFacts {
  readonly userId: string | null;
  readonly leftOn: LocalDate | null;
  readonly birthDate: LocalDate;
}

interface Facts {
  readonly sessions: Map<string, SessionFacts>;
  readonly participations: Map<string, { status: ParticipationStatus; rpe: number | null }>;
  readonly players: Map<PlayerId, PlayerFacts>;
  /** `session|player` of the players in the session's category on its day. */
  readonly inSessionCategory: Set<string>;
  readonly consented: Set<PlayerId>;
  /** Active roles of each recipient in the club. */
  readonly roles: Map<string, Set<string>>;
  readonly alerts: Map<string, { open: boolean; critical: boolean; playerId: PlayerId }>;
  readonly playerCategoryName: Map<PlayerId, string>;
  readonly staffOfPlayer: Map<PlayerId, Set<string>>;
  readonly staffOfCategory: Map<string, Set<string>>;
  readonly summaries: Map<string, SummaryCounts>;
}

interface SummaryCounts {
  readonly players: number;
  readonly wellnessSubmitted: number;
  readonly criticalAlerts: number;
  readonly warningAlerts: number;
}

const unique = <T>(values: readonly (T | null)[]): T[] => [
  ...new Set(values.filter((v): v is T => v !== null)),
];

async function readFacts(
  tx: ClubTransaction,
  club: NotificationClub,
  rows: readonly DueRow[],
  now: Date,
): Promise<Facts> {
  const q = tx.client;
  const sessionIds = unique(rows.map((r) => r.training_session_id));
  const alertIds = unique(rows.map((r) => r.alert_id));
  const userIds = unique(rows.map((r) => r.user_id));

  const sessions = new Map<string, SessionFacts>();
  if (sessionIds.length > 0) {
    const { rows: found } = await q.query<{
      id: string;
      kind: 'training' | 'match';
      starts_at: Date;
      local_date: LocalDate;
      archived: boolean;
      category_id: string | null;
      category_name: string | null;
    }>(
      `select s.id, s.kind, s.starts_at, s.local_date::text as local_date,
              s.archived_at is not null as archived, s.category_id, c.name as category_name
         from training_session s
         left join category c on c.club_id = s.club_id and c.id = s.category_id
        where s.id = any($1::uuid[])`,
      [sessionIds],
    );
    for (const s of found) {
      sessions.set(s.id, {
        kind: s.kind,
        startsAt: s.starts_at,
        localDate: s.local_date,
        archived: s.archived,
        categoryId: s.category_id,
        categoryName: s.category_name,
      });
    }
  }

  const alerts = new Map<string, { open: boolean; critical: boolean; playerId: PlayerId }>();
  if (alertIds.length > 0) {
    const { rows: found } = await q.query<{
      id: string;
      status: string;
      current_severity: string;
      resolved_on: LocalDate | null;
      player_id: PlayerId;
    }>(
      `select id, status, current_severity, resolved_on, player_id
         from alert where id = any($1::uuid[])`,
      [alertIds],
    );
    for (const a of found) {
      alerts.set(a.id, {
        // Still active and not reviewed: an acknowledged or resolved episode is not notified.
        open: a.status === 'open' && a.resolved_on === null,
        critical: a.current_severity === 'critical',
        playerId: a.player_id,
      });
    }
  }

  const playerIds = unique([
    ...rows.map((r) => r.player_id),
    ...[...alerts.values()].map((a) => a.playerId),
  ]);
  const players = new Map<PlayerId, PlayerFacts>();
  if (playerIds.length > 0) {
    const { rows: found } = await q.query<{
      id: PlayerId;
      user_id: string | null;
      left_on: LocalDate | null;
      birth_date: LocalDate;
    }>(
      `select id, user_id, left_on::text as left_on, birth_date::text as birth_date
         from player where id = any($1::uuid[])`,
      [playerIds],
    );
    for (const p of found) {
      players.set(p.id, { userId: p.user_id, leftOn: p.left_on, birthDate: p.birth_date });
    }
  }

  // The session's category on its day, as the planning reads it (`rpeCandidates`).
  const inSessionCategory = new Set<string>();
  const rpeRows = rows.filter((r) => isPlayerKind(r.kind));
  const rpeSessions = unique(rpeRows.map((r) => r.training_session_id));
  const rpeRowPlayers = unique(rpeRows.map((r) => r.player_id));
  if (rpeSessions.length > 0 && rpeRowPlayers.length > 0) {
    const { rows: found } = await q.query<{ session_id: string; player_id: PlayerId }>(
      `select distinct s.id as session_id, pc.player_id
         from training_session s
         join player_category pc on pc.club_id = s.club_id and pc.category_id = s.category_id
                                and ${currentOn('pc', 's.local_date')}
        where s.id = any($1::uuid[]) and pc.player_id = any($2::uuid[])`,
      [rpeSessions, rpeRowPlayers],
    );
    for (const r of found) inSessionCategory.add(`${r.session_id}|${r.player_id}`);
  }

  const participations = new Map<string, { status: ParticipationStatus; rpe: number | null }>();
  if (sessionIds.length > 0 && playerIds.length > 0) {
    const { rows: found } = await q.query<{
      training_session_id: string;
      player_id: PlayerId;
      status: ParticipationStatus;
      rpe: number | null;
    }>(
      `select training_session_id, player_id, status, rpe from participation
        where training_session_id = any($1::uuid[]) and player_id = any($2::uuid[])`,
      [sessionIds, playerIds],
    );
    for (const p of found) {
      participations.set(`${p.training_session_id}|${p.player_id}`, {
        status: p.status,
        rpe: p.rpe,
      });
    }
  }

  const rpePlayers = new Map<PlayerId, LocalDate>();
  for (const r of rows) {
    const player = r.player_id === null ? undefined : players.get(r.player_id);
    if (isPlayerKind(r.kind) && r.player_id !== null && player !== undefined) {
      rpePlayers.set(r.player_id, player.birthDate);
    }
  }
  const consented = await playersWithDataConsent(tx, rpePlayers, now, club.today);

  const roles = new Map<string, Set<string>>();
  if (userIds.length > 0) {
    const { rows: found } = await q.query<{ user_id: string; role: string }>(
      `select user_id, role::text as role from membership
        where user_id = any($1::text[]) and ended_at is null`,
      [userIds],
    );
    for (const m of found) {
      const set = roles.get(m.user_id) ?? new Set<string>();
      set.add(m.role);
      roles.set(m.user_id, set);
    }
  }

  const alertPlayers = unique([...alerts.values()].map((a) => a.playerId));
  const playerCategoryName = new Map<PlayerId, string>();
  if (alertPlayers.length > 0) {
    const { rows: found } = await q.query<{ player_id: PlayerId; name: string }>(
      `select distinct on (pc.player_id) pc.player_id, c.name
         from player_category pc
         join category c on c.club_id = pc.club_id and c.id = pc.category_id
        where pc.player_id = any($1::uuid[]) and ${currentOn('pc', '$2')}
        order by pc.player_id, c.name`,
      [alertPlayers, club.today],
    );
    for (const p of found) playerCategoryName.set(p.player_id, p.name);
  }

  const summarySessions = unique(
    rows.filter((r) => r.kind === 'pre_training_summary').map((r) => r.training_session_id),
  );
  const summaryCategories = unique(
    summarySessions.map((id) => sessions.get(id)?.categoryId ?? null),
  );
  const summaries = new Map<string, SummaryCounts>();
  for (const sessionId of summarySessions) {
    const session = sessions.get(sessionId);
    if (session === undefined || session.categoryId === null) continue;
    const { rows: counts } = await q.query<{
      players: number;
      wellness: number;
      critical: number;
      warning: number;
    }>(
      `with roster as (
         select distinct pc.player_id from player_category pc
           join player p on p.club_id = pc.club_id and p.id = pc.player_id and p.left_on is null
          where pc.category_id = $1 and ${currentOn('pc', '$2')}
       )
       select (select count(*)::int from roster) as players,
              (select count(*)::int from wellness w
                where w.player_id in (select player_id from roster) and w.local_date = $2::date) as wellness,
              (select count(distinct a.player_id)::int from alert a
                where a.player_id in (select player_id from roster) and a.status = 'open'
                  and a.resolved_on is null and a.current_severity = 'critical') as critical,
              (select count(distinct a.player_id)::int from alert a
                where a.player_id in (select player_id from roster) and a.status = 'open'
                  and a.resolved_on is null and a.current_severity = 'warning'
                  and not exists (select 1 from alert c where c.player_id = a.player_id
                                    and c.status = 'open' and c.resolved_on is null
                                    and c.current_severity = 'critical')) as warning`,
      [session.categoryId, session.localDate],
    );
    const c = counts[0];
    if (c !== undefined) {
      summaries.set(sessionId, {
        players: c.players,
        wellnessSubmitted: c.wellness,
        criticalAlerts: c.critical,
        warningAlerts: c.warning,
      });
    }
  }

  return {
    sessions,
    participations,
    players,
    inSessionCategory,
    consented,
    roles,
    alerts,
    playerCategoryName,
    staffOfPlayer: await staffOfPlayers(tx, alertPlayers, club.today),
    staffOfCategory: await staffOfCategories(tx, summaryCategories, club.today),
    summaries,
  };
}

type Checked =
  | { readonly skip: NotificationSkipReason }
  | { readonly defer: Date }
  | { readonly content: NotificationContent };

/**
 * Why a due row no longer applies, when it has to wait, or its text. The
 * recipient's allowed hours (the minors' window for a minor player) are
 * checked here, at delivery, and not only when planning: a retry, a row
 * recovered from an interrupted run or a backlog after an outage never goes
 * out at a closed hour. Outside the hours the row waits for the next
 * opening, or is skipped when that opening comes too late for it.
 */
function check(
  row: DueRow,
  club: NotificationClub,
  facts: Facts,
  preferences: ClubPreferences,
  now: Date,
  t: Translator['t'],
): Checked {
  const result = applies(row, club, facts, preferences, now, t);
  if (!('content' in result)) return result;
  const opening = nextAllowedInstant(now, club.timeZone, result.hours);
  if (opening.getTime() <= now.getTime()) return { content: result.content };
  if (result.deadline !== undefined && opening >= result.deadline.at) {
    return { skip: result.deadline.reason };
  }
  return { defer: opening };
}

interface Applies {
  readonly content: NotificationContent;
  /** The recipient's allowed hours. */
  readonly hours: AllowedHours;
  /** After this instant it makes no sense any more (the RPE window closes, the session starts). */
  readonly deadline?: { readonly at: Date; readonly reason: NotificationSkipReason };
}

/** Why a due row no longer applies, or its text and the recipient's hours. */
function applies(
  row: DueRow,
  club: NotificationClub,
  facts: Facts,
  preferences: ClubPreferences,
  now: Date,
  t: Translator['t'],
): { skip: NotificationSkipReason } | Applies {
  if (!preferences.isOn(row.user_id, row.kind, row.channel)) return { skip: 'preference_off' };
  const roles = facts.roles.get(row.user_id) ?? new Set<string>();
  switch (row.kind) {
    case 'rpe_request':
    case 'rpe_reminder': {
      const session =
        row.training_session_id === null ? undefined : facts.sessions.get(row.training_session_id);
      const player = row.player_id === null ? undefined : facts.players.get(row.player_id);
      if (session === undefined || row.player_id === null || player === undefined) {
        return { skip: 'not_a_recipient' };
      }
      if (session.archived) return { skip: 'session_archived' };
      const window = rpeSubmissionWindow(session, club.timeZone, DEFAULT_RPE_WINDOW);
      if (now >= window.closesAt) return { skip: 'window_closed' };
      // Still the player's own account (the account may have been unlinked or moved).
      if (!roles.has('player') || player.leftOn !== null || player.userId !== row.user_id) {
        return { skip: 'not_a_recipient' };
      }
      const key = `${row.training_session_id ?? ''}|${row.player_id}`;
      const participation = facts.participations.get(key);
      // In the session's category on its day, or with a participation recorded (as when planned).
      if (participation === undefined && !facts.inSessionCategory.has(key)) {
        return { skip: 'not_a_recipient' };
      }
      if (participation !== undefined && !participationCarriesLoad(participation.status)) {
        return { skip: 'not_a_recipient' };
      }
      if (participation !== undefined && participation.rpe !== null) {
        return { skip: 'already_answered' };
      }
      if (!facts.consented.has(row.player_id)) return { skip: 'consent_missing' };
      return {
        content: notificationContent(t, club, {
          kind: row.kind,
          sessionId: row.training_session_id ?? '',
          sessionKind: session.kind,
        }),
        hours: allowedHoursFor(club.settings, isMinorOn(player.birthDate, club.today)),
        deadline: { at: window.closesAt, reason: 'window_closed' },
      };
    }
    case 'critical_alert': {
      const alert = row.alert_id === null ? undefined : facts.alerts.get(row.alert_id);
      if (!alert?.open || !alert.critical) return { skip: 'alert_resolved' };
      const player = facts.players.get(alert.playerId);
      if (player?.leftOn !== null) return { skip: 'not_a_recipient' };
      if (!(facts.staffOfPlayer.get(alert.playerId)?.has(row.user_id) ?? false)) {
        return { skip: 'not_a_recipient' };
      }
      return {
        content: notificationContent(t, club, {
          kind: 'critical_alert',
          alertId: row.alert_id ?? '',
          categoryName: facts.playerCategoryName.get(alert.playerId) ?? '',
        }),
        // Waits for the opening; it is checked again then (skipped if reviewed or resolved).
        hours: club.settings.allowedHours,
      };
    }
    case 'pre_training_summary': {
      const session =
        row.training_session_id === null ? undefined : facts.sessions.get(row.training_session_id);
      if (session === undefined || session.categoryId === null) return { skip: 'not_a_recipient' };
      if (session.archived) return { skip: 'session_archived' };
      if (now >= session.startsAt) return { skip: 'session_started' };
      if (!(facts.staffOfCategory.get(session.categoryId)?.has(row.user_id) ?? false)) {
        return { skip: 'not_a_recipient' };
      }
      const counts = facts.summaries.get(row.training_session_id ?? '') ?? {
        players: 0,
        wellnessSubmitted: 0,
        criticalAlerts: 0,
        warningAlerts: 0,
      };
      return {
        content: notificationContent(t, club, {
          kind: 'pre_training_summary',
          sessionId: row.training_session_id ?? '',
          sessionKind: session.kind,
          categoryName: session.categoryName ?? '',
          startsAt: session.startsAt,
          criticalAlerts: counts.criticalAlerts,
          warningAlerts: counts.warningAlerts,
          wellness: club.modules.wellness
            ? { submitted: counts.wellnessSubmitted, players: counts.players }
            : null,
        }),
        hours: club.settings.allowedHours,
        deadline: { at: session.startsAt, reason: 'session_started' },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Step 1: claim

/** Rows left `sending` by an interrupted run go back to `pending`, or fail out of attempts. */
async function recoverInterrupted(tx: ClubTransaction, now: Date): Promise<void> {
  const before = new Date(now.getTime() - STUCK_SENDING_MS);
  await tx.client.query(
    `update notification set status = 'failed', failure_code = 'Interrupted'
      where status = 'sending' and last_attempt_at < $1 and attempts >= $2`,
    [before, MAX_NOTIFICATION_ATTEMPTS],
  );
  await tx.client.query(
    `update notification set status = 'pending', scheduled_for = $3, failure_code = 'Interrupted'
      where status = 'sending' and last_attempt_at < $1 and attempts < $2`,
    [before, MAX_NOTIFICATION_ATTEMPTS, now],
  );
}

interface ClaimResult {
  readonly claimed: Claimed[];
  readonly skipped: number;
  readonly deferred: number;
  readonly more: boolean;
}

async function claim(
  tx: ClubTransaction,
  club: NotificationClub,
  preferences: ClubPreferences,
  now: Date,
  t: Translator['t'],
): Promise<ClaimResult> {
  await recoverInterrupted(tx, now);
  const { rows } = await tx.client.query<DueRow>(
    `select id, user_id, kind, channel, attempts, player_id, training_session_id, alert_id
       from notification
      where status = 'pending' and scheduled_for <= $1
      order by scheduled_for, id
      limit $2
      for update skip locked`,
    [now, CLAIM_BATCH + 1],
  );
  const more = rows.length > CLAIM_BATCH;
  const due = rows.slice(0, CLAIM_BATCH);
  if (due.length === 0) return { claimed: [], skipped: 0, deferred: 0, more: false };

  const facts = await readFacts(tx, club, due, now);
  const pushUsers = unique(due.filter((r) => r.channel === 'push').map((r) => r.user_id));
  const tokens = new Map<string, { id: string; token: string }[]>();
  if (pushUsers.length > 0) {
    const { rows: found } = await tx.client.query<{ id: string; user_id: string; token: string }>(
      'select id, user_id, token from app.worker_push_tokens($1::text[])',
      [pushUsers],
    );
    for (const row of found) {
      tokens.set(row.user_id, [
        ...(tokens.get(row.user_id) ?? []),
        { id: row.id, token: row.token },
      ]);
    }
  }
  const emailUsers = unique(due.filter((r) => r.channel === 'email').map((r) => r.user_id));
  const emails = new Map<string, string>();
  if (emailUsers.length > 0) {
    const { rows: found } = await tx.client.query<{ id: string; email: string }>(
      'select id, email from "user" where id = any($1::text[])',
      [emailUsers],
    );
    for (const row of found) emails.set(row.id, row.email);
  }

  const claimed: Claimed[] = [];
  const skips = new Map<NotificationSkipReason, string[]>();
  const skip = (id: string, reason: NotificationSkipReason) => {
    skips.set(reason, [...(skips.get(reason) ?? []), id]);
  };
  const deferred = new Map<number, string[]>();
  for (const row of due) {
    const result = check(row, club, facts, preferences, now, t);
    if ('skip' in result) {
      skip(row.id, result.skip);
      continue;
    }
    if ('defer' in result) {
      const at = result.defer.getTime();
      deferred.set(at, [...(deferred.get(at) ?? []), row.id]);
      continue;
    }
    if (row.channel === 'push') {
      const devices = tokens.get(row.user_id) ?? [];
      if (devices.length === 0) {
        skip(row.id, 'no_destination');
        continue;
      }
      claimed.push({ row, content: result.content, tokens: devices, emailTo: null });
    } else {
      const address = emails.get(row.user_id);
      if (address === undefined || isUndeliverableEmail(address)) {
        skip(row.id, 'no_destination');
        continue;
      }
      claimed.push({ row, content: result.content, tokens: [], emailTo: address });
    }
  }

  let skipped = 0;
  for (const [reason, ids] of skips) {
    skipped += ids.length;
    await tx.client.query(
      `update notification set status = 'skipped', skip_reason = $2, last_attempt_at = $3
        where id = any($1::uuid[])`,
      [ids, reason, now],
    );
  }
  // Outside the recipient's hours: back to waiting, until the next opening.
  let deferredCount = 0;
  for (const [at, ids] of deferred) {
    deferredCount += ids.length;
    await tx.client.query(`update notification set scheduled_for = $2 where id = any($1::uuid[])`, [
      ids,
      new Date(at),
    ]);
  }
  if (claimed.length > 0) {
    await tx.client.query(
      `update notification set status = 'sending', attempts = attempts + 1, last_attempt_at = $2
        where id = any($1::uuid[])`,
      [claimed.map((c) => c.row.id), now],
    );
  }
  return { claimed, skipped, deferred: deferredCount, more };
}

// ---------------------------------------------------------------------------
// Step 2: send

async function sendPush(
  push: PushService,
  club: NotificationClub,
  claimed: readonly Claimed[],
  outcomes: Map<string, Outcome>,
  tickets: TicketRecord[],
  logger: Logger,
): Promise<void> {
  const messages: PushMessage[] = [];
  const owners: { notificationId: string; pushTokenId: string }[] = [];
  for (const c of claimed) {
    for (const device of c.tokens) {
      messages.push({
        to: device.token,
        title: c.content.title,
        body: c.content.body,
        priority: c.content.priority,
        data: {
          kind: c.row.kind,
          clubId: club.clubId,
          notificationId: c.row.id,
          path: c.content.path,
        },
      });
      owners.push({ notificationId: c.row.id, pushTokenId: device.id });
    }
  }
  if (messages.length === 0) return;
  let sent: PushTicket[];
  try {
    sent = await push.send(messages);
  } catch (error) {
    const code = error instanceof PushDeliveryError ? error.code : 'UnknownError';
    logger.warn({ clubId: club.clubId, code, messages: messages.length }, 'push send failed');
    for (const c of claimed) outcomes.set(c.row.id, { kind: 'retry', code });
    return;
  }
  const results: TicketRecord[] = [];
  sent.forEach((ticket, index) => {
    const owner = owners[index];
    if (owner === undefined) return;
    results.push({ ...owner, ticket });
    // Only what Expo took has a ticket to store; an unsent message is retried.
    if (ticket.status !== 'unsent') tickets.push({ ...owner, ticket });
  });
  const unsent = results.filter((r) => r.ticket.status === 'unsent');
  if (unsent.length > 0) {
    logger.warn({ clubId: club.clubId, messages: unsent.length }, 'push send partly failed');
  }
  for (const c of claimed) {
    const own = results.filter((t) => t.notificationId === c.row.id).map((t) => t.ticket);
    // Sent when one device took it: retrying the others would repeat it on that one.
    if (own.some((t) => t.status === 'ok')) {
      outcomes.set(c.row.id, { kind: 'sent' });
      continue;
    }
    const notSent = own.find((t) => t.status === 'unsent');
    if (notSent !== undefined) {
      outcomes.set(c.row.id, { kind: 'retry', code: notSent.code });
      continue;
    }
    const codes = own.flatMap((t) => (t.status === 'error' ? [t.code] : []));
    const transient = codes.find((code) => TRANSIENT_PUSH_CODES.has(code));
    outcomes.set(
      c.row.id,
      transient === undefined
        ? { kind: 'failed', code: codes[0] ?? 'UnknownError' }
        : { kind: 'retry', code: transient },
    );
  }
}

async function sendEmails(
  email: EmailTransport,
  webAppUrl: string,
  t: Translator['t'],
  claimed: readonly Claimed[],
  outcomes: Map<string, Outcome>,
): Promise<void> {
  const appName = t('email.appName');
  for (const c of claimed) {
    if (c.emailTo === null) continue;
    const { webPath } = c.content;
    try {
      const { html, text } = await renderEmail(
        createElement(NotificationEmail, {
          preview: c.content.body,
          heading: c.content.title,
          body: c.content.body,
          action:
            webPath === null
              ? { kind: 'app', text: t('email.notification.openApp') }
              : {
                  kind: 'web',
                  url: `${webAppUrl}${webPath}`,
                  cta: t('email.notification.cta'),
                },
          preferences: t('email.notification.preferences'),
          footer: t('email.footer', { appName }),
        }),
      );
      await email.send({
        to: c.emailTo,
        subject: c.content.title,
        html,
        text,
        kind: 'notification',
      });
      outcomes.set(c.row.id, { kind: 'sent' });
    } catch (error) {
      outcomes.set(c.row.id, {
        kind: 'retry',
        code: error instanceof EmailDeliveryError ? 'EmailDeliveryError' : 'UnknownError',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Step 3: record

async function record(
  tx: ClubTransaction,
  claimed: readonly Claimed[],
  outcomes: ReadonlyMap<string, Outcome>,
  tickets: readonly TicketRecord[],
  now: Date,
): Promise<{ sent: number; failed: number; retried: number }> {
  let sent = 0;
  let failed = 0;
  let retried = 0;
  for (const c of claimed) {
    const outcome = outcomes.get(c.row.id) ?? { kind: 'retry', code: 'Unsent' };
    const attempts = c.row.attempts + 1;
    if (outcome.kind === 'sent') {
      sent += 1;
      await tx.client.query(
        `update notification set status = 'sent', sent_at = $2, failure_code = null where id = $1`,
        [c.row.id, now],
      );
    } else if (outcome.kind === 'retry' && attempts < MAX_NOTIFICATION_ATTEMPTS) {
      retried += 1;
      await tx.client.query(
        `update notification set status = 'pending', scheduled_for = $2, failure_code = $3 where id = $1`,
        [c.row.id, new Date(now.getTime() + RETRY_DELAY_MS * attempts), outcome.code],
      );
    } else {
      failed += 1;
      await tx.client.query(
        `update notification set status = 'failed', failure_code = $2 where id = $1`,
        [c.row.id, outcome.code],
      );
    }
  }
  for (const record of tickets) {
    const { ticket } = record;
    if (ticket.status === 'unsent') continue;
    await tx.client.query(
      `insert into push_ticket (club_id, notification_id, push_token_id, ticket_id, status, error_code)
       values (app.current_club_id(), $1, $2, $3, $4, $5)`,
      [
        record.notificationId,
        record.pushTokenId,
        ticket.status === 'ok' ? ticket.id : null,
        ticket.status === 'ok' ? 'pending' : 'error',
        ticket.status === 'ok' ? null : ticket.code,
      ],
    );
    if (ticket.status === 'error' && ticket.code === DEVICE_NOT_REGISTERED) {
      await tx.client.query('select app.worker_forget_push_token($1)', [record.pushTokenId]);
    }
  }
  return { sent, failed, retried };
}

// ---------------------------------------------------------------------------
// The club's run

const translators = new Map<string, Translator>();
function translatorFor(club: NotificationClub): Translator {
  let translator = translators.get(club.locale);
  if (translator === undefined) {
    translator = createTranslator({ locale: club.locale });
    translators.set(club.locale, translator);
  }
  return translator;
}

/** One round of deliveries of a club (at most {@link CLAIM_BATCH}). */
export async function deliverDue(
  deps: DeliveryDependencies,
  club: NotificationClub,
  now: Date,
  requestId: string | undefined,
): Promise<DeliveryReport> {
  const { t } = translatorFor(club);
  const { claimed, skipped, deferred, more } = await inClubTransaction(
    deps.pool,
    club.clubId,
    async (tx) => claim(tx, club, await ClubPreferences.read(tx), now, t),
    { requestId },
  );
  if (claimed.length === 0) return { sent: 0, skipped, deferred, failed: 0, retried: 0, more };

  const outcomes = new Map<string, Outcome>();
  const tickets: TicketRecord[] = [];
  await sendPush(
    deps.push,
    club,
    claimed.filter((c) => c.row.channel === 'push'),
    outcomes,
    tickets,
    deps.logger,
  );
  await sendEmails(
    deps.email,
    deps.webAppUrl,
    t,
    claimed.filter((c) => c.row.channel === 'email'),
    outcomes,
  );
  const counts = await inClubTransaction(
    deps.pool,
    club.clubId,
    (tx) => record(tx, claimed, outcomes, tickets, now),
    { requestId },
  );
  return { ...counts, skipped, deferred, more };
}

/**
 * Reads the receipts of the tickets sent some minutes ago: `DeviceNotRegistered`
 * forgets the token. A ticket without a receipt after a day is closed.
 */
export async function checkReceipts(
  deps: Pick<DeliveryDependencies, 'pool' | 'push' | 'logger'>,
  clubId: ClubId,
  now: Date,
  requestId: string | undefined,
): Promise<number> {
  const pending = await inClubTransaction(
    deps.pool,
    clubId,
    async ({ client }) =>
      (
        await client.query<{
          id: string;
          ticket_id: string;
          push_token_id: string | null;
          created_at: Date;
        }>(
          `select id, ticket_id, push_token_id, created_at from push_ticket
            where status = 'pending' and created_at <= $1
            order by created_at limit 1000`,
          [new Date(now.getTime() - RECEIPT_DELAY_MS)],
        )
      ).rows,
    { requestId },
  );
  if (pending.length === 0) return 0;
  let receipts;
  try {
    receipts = await deps.push.receipts(pending.map((p) => p.ticket_id));
  } catch (error) {
    const code = error instanceof PushDeliveryError ? error.code : 'UnknownError';
    deps.logger.warn({ clubId, code }, 'push receipts failed');
    return 0;
  }
  return inClubTransaction(
    deps.pool,
    clubId,
    async ({ client }) => {
      let checked = 0;
      for (const ticket of pending) {
        const receipt = receipts.get(ticket.ticket_id);
        const stale = now.getTime() - ticket.created_at.getTime() > RECEIPT_MAX_AGE_MS;
        if (receipt === undefined && !stale) continue;
        checked += 1;
        const status = receipt === undefined || receipt.status === 'error' ? 'error' : 'ok';
        const code =
          receipt === undefined
            ? 'ReceiptUnavailable'
            : receipt.status === 'error'
              ? receipt.code
              : null;
        await client.query(
          `update push_ticket set status = $2, error_code = $3, receipt_checked_at = $4 where id = $1`,
          [ticket.id, status, code, now],
        );
        if (code === DEVICE_NOT_REGISTERED && ticket.push_token_id !== null) {
          await client.query('select app.worker_forget_push_token($1)', [ticket.push_token_id]);
        }
      }
      return checked;
    },
    { requestId },
  );
}

/** Deletes deliveries past the retention (and their tickets), a bounded batch per run. */
export async function purgeOldNotifications(tx: ClubTransaction, now: Date): Promise<number> {
  const before = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60_000);
  const result = await tx.client.query(
    `delete from notification where id in (
       select id from notification where created_at < $1 order by created_at limit 1000)`,
    [before],
  );
  return result.rowCount ?? 0;
}
