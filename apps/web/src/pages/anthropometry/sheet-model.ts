import {
  ANTHRO_HEIGHT_MAX_CM,
  ANTHRO_SITTING_HEIGHT_MAX_CM,
  ANTHRO_SKINFOLDS_SUM_MAX_MM,
  ANTHRO_WEIGHT_MAX_KG,
  ApiError,
  type AnthroMeasurementInput,
  type ValidationIssue,
} from '@sport-performance/contracts';
import { parseUuid, type LocalDate, type PlayerId, type Uuid } from '@sport-performance/domain';
import { parseNumber, type MessageKey } from '@sport-performance/i18n';

/**
 * Pure model of the sheet of a measurement day (B-412): what the staff
 * typed per player (es-AR text), parsed and checked before it goes to the
 * API, the payloads of the preview and of the batch, and the API's issues
 * mapped back to rows and fields.
 */

export const SHEET_FIELDS = ['heightCm', 'sittingHeightCm', 'weightKg', 'skinfoldsSumMm'] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];

/** Hard bounds of the contract: beyond them it is a typo, never sent. */
export const FIELD_MAX: Readonly<Record<SheetField, number>> = {
  heightCm: ANTHRO_HEIGHT_MAX_CM,
  sittingHeightCm: ANTHRO_SITTING_HEIGHT_MAX_CM,
  weightKg: ANTHRO_WEIGHT_MAX_KG,
  skinfoldsSumMm: ANTHRO_SKINFOLDS_SUM_MAX_MM,
};

/** What was typed for one player, and the `clientUuid` that makes saving it safe to retry. */
export interface RowDraft {
  readonly clientUuid: Uuid;
  readonly values: Readonly<Partial<Record<SheetField, string>>>;
}

export type FieldProblem = 'number' | 'range' | 'sittingAboveHeight';

export interface ParsedRow {
  readonly playerId: PlayerId;
  readonly values: Readonly<Partial<Record<SheetField, number>>>;
  readonly problems: Readonly<Partial<Record<SheetField, FieldProblem>>>;
  /** Anything typed at all (valid or not). */
  readonly touched: boolean;
}

export function newDraft(): RowDraft {
  return { clientUuid: parseUuid(crypto.randomUUID()), values: {} };
}

/** One typed value: empty, a number within the hard bounds, or the reason it is not. */
export function parseField(
  text: string | undefined,
  field: SheetField,
): { value?: number; problem?: FieldProblem } {
  if (text === undefined || text.trim() === '') return {};
  // Short measures: no thousands separators (`1.650` is a typo, not 1650).
  const value = parseNumber(text, { allowGrouping: false });
  if (value === null) return { problem: 'number' };
  if (value <= 0 || value > FIELD_MAX[field]) return { problem: 'range' };
  return { value };
}

export function parseRow(playerId: PlayerId, draft: RowDraft | undefined): ParsedRow {
  const values: Partial<Record<SheetField, number>> = {};
  const problems: Partial<Record<SheetField, FieldProblem>> = {};
  let touched = false;
  for (const field of SHEET_FIELDS) {
    const text = draft?.values[field];
    if (text !== undefined && text.trim() !== '') touched = true;
    const parsed = parseField(text, field);
    if (parsed.value !== undefined) values[field] = parsed.value;
    if (parsed.problem !== undefined) problems[field] = parsed.problem;
  }
  if (
    values.heightCm !== undefined &&
    values.sittingHeightCm !== undefined &&
    values.sittingHeightCm >= values.heightCm
  ) {
    problems.sittingHeightCm = 'sittingAboveHeight';
    delete values.sittingHeightCm;
  }
  return { playerId, values, problems, touched };
}

export function hasProblems(row: ParsedRow): boolean {
  return Object.keys(row.problems).length > 0;
}

export function hasValues(row: ParsedRow): boolean {
  return Object.keys(row.values).length > 0;
}

/** The whole squad, with the valid values typed so far (the preview shows gaps before typing). */
export function previewPayload(rows: readonly ParsedRow[], measuredOn: LocalDate) {
  return rows.map((row) => ({ playerId: row.playerId, measuredOn, ...row.values }));
}

/** The batch to save: the rows with values and no problems, in order, with their `clientUuid`. */
export function savePayload(
  rows: readonly ParsedRow[],
  drafts: Readonly<Record<string, RowDraft>>,
  measuredOn: LocalDate,
): AnthroMeasurementInput[] {
  return rows.filter(hasValues).map((row) => {
    // A row only has values from its draft: without one, a fresh uuid would break retries.
    const draft = drafts[row.playerId];
    if (draft === undefined) throw new Error(`savePayload: no draft for player ${row.playerId}`);
    return { clientUuid: draft.clientUuid, playerId: row.playerId, measuredOn, ...row.values };
  });
}

export type IssueTarget = SheetField | 'playerId' | 'measuredOn';

/** The message of an API issue on a row: the server's text is for developers only. */
function issueMessage(target: IssueTarget, issue: ValidationIssue): MessageKey {
  if (issue.code === 'consent_required') return 'anthropometry.error.consent';
  switch (target) {
    case 'sittingHeightCm':
      return 'anthropometry.error.sittingAboveHeight';
    case 'skinfoldsSumMm':
      return 'anthropometry.error.skinfoldsStage';
    case 'measuredOn':
      return 'anthropometry.error.date';
    case 'playerId':
      return 'anthropometry.error.player';
    default:
      return 'anthropometry.error.value';
  }
}

const TARGETS: readonly IssueTarget[] = [...SHEET_FIELDS, 'playerId', 'measuredOn'];

/**
 * `validation_failed` of a batch (`body.measurements.<i>.<field>`) by player
 * and field, with the message to show. `null` when the error is not about rows.
 */
export function rowIssues(
  error: unknown,
  sent: readonly Pick<AnthroMeasurementInput, 'playerId'>[],
): Map<string, Partial<Record<IssueTarget, MessageKey>>> | null {
  if (!(error instanceof ApiError) || error.code !== 'validation_failed') return null;
  const byPlayer = new Map<string, Partial<Record<IssueTarget, MessageKey>>>();
  for (const issue of error.details) {
    const [body, list, index, field] = issue.path;
    if (body !== 'body' || list !== 'measurements' || typeof index !== 'number') continue;
    const playerId = sent[index]?.playerId;
    if (playerId === undefined) continue;
    const target = TARGETS.find((t) => t === field) ?? 'playerId';
    const own = byPlayer.get(playerId) ?? {};
    own[target] ??= issueMessage(target, issue);
    byPlayer.set(playerId, own);
  }
  return byPlayer.size === 0 ? null : byPlayer;
}
