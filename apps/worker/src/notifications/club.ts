import {
  addDays,
  currentConsentTypes,
  enabledChannels,
  guardianConsentsLapsed,
  isMinorOn,
  isNotificationKind,
  localDateInTimeZone,
  parseTimeZone,
  resolveClubModules,
  resolveNotificationPreference,
  resolveNotificationSettings,
  type ClubId,
  type ClubModules,
  type ConsentRecord,
  type LocalDate,
  type NotificationChannel,
  type NotificationKind,
  type NotificationSettings,
  type PlayerId,
  type StoredNotificationPreference,
  type TimeZone,
} from '@sport-performance/domain';
import { isSupportedLocale, type Locale } from '@sport-performance/i18n';
import type { ClubTransaction } from '../database.js';

/**
 * What the planning and the delivery of one club read once per run: the
 * club's zone, day, parameters and modules, and the preferences of its
 * members. Every query runs in a transaction with the club's context
 * (`app.club_id`), so the worker's role sees that club only (ADR 0026).
 */
export interface NotificationClub {
  readonly clubId: ClubId;
  readonly timeZone: TimeZone;
  readonly locale: Locale;
  readonly today: LocalDate;
  readonly settings: NotificationSettings;
  readonly modules: ClubModules;
  /** A demo club (ADR 0055): delivers only to the allowed catch-all domains (#177). */
  readonly isDemo: boolean;
}

export async function readNotificationClub(
  tx: ClubTransaction,
  clubId: ClubId,
  now: Date,
): Promise<NotificationClub | null> {
  const { rows } = await tx.client.query<{
    time_zone: string;
    locale: string;
    settings: { notifications?: unknown; modules?: unknown } | null;
    is_demo: boolean;
  }>('select time_zone, locale, settings, is_demo from club where id = $1', [clubId]);
  const row = rows[0];
  if (row === undefined) return null;
  const timeZone = parseTimeZone(row.time_zone);
  return {
    clubId,
    timeZone,
    locale: isSupportedLocale(row.locale) ? row.locale : 'es-AR',
    today: localDateInTimeZone(now, timeZone),
    // An invalid configuration fails the job loudly: a typo never silently falls back.
    settings: resolveNotificationSettings(row.settings?.notifications),
    modules: resolveClubModules(row.settings?.modules),
    isDemo: row.is_demo,
  };
}

/** The channels each user has on per kind, from the stored preferences of the club. */
export class ClubPreferences {
  readonly #stored = new Map<string, StoredNotificationPreference>();

  static async read(tx: ClubTransaction): Promise<ClubPreferences> {
    const { rows } = await tx.client.query<{
      user_id: string;
      kind: string;
      push: boolean | null;
      email: boolean | null;
    }>('select user_id, kind, push, email from notification_preference');
    const preferences = new ClubPreferences();
    for (const row of rows) {
      if (!isNotificationKind(row.kind)) continue;
      preferences.#stored.set(`${row.user_id}|${row.kind}`, {
        kind: row.kind,
        push: row.push,
        email: row.email,
      });
    }
    return preferences;
  }

  channels(userId: string, kind: NotificationKind): NotificationChannel[] {
    return enabledChannels(
      resolveNotificationPreference(kind, this.#stored.get(`${userId}|${kind}`)),
    );
  }

  isOn(userId: string, kind: NotificationKind, channel: NotificationChannel): boolean {
    return this.channels(userId, kind).includes(channel);
  }
}

/**
 * Players with a current `data` consent on the club's day (the definition of
 * `app.current_consent_types` and the domain's `currentConsentTypes`): without
 * it their data is not collected, so they are not asked for it.
 */
