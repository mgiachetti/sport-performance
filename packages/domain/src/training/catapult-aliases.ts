import type { Sport } from '../sport.js';

/**
 * Which canonical (or club) metric each column of a Catapult OpenField
 * export is, for one sport (B-601, B-803, ADR 0091). The aliases are data of
 * the club's metric dictionary (`metric_definition.catapult_aliases`); the
 * sport decides which metrics take part: OpenField names its columns the
 * same in every sport, so a hockey export with a "Contacts" or "Scrum Count"
 * column must never fill a rugby metric.
 */

/** Normal form used to compare aliases: trimmed, single spaces, lower case. */
export function normalizeCatapultAlias(alias: string): string {
  return alias.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A metric of the club's dictionary, as the alias index reads it. */
export interface CatapultAliasedMetric {
  readonly code: string;
  /** Sports where the metric applies; `null` (or omitted) is every sport. */
  readonly sports?: readonly Sport[] | null;
  readonly catapultAliases: readonly string[];
  /** Archived metrics take no new values. */
  readonly archived?: boolean;
}

/** Whether a metric with these sports applies to a session of `sport`. */
export function metricAppliesToSport(
  sports: readonly Sport[] | null | undefined,
  sport: Sport,
): boolean {
  return sports === null || sports === undefined || sports.includes(sport);
}

export interface CatapultAliasIndex {
  /** Normalized column name → metric code. */
  readonly byAlias: ReadonlyMap<string, string>;
  /**
   * The same column claimed by more than one metric of the sport: it maps to
   * none of them (the importer asks instead of guessing).
   */
  readonly conflicts: readonly { readonly alias: string; readonly codes: readonly string[] }[];
}

/**
 * The alias index of a sport: the aliases of the active metrics that apply
 * to it. Metrics of other sports and archived ones are left out; an alias
 * shared by two metrics of the sport is a conflict and maps to neither.
 */
export function catapultAliasIndex(
  metrics: readonly CatapultAliasedMetric[],
  sport: Sport,
): CatapultAliasIndex {
  const claims = new Map<string, string[]>();
  for (const metric of metrics) {
    if (metric.archived === true || !metricAppliesToSport(metric.sports, sport)) continue;
    for (const alias of metric.catapultAliases) {
      const key = normalizeCatapultAlias(alias);
      if (key === '') continue;
      const codes = claims.get(key) ?? [];
      if (!codes.includes(metric.code)) codes.push(metric.code);
      claims.set(key, codes);
    }
  }
  const byAlias = new Map<string, string>();
  const conflicts: { alias: string; codes: string[] }[] = [];
  for (const [alias, codes] of claims) {
    const [only, ...rest] = codes;
    if (only !== undefined && rest.length === 0) byAlias.set(alias, only);
    else conflicts.push({ alias, codes });
  }
  return { byAlias, conflicts };
}

/** The metric of an export column for the sport, if exactly one claims it. */
export function catapultMetricOf(index: CatapultAliasIndex, column: string): string | undefined {
  return index.byAlias.get(normalizeCatapultAlias(column));
}
