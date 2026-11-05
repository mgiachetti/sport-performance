import {
  addDays,
  compareLocalDates,
  parseLocalDate,
  type LocalDate,
} from '@sport-performance/domain';
import {
  generateDemoDataset,
  type DemoCategoryKey,
  type DemoDataset,
  type DemoPlayer,
} from '@sport-performance/db/seeds';
import type { RunState } from '../stack/state.ts';

/**
 * The demo club of the run, recomputed: the generator is pure and
 * deterministic (ADR 0055), so with the options of the stack it gives the
 * exact rows the seed wrote. Tests pick their people from here (a player of
 * the coach's categories, one who was injured) instead of hardcoding names.
 */
export function demoDataset(
  state: Pick<RunState, 'asOf' | 'slug' | 'seed' | 'historyDays' | 'emailDomain'>,
): DemoDataset {
  return generateDemoDataset({
    asOf: parseLocalDate(state.asOf),
    slug: state.slug,
    seed: state.seed,
    historyDays: state.historyDays,
    emailDomain: state.emailDomain,
  });
}

/** Email of a demo account by its local part (`admin`, `entrenador.rugby`, `familia`…). */
export function demoEmail(state: Pick<RunState, 'slug' | 'emailDomain'>, local: string): string {
  return `${state.slug}.${local}@${state.emailDomain}`;
}

/** The staff and family accounts of the demo the tests sign in with (`generate.ts`). */
export const DEMO_ACCOUNTS = {
  admin: 'admin',
  coachRugbySenior: 'entrenador.rugby',
  coachHockeySenior: 'entrenadora.hockey',
  scRugby: 'pf.rugby',
  medicalRugby: 'medico.rugby',
  family: 'familia',
  rugbyPlayer: 'jugador',
  hockeyPlayer: 'jugadora',
} as const;
export type DemoAccount = keyof typeof DEMO_ACCOUNTS;

/**
 * The categories of the rugby coach of M17 and M19 (`entrenador.rugby`, by
 * `staff_assignment`): the scope of the coach scenarios and of the stack's
 * injury fixture.
 */
export function coachRugbySeniorScope(category: DemoCategoryKey): boolean {
  return category.sport === 'rugby' && ['m17', 'm19'].includes(category.ageBandCode);
}

const within = (date: LocalDate, from: LocalDate, to: LocalDate | null): boolean =>
  compareLocalDates(from, date) <= 0 && (to === null || compareLocalDates(date, to) < 0);

/** The category of `player` on `date` (the band of the season), if any. */
export function categoryOn(
  dataset: DemoDataset,
  player: DemoPlayer,
  date: LocalDate,
): DemoCategoryKey | null {
  const row = dataset.playerCategories.find(
    (c) => c.playerId === player.id && within(date, c.validFrom, c.validTo),
  );
  return row?.category ?? null;
}

/** Active players (no leave) whose category on the run's day matches `match`. */
export function activePlayers(
  dataset: DemoDataset,
  match: (category: DemoCategoryKey) => boolean,
): DemoPlayer[] {
  return dataset.players.filter((p) => {
    if (p.leftOn !== null || p.archivedAt !== null) return false;
    const category = categoryOn(dataset, p, dataset.asOf);
    return category !== null && match(category);
  });
}

/** `Apellido, Nombre`, as the roster and the profile show a player. */
export function rosterName(player: DemoPlayer): string {
  return `${player.lastName}, ${player.firstName}`;
}

/** Players with an availability hold that overlaps the last `days` days of the run. */
export function recentlyHeldPlayers(
  dataset: DemoDataset,
  players: readonly DemoPlayer[],
  days = 90,
) {
  const from = addDays(dataset.asOf, -(days - 1));
  return players.flatMap((player) => {
    const holds = dataset.holds.filter(
      (h) => h.playerId === player.id && compareLocalDates(from, h.validTo) < 0,
    );
    const injuries = dataset.injuries.filter((i) => holds.some((h) => h.injuryId === i.id));
    return holds.length === 0 ? [] : [{ player, holds, injuries }];
  });
}

/** The children the guardian with `userId` has in the club. */
export function childrenOf(dataset: DemoDataset, userId: string): DemoPlayer[] {
  const ids = new Set(dataset.guardians.filter((g) => g.userId === userId).map((g) => g.playerId));
  return dataset.players.filter((p) => ids.has(p.id));
}

/** The demo user with `email`. */
export function userByEmail(dataset: DemoDataset, email: string) {
  const user = dataset.users.find((u) => u.email === email.toLowerCase());
  if (user === undefined) throw new Error(`The demo has no user ${email}.`);
  return user;
}
