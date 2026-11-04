import type { MenstrualCycleStatus, SyncOperationRequest } from '@sport-performance/contracts';
import {
  MENSTRUAL_NOTE_MAX_LENGTH,
  MENSTRUAL_SYMPTOMS,
  menstrualCycleDayIssues,
  normalizeMenstrualSymptoms,
  type MenstrualFlow,
  type MenstrualSymptom,
} from '@sport-performance/domain';

/**
 * The day the player is logging (B-806, ADR 0092), before it goes to the
 * offline queue. Pure: the screen holds it in its state and never on disk, so
 * a day left half-way does not stay on the phone. A day goes in two taps
 * (the bleeding and "Guardar"), principle 5; symptoms and note are optional.
 */
export interface CycleDraft {
  /** `null` until the player picks one. */
  readonly flow: MenstrualFlow | null;
  readonly symptoms: readonly MenstrualSymptom[];
  readonly note: string;
}

export const EMPTY_CYCLE_DRAFT: CycleDraft = { flow: null, symptoms: [], note: '' };

export function setFlow(draft: CycleDraft, flow: MenstrualFlow): CycleDraft {
  return { ...draft, flow };
}

/** Marks or unmarks a symptom; kept in the vocabulary's order. */
export function toggleSymptom(draft: CycleDraft, symptom: MenstrualSymptom): CycleDraft {
  const symptoms = draft.symptoms.includes(symptom)
    ? draft.symptoms.filter((s) => s !== symptom)
    : [...draft.symptoms, symptom];
  return { ...draft, symptoms: normalizeMenstrualSymptoms(symptoms) };
}

export function setNote(draft: CycleDraft, note: string): CycleDraft {
  return { ...draft, note };
}

export type CycleDraftProblem = 'no_flow' | 'note_too_long';

/** What stops the day from being saved, or `null` when it can go. */
export function cycleDraftProblem(draft: CycleDraft): CycleDraftProblem | null {
  if (draft.flow === null) return 'no_flow';
  const note = draft.note.trim();
  const issues = menstrualCycleDayIssues({
    flow: draft.flow,
    symptoms: draft.symptoms,
    note: note === '' ? null : note,
  });
  return issues.some((issue) => issue.problem === 'note_too_long') ? 'note_too_long' : null;
}

/**
 * The input of the `menstrual_cycle.log` mutation (the online endpoint's
 * body), with the `clientUuid` the queue reconciles it by and the club day it
 * is about. Throws for a draft that cannot be saved ({@link cycleDraftProblem}).
 */
export function menstrualCycleMutation(
  draft: CycleDraft,
  { clientUuid, localDate }: { readonly clientUuid: string; readonly localDate?: string },
): SyncOperationRequest<'menstrual_cycle.log'> {
  const problem = cycleDraftProblem(draft);
  if (problem !== null || draft.flow === null) {
    throw new Error(`The day cannot be saved yet: ${problem ?? 'no_flow'}`);
  }
  const note = draft.note.trim();
  return {
    body: {
      clientUuid,
      ...(localDate !== undefined && { localDate }),
      flow: draft.flow,
      symptoms: normalizeMenstrualSymptoms(draft.symptoms),
      ...(note !== '' && { note }),
    },
  };
}

/** Every symptom the player can mark, in order. */
export const CYCLE_SYMPTOMS: readonly MenstrualSymptom[] = MENSTRUAL_SYMPTOMS;
export const CYCLE_NOTE_MAX_LENGTH = MENSTRUAL_NOTE_MAX_LENGTH;

/**
 * What the screen shows, from the server's status (never kept on the phone:
 * health data) and whether the phone is online.
 */
export type CycleScreenState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'unavailable';
      readonly reason: NonNullable<MenstrualCycleStatus['unavailableReason']>;
      /** Still on (a consent was revoked): she can turn it off. */
      readonly tracking: boolean;
    }
  | { readonly kind: 'off' }
  | { readonly kind: 'on'; readonly status: MenstrualCycleStatus };

export function cycleScreenState(input: {
  readonly status: MenstrualCycleStatus | undefined;
  readonly failed: boolean;
  readonly offline: boolean;
}): CycleScreenState {
  const { status } = input;
  if (status === undefined) {
    if (input.offline) return { kind: 'offline' };
    return input.failed ? { kind: 'error' } : { kind: 'loading' };
  }
  // Still on with a consent missing (or the module off): nothing new goes in, she can turn it off.
  if (status.unavailableReason !== null) {
    return { kind: 'unavailable', reason: status.unavailableReason, tracking: status.tracking };
  }
  return status.tracking ? { kind: 'on', status } : { kind: 'off' };
}
