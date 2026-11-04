import type { SyncOperationRequest } from '@sport-performance/contracts';
import {
  PAIN_AREAS_MAX,
  PAIN_COMMENT_MAX_LENGTH,
  painCommentLength,
  painAreaKey,
  painReportIssues,
  type PainBodyRegion,
  type PainSide,
} from '@sport-performance/domain';

/**
 * The answer the player is giving, before it goes to the offline queue
 * (B-609, ADR 0078). Pure: the screen holds it in its state and never on
 * disk, so an answer left half-way does not stay on the phone.
 */

export interface DraftArea {
  readonly region: PainBodyRegion;
  readonly side: PainSide;
  /** `null` until the player picks it. */
  readonly intensity: number | null;
}

export interface PainDraft {
  /** `null` until the player answers yes or no. */
  readonly hasPain: boolean | null;
  readonly areas: readonly DraftArea[];
  readonly comment: string;
}

export const EMPTY_PAIN_DRAFT: PainDraft = { hasPain: null, areas: [], comment: '' };

export const keyOf = (area: Pick<DraftArea, 'region' | 'side'>): string => painAreaKey(area);

export function isMarked(draft: PainDraft, key: string): boolean {
  return draft.areas.some((area) => keyOf(area) === key);
}

/**
 * Marks or unmarks an area of the map. A new area waits for its intensity;
 * past {@link PAIN_AREAS_MAX} nothing more is marked (the comment takes the rest).
 */
export function togglePlace(draft: PainDraft, region: PainBodyRegion, side: PainSide): PainDraft {
  const key = painAreaKey({ region, side });
  if (isMarked(draft, key)) {
    return { ...draft, areas: draft.areas.filter((area) => keyOf(area) !== key) };
  }
  if (draft.areas.length >= PAIN_AREAS_MAX) return draft;
  return { ...draft, hasPain: true, areas: [...draft.areas, { region, side, intensity: null }] };
}

export function setIntensity(draft: PainDraft, key: string, intensity: number): PainDraft {
  return {
    ...draft,
    areas: draft.areas.map((area) => (keyOf(area) === key ? { ...area, intensity } : area)),
  };
}

export function setComment(draft: PainDraft, comment: string): PainDraft {
  return { ...draft, comment };
}

/** "Yes": the map opens. "No" keeps nothing of a map marked before. */
export function answer(draft: PainDraft, hasPain: boolean): PainDraft {
  return hasPain ? { ...draft, hasPain } : { hasPain, areas: [], comment: '' };
}

/** A word for an intensity, so the scale is never only a number. */
export function intensityBand(intensity: number): 'mild' | 'moderate' | 'severe' {
  if (intensity <= 3) return 'mild';
  if (intensity <= 6) return 'moderate';
  return 'severe';
}

export type DraftProblem =
  'no_answer' | 'no_areas' | 'missing_intensity' | 'comment_too_long' | 'invalid';

/** What stops the answer from being sent, or `null` when it can go. */
export function draftProblem(draft: PainDraft): DraftProblem | null {
  if (draft.hasPain === null) return 'no_answer';
  if (!draft.hasPain) return null;
  if (draft.areas.length === 0) return 'no_areas';
  if (draft.areas.some((area) => area.intensity === null)) return 'missing_intensity';
  if (painCommentLength(draft.comment.trim()) > PAIN_COMMENT_MAX_LENGTH) return 'comment_too_long';
  const body = bodyOf(draft);
  return body !== null && painReportIssues(body).length === 0 ? null : 'invalid';
}

function bodyOf(draft: PainDraft) {
  if (draft.hasPain === null) return null;
  const comment = draft.comment.trim();
  return {
    hasPain: draft.hasPain,
    areas: draft.hasPain
      ? draft.areas.map((area) => ({
          region: area.region,
          side: area.side,
          intensity: area.intensity ?? 0,
        }))
      : [],
    comment: draft.hasPain && comment !== '' ? comment : null,
  };
}

/**
 * The input of the `pain_report.submit` mutation (the online endpoint's
 * body), with the `clientUuid` the queue reconciles it by and the club day
 * it is about. Throws for a draft that cannot be sent ({@link draftProblem}).
 */
export function painReportMutation(
  draft: PainDraft,
  { clientUuid, localDate }: { readonly clientUuid: string; readonly localDate?: string },
): SyncOperationRequest<'pain_report.submit'> {
  const problem = draftProblem(draft);
  const body = bodyOf(draft);
  if (problem !== null || body === null) {
    throw new Error(`The pain report cannot be sent yet: ${problem ?? 'no_answer'}`);
  }
  return {
    body: {
      clientUuid,
      ...(localDate !== undefined && { localDate }),
      hasPain: body.hasPain,
      areas: body.areas,
      ...(body.comment !== null && { comment: body.comment }),
    },
  };
}
