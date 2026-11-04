import type { KioskRosterEntry, KioskRosterPage } from '@sport-performance/contracts';
import {
  localDateInTimeZone,
  ruleFor,
  type Role,
  type LocalDate,
  type TimeZone,
  type WellnessItem,
} from '@sport-performance/domain';

/**
 * What the kiosk shows (B-504, ADR 0086), from the roster the device kept
 * of each category and what the device itself knows since: what this kiosk
 * queued, and the rows the sync pulled. A value queued here counts as loaded
 * at once, with or without signal, so nobody loads twice; but the kiosk never
 * shows a value, only what is left.
 */

/** Who opens the kiosk: whoever loads on it (`wellness.kiosk_submit`: coach, S&C, admin). */
export function canOpenKiosk(role: Role): boolean {
  return ruleFor('wellness', 'kiosk_submit', role).effect === 'allow';
}

/** The roster of one category as the device keeps it (every page, in order). */
export interface KioskRosterSnapshot {
  readonly categoryId: string;
  readonly today: LocalDate;
  readonly timeZone: TimeZone;
  readonly entries: readonly KioskRosterEntry[];
  /** When the device got it (epoch ms). */
  readonly fetchedAt: number;
}

/** The roster of a category from its pages. */
export function rosterSnapshot(
  categoryId: string,
  pages: readonly KioskRosterPage[],
  fetchedAt: number,
): KioskRosterSnapshot {
  const [first] = pages;
  if (first === undefined) throw new Error('A roster has at least one page');
  return {
    categoryId,
    today: first.today,
    timeZone: first.timeZone,
    entries: pages.flatMap((page) => page.items),
    fetchedAt,
  };
}

/** `sessionId|playerId`: one RPE. */
export function rpeKey(sessionId: string, playerId: string): string {
  return `${sessionId}|${playerId}`;
}

/** What the device knows that the kept roster may not. */
export interface KioskLocalFacts {
  /** Players with a check-in of `today` queued or pulled. */
  readonly wellnessDone: ReadonlySet<string>;
  /** RPEs queued or pulled (`rpeKey`). */
  readonly rpeDone: ReadonlySet<string>;
  /** Participations the staff recorded without load (`rpeKey`). */
  readonly notTakingPart: ReadonlySet<string>;
}

export const NO_LOCAL_FACTS: KioskLocalFacts = {
  wellnessDone: new Set(),
  rpeDone: new Set(),
  notTakingPart: new Set(),
};

export interface KioskSessionTask {
  readonly sessionId: string;
  readonly title: string | null;
  readonly kind: 'training' | 'match';
  readonly startsAt: string;
}

export interface KioskPlayer {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  /** "Juan P.", or the full name when two players of the kiosk share it. */
  readonly displayName: string;
  readonly categoryIds: readonly string[];
  /** The kiosk may load for them (the matrix and the data consent). */
  readonly canReport: boolean;
  /** Today's check-in to ask, `null` when there is none (done, or no stage today). */
  readonly wellness: {
    readonly itemCount: 3 | 5;
    readonly items: readonly WellnessItem[];
  } | null;
  /** Whether today's check-in is already loaded (by any channel). */
  readonly wellnessDone: boolean;
  /** Sessions whose RPE window is open now and that have no RPE yet. */
  readonly rpe: readonly KioskSessionTask[];
}

