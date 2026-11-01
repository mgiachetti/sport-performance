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

/**
 * Default position → line mapping, ready to seed (B-306). Rugby union only;
 * hockey positions and lines arrive with M8 (B-804).
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
] as const satisfies readonly (PositionLine & { readonly lineCode: RugbyLineCode })[];

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
