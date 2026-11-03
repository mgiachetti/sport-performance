import { schema } from '@sport-performance/db';
import {
  DEFAULT_RPE_WINDOW,
  addDays,
  allowedHoursFor,
  dayBoundsInTimeZone,
  isMinorOn,
  nextAllowedInstant,
  participationCarriesLoad,
  preTrainingSummaryDueAt,
  rpeReminderDueAt,
  rpeRequestDueAt,
  rpeSubmissionWindow,
  type LocalDate,
  type NotificationKind,
  type ParticipationStatus,
  type PlayerId,
} from '@sport-performance/domain';
import type { ClubTransaction } from '../database.js';
import {
  playersWithDataConsent,
  previousDay,
  staffOfCategories,
  staffOfPlayers,
  type ClubPreferences,
  type NotificationClub,
} from './club.js';

const { notification } = schema;

/**
 * Planning (B-328, ADR 0054): turns what happened in the club into pending
 * deliveries, idempotently (`notification_dedupe_key`): running it again,
 * or on two replicas, never duplicates. Each delivery is scheduled at its
 * due time moved into the recipient's allowed hours (the minors' window for
 * a minor player), and is checked again right before sending.
 */

/** Rows inserted per statement. */
const INSERT_CHUNK = 500;

export interface PlannedNotification {
  readonly userId: string;
  readonly kind: NotificationKind;
  readonly dedupeKey: string;
  readonly scheduledFor: Date;
  readonly playerId?: PlayerId;
  readonly trainingSessionId?: string;
  readonly alertId?: string;
}

export interface PlanReport {
  readonly created: number;
}

interface SessionRow {
  readonly id: string;
  readonly kind: 'training' | 'match';
  readonly startsAt: Date;
  readonly localDate: LocalDate;
  readonly plannedDurationMin: number | null;
  readonly categoryId: string | null;
}

async function readSessions(
  tx: ClubTransaction,
  where: string,
  params: unknown[],
): Promise<SessionRow[]> {
  const { rows } = await tx.client.query<{
    id: string;
    kind: 'training' | 'match';
    starts_at: Date;
    local_date: LocalDate;
    planned_duration_min: number | null;
    category_id: string | null;
  }>(
    `select id, kind, starts_at, local_date::text as local_date, planned_duration_min, category_id
       from training_session s
      where s.archived_at is null and ${where}
      order by s.starts_at, s.id`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    startsAt: r.starts_at,
    localDate: r.local_date,
    plannedDurationMin: r.planned_duration_min,
    categoryId: r.category_id,
  }));
}

export interface RpeCandidate {
  readonly sessionId: string;
  readonly playerId: PlayerId;
  readonly userId: string;
  readonly birthDate: LocalDate;
}

/**
 * Players who may still report the RPE of the sessions: in the session's
 * category on its day (or with a participation recorded), with their own
 * account (an active `player` membership), still in the club, not recorded
 * as absent or unavailable, and without an RPE yet.
 */
export async function rpeCandidates(
  tx: ClubTransaction,
  sessionIds: readonly string[],
): Promise<RpeCandidate[]> {
  if (sessionIds.length === 0) return [];
  const { rows } = await tx.client.query<{
    session_id: string;
    player_id: PlayerId;
    user_id: string;
    birth_date: LocalDate;
    status: ParticipationStatus | null;
    rpe: number | null;
  }>(
    `with roster as (
       select s.id as session_id, pc.player_id
         from training_session s
         join player_category pc on pc.club_id = s.club_id and pc.category_id = s.category_id
                                and pc.valid_from <= s.local_date
                                and (pc.valid_to is null or pc.valid_to > s.local_date)
        where s.id = any($1::uuid[])
       union
       select pa.training_session_id, pa.player_id
         from participation pa
        where pa.training_session_id = any($1::uuid[])
     )
     select r.session_id, p.id as player_id, p.user_id, p.birth_date::text as birth_date,
            pa.status, pa.rpe
       from roster r
       join player p on p.id = r.player_id
       left join participation pa on pa.training_session_id = r.session_id and pa.player_id = p.id
      where p.user_id is not null and p.left_on is null
        and exists (select 1 from membership m
                     where m.club_id = p.club_id and m.user_id = p.user_id
                       and m.role = 'player' and m.ended_at is null)
      order by r.session_id, p.id`,
    [sessionIds],
  );
  return rows
    .filter((r) => r.rpe === null && (r.status === null || participationCarriesLoad(r.status)))
    .map((r) => ({
      sessionId: r.session_id,
      playerId: r.player_id,
      userId: r.user_id,
      birthDate: r.birth_date,
    }));
}

