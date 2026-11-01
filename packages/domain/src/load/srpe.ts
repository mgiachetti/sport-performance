import { assertFiniteInRange } from './validate.js';

/** Bounds of Borg's CR-10 scale (half points such as 0.5 are valid). */
export const RPE_CR10_MIN = 0;
export const RPE_CR10_MAX = 10;
/** Longest session accepted, in minutes (one day). */
export const MAX_SESSION_DURATION_MIN = 1440;

export interface SessionRpeInput {
  /** Session RPE on the CR-10 scale, 0–10. */
  readonly rpe: number;
  /** Minutes the player took part in the session. */
  readonly durationMin: number;
}

/**
 * Session RPE load (Foster et al. 2001): `sRPE = RPE × minutes`, in arbitrary
 * units (`srpe_au`). Throws {@link DomainValidationError} (`invalid_argument`)
 * when the RPE is outside CR-10 or the duration outside `[0, 1440]` minutes.
 */
export function sessionRpeLoadAu({ rpe, durationMin }: SessionRpeInput): number {
  assertFiniteInRange(rpe, 'rpe', RPE_CR10_MIN, RPE_CR10_MAX);
  assertFiniteInRange(durationMin, 'durationMin', 0, MAX_SESSION_DURATION_MIN);
  return rpe * durationMin;
}