export async function playersWithDataConsent(
  tx: ClubTransaction,
  players: ReadonlyMap<PlayerId, LocalDate>,
  now: Date,
  today: LocalDate,
): Promise<Set<PlayerId>> {
  if (players.size === 0) return new Set();
  const { rows } = await tx.client.query<{
    player_id: PlayerId;
    document_id: string | null;
    document_version: string;
    signer_kind: 'guardian' | 'player';
    signed_at: Date;
    revoked_at: Date | null;
  }>(
    `select player_id, document_id, document_version, signer_kind, signed_at, revoked_at
       from consent where type = 'data' and player_id = any($1::uuid[])`,
    [[...players.keys()]],
  );
  const result = new Set<PlayerId>();
  for (const [playerId, birthDate] of players) {
    const records: ConsentRecord[] = rows
      .filter((r) => r.player_id === playerId)
      .map((r) => ({
        type: 'data',
        documentId: r.document_id,
        documentVersion: r.document_version,
        signerKind: r.signer_kind,
        signedAt: r.signed_at,
        revokedAt: r.revoked_at,
      }));
    const holder = {
      ofAge: !isMinorOn(birthDate, today),
      guardianConsentsLapsed: guardianConsentsLapsed(birthDate, today),
    };
    if (currentConsentTypes(records, now, holder).includes('data')) result.add(playerId);
  }
  return result;
}

/** `[valid_from, valid_to)` covering `day`, as SQL over a table alias. */
export function currentOn(alias: string, dayParam: string): string {
  return `${alias}.valid_from <= ${dayParam}::date and (${alias}.valid_to is null or ${alias}.valid_to > ${dayParam}::date)`;
}

/**
 * The staff to notify about players: members with an active membership as
 * coach, sc, medical or admin whose current assignment covers one of the
 * player's current categories (by category or by sport), on the club's day.
 */
export async function staffOfPlayers(
  tx: ClubTransaction,
  playerIds: readonly PlayerId[],
  today: LocalDate,
): Promise<Map<PlayerId, Set<string>>> {
  const result = new Map<PlayerId, Set<string>>();
  if (playerIds.length === 0) return result;
  const { rows } = await tx.client.query<{ player_id: PlayerId; user_id: string }>(
    `select distinct pc.player_id, m.user_id
       from player_category pc
       join category c on c.club_id = pc.club_id and c.id = pc.category_id
       join staff_assignment sa on sa.club_id = pc.club_id
                               and (sa.category_id = pc.category_id or sa.sport = c.sport)
                               and ${currentOn('sa', '$2')}
       join membership m on m.club_id = sa.club_id and m.id = sa.membership_id
                        and m.ended_at is null and m.role in ('coach', 'sc', 'medical', 'admin')
      where pc.player_id = any($1::uuid[]) and ${currentOn('pc', '$2')}`,
    [playerIds, today],
  );
  for (const row of rows) {
    const users = result.get(row.player_id) ?? new Set<string>();
    users.add(row.user_id);
    result.set(row.player_id, users);
  }
  return result;
}

/** The staff assigned to categories (by category or by the category's sport), on the club's day. */
export async function staffOfCategories(
  tx: ClubTransaction,
  categoryIds: readonly string[],
  today: LocalDate,
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (categoryIds.length === 0) return result;
  const { rows } = await tx.client.query<{ category_id: string; user_id: string }>(
    `select distinct c.id as category_id, m.user_id
       from category c
       join staff_assignment sa on sa.club_id = c.club_id
                               and (sa.category_id = c.id or sa.sport = c.sport)
                               and ${currentOn('sa', '$2')}
       join membership m on m.club_id = sa.club_id and m.id = sa.membership_id
                        and m.ended_at is null and m.role in ('coach', 'sc', 'medical', 'admin')
      where c.id = any($1::uuid[])`,
    [categoryIds, today],
  );
  for (const row of rows) {
    const users = result.get(row.category_id) ?? new Set<string>();
    users.add(row.user_id);
    result.set(row.category_id, users);
  }
  return result;
}

/** The day before, for "the alert was not critical yesterday". */
export function previousDay(day: LocalDate): LocalDate {
  return addDays(day, -1);
}
