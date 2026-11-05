import {
  parseLocalDate,
  usageRetainedFrom,
  type ClubId,
  type LocalDate,
} from '@sport-performance/domain';
import type pg from 'pg';
import type { Logger } from 'pino';
import { inClubTransaction } from './database.js';

export interface UsageFoldDependencies {
  /** Pool of a `sport_performance_worker` login. */
  readonly pool: pg.Pool;
  readonly logger: Logger;
}

export interface UsageFoldReport {
  /** Monday of the first week whose per-member rows are kept. */
  readonly retainedFrom: LocalDate;
  /** Per-member activity rows folded and deleted. */
  readonly folded: number;
  /** Weekly count rows written or added to. */
  readonly weeks: number;
}

/**
 * Retention of the usage metrics for one club (B-707, ADR 0093): the
 * per-member activity rows of the weeks that ended the retention days ago
 * (`usageRetainedFrom`, on the club's today) become counts per week, surface,
 * client and role without members (`usage_weekly`), and are deleted, in one
 * statement of one transaction: either both happen or neither. A week only
 * ever gets new rows on its own days, so it is folded once; should a later
 * fold find rows of a folded week (the club changed its time zone), its counts
 * are added.
 */
export async function foldClubUsage(
  deps: UsageFoldDependencies,
  clubId: ClubId,
  options: { readonly jobId?: string } = {},
): Promise<UsageFoldReport> {
  const report = await inClubTransaction(
    deps.pool,
    clubId,
    async ({ client }) => {
      const { rows } = await client.query<{ today: string | null }>(
        'select app.club_today()::text as today',
      );
      const today = rows[0]?.today ?? null;
      if (today === null) throw new Error(`Club ${clubId} not found for the usage fold.`);
      const retainedFrom = usageRetainedFrom(parseLocalDate(today));
      const result = await client.query<{ folded: number; weeks: number }>(
        `with folded as (
           delete from usage_activity
            where club_id = $1 and local_date < $2::date
           returning membership_id, role, local_date, surface, client, events_n
         ), weekly as (
           select (date_trunc('week', local_date::timestamp))::date as week_start, surface,
                  client, role, count(distinct membership_id)::int as active_members_n,
                  count(*)::int as member_days_n, sum(events_n)::int as events_n
             from folded
            group by 1, 2, 3, 4
         ), written as (
           insert into usage_weekly as u (club_id, week_start, surface, client, role,
                                          active_members_n, member_days_n, events_n)
           select $1, week_start, surface, client, role, active_members_n, member_days_n,
                  events_n
             from weekly
           on conflict on constraint usage_weekly_week_key do update
              set active_members_n = u.active_members_n + excluded.active_members_n,
                  member_days_n = least(u.member_days_n + excluded.member_days_n,
                                        7 * (u.active_members_n + excluded.active_members_n)),
                  events_n = u.events_n + excluded.events_n
           returning 1
         )
         select (select count(*) from folded)::int as folded,
                (select count(*) from written)::int as weeks`,
        [clubId, retainedFrom],
      );
      const counts = result.rows[0] ?? { folded: 0, weeks: 0 };
      return { retainedFrom, folded: counts.folded, weeks: counts.weeks };
    },
    options.jobId === undefined ? {} : { requestId: `job:${options.jobId}` },
  );
  if (report.folded > 0) {
    deps.logger.info({ clubId, jobId: options.jobId, ...report }, 'usage activity folded');
  }
  return report;
}