async function insertPlanned(
  tx: ClubTransaction,
  club: NotificationClub,
  preferences: ClubPreferences,
  planned: readonly PlannedNotification[],
): Promise<number> {
  const values = planned.flatMap((p) =>
    preferences.channels(p.userId, p.kind).map((channel) => ({
      clubId: club.clubId,
      userId: p.userId,
      kind: p.kind,
      channel,
      dedupeKey: p.dedupeKey,
      scheduledFor: p.scheduledFor,
      playerId: p.playerId ?? null,
      trainingSessionId: p.trainingSessionId ?? null,
      alertId: p.alertId ?? null,
    })),
  );
  let created = 0;
  for (let i = 0; i < values.length; i += INSERT_CHUNK) {
    const inserted = await tx.db
      .insert(notification)
      .values(values.slice(i, i + INSERT_CHUNK))
      .onConflictDoNothing({
        target: [
          notification.clubId,
          notification.userId,
          notification.kind,
          notification.channel,
          notification.dedupeKey,
        ],
      })
      .returning({ id: notification.id });
    created += inserted.length;
  }
  return created;
}

/** RPE requests (end of session + delay) and next-morning reminders. */
async function planRpe(
  tx: ClubTransaction,
  club: NotificationClub,
  now: Date,
): Promise<PlannedNotification[]> {
  // Sessions whose RPE window may still be open (the window closes at the end of a later club day).
  const sessions = await readSessions(
    tx,
    `s.category_id is not null and s.local_date between $1::date and $2::date and s.starts_at <= $3`,
    [addDays(club.today, -DEFAULT_RPE_WINDOW.closeAfterClubDays), club.today, now],
  );
  const open = sessions
    .map((session) => ({ session, window: rpeSubmissionWindow(session, club.timeZone) }))
    .filter(({ window }) => window.opensAt <= now && now < window.closesAt);
  const requestDue = open.filter(({ session }) => rpeRequestDueAt(session, club.settings) <= now);
  const reminderDue = open.filter(
    ({ session }) => rpeReminderDueAt(session, club.timeZone, club.settings) <= now,
  );
  const ids = [...new Set([...requestDue, ...reminderDue].map(({ session }) => session.id))];
  const candidates = await rpeCandidates(tx, ids);
  const consented = await playersWithDataConsent(
    tx,
    new Map(candidates.map((c) => [c.playerId, c.birthDate])),
    now,
    club.today,
  );
  const eligible = candidates.filter((c) => consented.has(c.playerId));

  // A reminder is not sent when the request itself went out (or is due) that same morning:
  // a request deferred to the minors' opening is already the morning nudge.
  const reminderIds = reminderDue.map(({ session }) => session.id);
  const latestRequest = new Map<string, Date>();
  if (reminderIds.length > 0) {
    const { rows } = await tx.client.query<{
      training_session_id: string;
      user_id: string;
      latest: Date;
    }>(
      `select training_session_id, user_id, max(scheduled_for) as latest from notification
        where kind = 'rpe_request' and training_session_id = any($1::uuid[])
        group by training_session_id, user_id`,
      [reminderIds],
    );
    for (const row of rows)
      latestRequest.set(`${row.training_session_id}|${row.user_id}`, row.latest);
  }

  const planned: PlannedNotification[] = [];
  const schedule = (
    kind: NotificationKind,
    due: Date,
    closesAt: Date,
    candidate: RpeCandidate,
  ): void => {
    const minor = isMinorOn(candidate.birthDate, club.today);
    const scheduledFor = nextAllowedInstant(
      due,
      club.timeZone,
      allowedHoursFor(club.settings, minor),
    );
    // Deferred past the end of the window: it would ask for something no longer accepted.
    if (scheduledFor >= closesAt) return;
    planned.push({
      userId: candidate.userId,
      kind,
      dedupeKey: `session:${candidate.sessionId}`,
      scheduledFor,
      playerId: candidate.playerId,
      trainingSessionId: candidate.sessionId,
    });
  };
  for (const { session, window } of requestDue) {
    // Never planned before the morning's reminder (the worker was down): the reminder alone.
    if (rpeReminderDueAt(session, club.timeZone, club.settings) <= now) continue;
    const due = rpeRequestDueAt(session, club.settings);
    for (const c of eligible.filter((e) => e.sessionId === session.id)) {
      schedule('rpe_request', due, window.closesAt, c);
    }
  }
  for (const { session, window } of reminderDue) {
    const due = rpeReminderDueAt(session, club.timeZone, club.settings);
    const reminderDayStart = dayBoundsInTimeZone(
      addDays(session.localDate, 1),
      club.timeZone,
    ).start;
    for (const c of eligible.filter((e) => e.sessionId === session.id)) {
      const key = `${session.id}|${c.userId}`;
      const stored = latestRequest.get(key);
      const thisRun = planned.find(
        (p) =>
          p.kind === 'rpe_request' && p.trainingSessionId === session.id && p.userId === c.userId,
      );
      const requestAt = [stored, thisRun?.scheduledFor].filter((d): d is Date => d !== undefined);
      if (requestAt.some((at) => at >= reminderDayStart)) continue;
      schedule('rpe_reminder', due, window.closesAt, c);
    }
  }
  return planned;
}

