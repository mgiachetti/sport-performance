import type { Sport } from '../sport.js';

/**
 * Playing line of a position ("forwards" / "backs" in rugby). Positions and
 * lines are data per sport (B-301 `position`); these are the defaults.
 */
export interface PositionLine {
  readonly sport: Sport;
  /** Position code, English `snake_case` (`fly_half`). */
  readonly positionCode: string;
  /** Line code, English `snake_case` (`forwards`). */
  readonly lineCode: string;
}

/** Default rugby lines. */
export const RUGBY_LINE_CODES = ['forwards', 'backs'] as const;
export type RugbyLineCode = (typeof RUGBY_LINE_CODES)[number];

/** Default field hockey lines (B-801): goalkeepers, defenders, midfielders, forwards. */
export const HOCKEY_LINE_CODES = ['goalkeepers', 'defenders', 'midfielders', 'forwards'] as const;
export type HockeyLineCode = (typeof HOCKEY_LINE_CODES)[number];

/**
 * Lines of each sport (B-801, ADR 0087). Fixed per sport: references and
 * percentiles by line stay comparable across clubs, so a club adds or
 * renames positions but always inside these lines.
 */
export const POSITION_LINE_CODES = {
  rugby: RUGBY_LINE_CODES,
  hockey: HOCKEY_LINE_CODES,
} as const satisfies Record<Sport, readonly string[]>;

/** Whether `lineCode` is one of the lines of `sport`. */
export function isPositionLineOf(sport: Sport, lineCode: string): boolean {
  return (POSITION_LINE_CODES[sport] as readonly string[]).includes(lineCode);
}

/**
 * Default position → line mapping per sport, seeded into every club
 * (`position`, B-306) and edited per club. Rugby union by position; field
 * hockey by the four lines of B-801 (arquera, defensora, volante, delantera).
 * A club refines them with its own positions inside the same lines (B-801).
 */
export const DEFAULT_POSITION_LINES = [
  { sport: 'rugby', positionCode: 'prop', lineCode: 'forwards' },
  { sport: 'rugby', positionCode: 'hooker', lineCode: 'forwards' },
  { sport: 'rugby', positionCode: 'lock', lineCode: 'forwards' },
  { sport: 'rugby', positionCode: 'flanker', lineCode: 'forwards' },
  { sport: 'rugby', positionCode: 'number_eight', lineCode: 'forwards' },
  { sport: 'rugby', positionCode: 'scrum_half', lineCode: 'backs' },
  { sport: 'rugby', positionCode: 'fly_half', lineCode: 'backs' },
  { sport: 'rugby', positionCode: 'centre', lineCode: 'backs' },
  { sport: 'rugby', positionCode: 'wing', lineCode: 'backs' },
  { sport: 'rugby', positionCode: 'fullback', lineCode: 'backs' },
  { sport: 'hockey', positionCode: 'goalkeeper', lineCode: 'goalkeepers' },
  { sport: 'hockey', positionCode: 'defender', lineCode: 'defenders' },
  { sport: 'hockey', positionCode: 'midfielder', lineCode: 'midfielders' },
  { sport: 'hockey', positionCode: 'forward', lineCode: 'forwards' },
] as const satisfies readonly (
  | (PositionLine & { readonly sport: 'rugby'; readonly lineCode: RugbyLineCode })
  | (PositionLine & { readonly sport: 'hockey'; readonly lineCode: HockeyLineCode })
)[];

/**
 * Line of a position in a sport, or `undefined` when the position is unknown
 * for that sport. The mapping is an input (club data); defaults above.
 */
export function lineForPosition(
  sport: Sport,
  positionCode: string,
  positionLines: readonly PositionLine[] = DEFAULT_POSITION_LINES,
): string | undefined {
  return positionLines.find((p) => p.sport === sport && p.positionCode === positionCode)?.lineCode;
}
