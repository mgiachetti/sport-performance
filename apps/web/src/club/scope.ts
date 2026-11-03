import type { Category } from '@sport-performance/contracts';
import { SPORTS, isSport, isUuid, type CategoryId, type Sport } from '@sport-performance/domain';

/**
 * Sport and category of the layout, kept in the URL (`?sport=rugby&category=…`)
 * so a filtered screen can be shared and reloaded (ADR 0012, ADR 0056).
 */
export interface ScopeSearch {
  readonly sport?: Sport | undefined;
  readonly category?: CategoryId | undefined;
}

/** `validateSearch` of the club layout: drops anything malformed. */
export function parseScopeSearch(search: Readonly<Record<string, unknown>>): ScopeSearch {
  const sport = isSport(search.sport) ? search.sport : undefined;
  const raw = typeof search.category === 'string' ? search.category.toLowerCase() : undefined;
  const category = isUuid(raw) ? (raw as CategoryId) : undefined;
  return {
    ...(sport === undefined ? {} : { sport }),
    ...(category === undefined ? {} : { category }),
  };
}

/** The scope resolved against what the user sees. */
export interface ResolvedScope {
  /** Sports among the visible categories, in the model's order. */
  readonly sports: readonly Sport[];
  /** `null`: every sport the user sees. Fixed when there is only one. */
  readonly sport: Sport | null;
  /** Visible categories of the selected sport (all of them without one). */
  readonly categoryOptions: readonly Category[];
  /** `null`: every category of the options. */
  readonly category: Category | null;
  /** The URL asked for a sport or category the user does not see: it was ignored. */
  readonly ignored: boolean;
}

export function resolveScope(categories: readonly Category[], search: ScopeSearch): ResolvedScope {
  const present = new Set(categories.map((category) => category.sport));
  const sports = SPORTS.filter((sport) => present.has(sport));
  let ignored = false;

  let sport: Sport | null = null;
  if (sports.length === 1) sport = sports[0] ?? null;
  else if (search.sport !== undefined) {
    if (sports.includes(search.sport)) sport = search.sport;
    else ignored = true;
  }

  let category: Category | null = null;
  if (search.category !== undefined) {
    category = categories.find((candidate) => candidate.id === search.category) ?? null;
    if (category === null) ignored = true;
  }
  // A category pins its sport (a shared link may carry only the category).
  if (category !== null) {
    if (sport !== null && category.sport !== sport) {
      category = null;
      ignored = true;
    } else {
      sport = category.sport;
    }
  }

  const categoryOptions =
    sport === null ? categories : categories.filter((candidate) => candidate.sport === sport);
  return { sports, sport, categoryOptions, category, ignored };
}

/**
 * The canonical search for a resolved scope (what the URL should say). Both
 * keys are always present: `undefined` removes a param that the club layout
 * would otherwise retain across the navigation (`retainSearchParams`).
 */
export function scopeToSearch(scope: ResolvedScope): Required<ScopeSearch> {
  return {
    sport: scope.sport === null || scope.sports.length <= 1 ? undefined : scope.sport,
    category: scope.category === null ? undefined : scope.category.id,
  };
}