/**
 * Critical alerts when they appear (ADR 0053 episodes, read through their
 * `alert_event` history): an active, unreviewed episode whose current
 * severity is critical, notified once per appearance — the latest `raised`,
 * `escalated` or `reopened` event of the episode, which is the dedupe key. A
 * critical condition that lasts is one episode and one notification; one
 * that resolves and comes back (reopened) or is escalated after a review is
 * a new appearance. Only appearances of today or yesterday (club days)
 * notify, so the history of older days never does. No cursor over `seq`:
 * identities are not committed in order, so a cursor could skip an event
 * that commits late; the two-day window with the dedupe key never does.
 */
async function planCriticalAlerts(
  tx: ClubTransaction,
  club: NotificationClub,
  now: Date,
): Promise<PlannedNotification[]> {
  const { rows } = await tx.client.query<{ id: string; event_id: string; player_id: PlayerId }>(
    `select a.id, e.id as event_id, a.player_id
       from alert a
       join player p on p.club_id = a.club_id and p.id = a.player_id and p.left_on is null
       join lateral (select ev.id, ev.local_date from alert_event ev
                      where ev.club_id = a.club_id and ev.alert_id = a.id
                        and ev.type in ('raised', 'escalated', 'reopened')
                      order by ev.seq desc limit 1) e on true
      where a.resolved_on is null and a.status = 'open' and a.current_severity = 'critical'
        and e.local_date >= $1::date
      order by a.local_date, a.id`,
    [previousDay(club.today)],
  );
  if (rows.length === 0) return [];
  const staff = await staffOfPlayers(tx, [...new Set(rows.map((r) => r.player_id))], club.today);
  const scheduledFor = nextAllowedInstant(now, club.timeZone, club.settings.allowedHours);
  return rows.flatMap((row) =>
    [...(staff.get(row.player_id) ?? [])].map((userId) => ({
      userId,
      kind: 'critical_alert' as const,
      dedupeKey: `alert_event:${row.event_id}`,
      scheduledFor,
      playerId: row.player_id,
      alertId: row.id,
    })),
  );
}

/** The staff summary of each session that starts within the lead time. */
async function planSummaries(
  tx: ClubTransaction,
  club: NotificationClub,
  now: Date,
): Promise<PlannedNotification[]> {
  const leadMs = club.settings.preTrainingSummaryLeadMin * 60_000;
  const sessions = await readSessions(
    tx,
    `s.category_id is not null and s.starts_at > $1 and s.starts_at <= $2`,
    [now, new Date(now.getTime() + leadMs)],
  );
  if (sessions.length === 0) return [];
  const staff = await staffOfCategories(
    tx,
    [...new Set(sessions.flatMap((s) => (s.categoryId === null ? [] : [s.categoryId])))],
    club.today,
  );
  return sessions.flatMap((session) => {
    const scheduledFor = nextAllowedInstant(
      preTrainingSummaryDueAt(session, club.settings),
      club.timeZone,
      club.settings.allowedHours,
    );
    if (scheduledFor >= session.startsAt || session.categoryId === null) return [];
    return [...(staff.get(session.categoryId) ?? [])].map((userId) => ({
      userId,
      kind: 'pre_training_summary' as const,
      dedupeKey: `session:${session.id}`,
      scheduledFor,
      trainingSessionId: session.id,
    }));
  });
}

export async function planClubNotifications(
  tx: ClubTransaction,
  club: NotificationClub,
  preferences: ClubPreferences,
  now: Date,
): Promise<PlanReport> {
  const planned = [
    ...(await planRpe(tx, club, now)),
    ...(await planCriticalAlerts(tx, club, now)),
    ...(await planSummaries(tx, club, now)),
  ];
  return { created: await insertPlanned(tx, club, preferences, planned) };
}