/** Lowercase without accents, for the search. */
export function foldName(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** First name and the initial of the last name; the full name when that is not unique. */
export function kioskDisplayNames(
  players: readonly { id: string; firstName: string; lastName: string }[],
): Map<string, string> {
  const short = (p: { firstName: string; lastName: string }) =>
    `${p.firstName} ${p.lastName.slice(0, 1).toLocaleUpperCase('es-AR')}.`;
  const counts = new Map<string, number>();
  for (const p of players) {
    const key = foldName(short(p));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const names = new Map<string, string>();
  for (const p of players) {
    const unique = counts.get(foldName(short(p))) === 1;
    names.set(p.id, unique ? short(p) : `${p.firstName} ${p.lastName}`);
  }
  return names;
}

/** "Today" for the kiosk: the club day of `nowMs` in the club's time zone. */
export function kioskToday(snapshots: readonly KioskRosterSnapshot[], nowMs: number): LocalDate {
  const [first] = snapshots;
  if (first === undefined) throw new Error('No roster to tell the club’s time zone');
  return localDateInTimeZone(new Date(nowMs), first.timeZone);
}

/**
 * The players of the kiosk, ordered by last and first name, each once (a
 * player in two categories of the kiosk shows once), with what is left.
 * The kept roster's "already loaded" only counts on the day it was fetched;
 * the RPE of a session is asked only while its window is open at `nowMs`.
 */
export function kioskPlayers(
  snapshots: readonly KioskRosterSnapshot[],
  facts: KioskLocalFacts,
  nowMs: number,
): KioskPlayer[] {
  if (snapshots.length === 0) return [];
  const today = kioskToday(snapshots, nowMs);
  const byId = new Map<string, { entry: KioskRosterEntry; fresh: boolean; categories: string[] }>();
  for (const snapshot of snapshots) {
    const fresh = snapshot.today === today;
    for (const entry of snapshot.entries) {
      const known = byId.get(entry.player.id);
      if (known === undefined) {
        byId.set(entry.player.id, { entry, fresh, categories: [snapshot.categoryId] });
      } else {
        known.categories.push(snapshot.categoryId);
        // The freshest copy of the player answers.
        if (fresh && !known.fresh) Object.assign(known, { entry, fresh });
      }
    }
  }
  const names = kioskDisplayNames([...byId.values()].map(({ entry }) => entry.player));
  const players: KioskPlayer[] = [];
  for (const { entry, fresh, categories } of byId.values()) {
    const id = entry.player.id;
    const wellnessDone =
      facts.wellnessDone.has(id) || (fresh && entry.wellness?.submitted === true);
    const rpe: KioskSessionTask[] = [];
    for (const task of entry.sessions) {
      const opensAt = Date.parse(task.rpeWindow.opensAt);
      const closesAt = Date.parse(task.rpeWindow.closesAt);
      if (nowMs < opensAt || nowMs >= closesAt) continue;
      const key = rpeKey(task.session.id, id);
      if (task.state !== 'pending' || facts.rpeDone.has(key) || facts.notTakingPart.has(key)) {
        continue;
      }
      rpe.push({
        sessionId: task.session.id,
        title: task.session.title,
        kind: task.session.kind,
        startsAt: task.session.startsAt,
      });
    }
    players.push({
      id,
      firstName: entry.player.firstName,
      lastName: entry.player.lastName,
      displayName: names.get(id) ?? entry.player.firstName,
      categoryIds: categories,
      canReport: entry.canReport,
      // A roster kept from another day still tells the stage and its items.
      wellness:
        entry.wellness === null || wellnessDone
          ? null
          : { itemCount: entry.wellness.itemCount, items: entry.wellness.items },
      wellnessDone,
      rpe,
    });
  }
  return players.sort(
    (a, b) =>
      a.lastName.localeCompare(b.lastName, 'es-AR') ||
      a.firstName.localeCompare(b.firstName, 'es-AR') ||
      a.id.localeCompare(b.id),
  );
}

/** Players whose first or last name has a word starting with `query` (accents and case aside). */
export function searchKioskPlayers(
  players: readonly KioskPlayer[],
  query: string,
): readonly KioskPlayer[] {
  const needle = foldName(query);
  if (needle === '') return players;
  const parts = needle.split(/\s+/);
  return players.filter((player) => {
    const words = foldName(`${player.firstName} ${player.lastName}`).split(/\s+/);
    return parts.every((part) => words.some((word) => word.startsWith(part)));
  });
}

/** Whether the kiosk has anything to ask this player now. */
export function hasSomethingLeft(player: KioskPlayer): boolean {
  return player.wellness !== null || player.rpe.length > 0;
}
