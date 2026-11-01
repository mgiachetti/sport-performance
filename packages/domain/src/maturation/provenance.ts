import { memberGuard } from '../enum.js';

/**
 * How far the coefficients of a published model have been checked.
 *
 * - `verified_against_publication`: every value was compared with the original
 *   article (and its errata) by a person, and the check is recorded in the
 *   package README checklist.
 * - `cross_checked_secondary_sources`: the values agree across several
 *   independent reproductions (papers that quote the equation, open-source
 *   implementations), but nobody has compared them with the original article yet.
 * - `unverified`: a single source or none. Must not be used in production.
 *
 * The status is data, stored next to the coefficients (seed B-306), so the API
 * and the UI can show it and production can refuse unverified tables.
 */
export const COEFFICIENT_VERIFICATION_STATUSES = [
  'verified_against_publication',
  'cross_checked_secondary_sources',
  'unverified',
] as const;
export type CoefficientVerificationStatus = (typeof COEFFICIENT_VERIFICATION_STATUSES)[number];

export const isCoefficientVerificationStatus = memberGuard(COEFFICIENT_VERIFICATION_STATUSES);

/** Where a set of coefficients comes from and how it was checked. */
export interface CoefficientProvenance {
  /** Full citation of the original publication. */
  readonly citation: string;
  /** DOI of the original publication, or `null` if it has none. */
  readonly doi: string | null;
  /** Errata applied to the published values, if any. */
  readonly errata: readonly string[];
  readonly verification: CoefficientVerificationStatus;
  /** What was compared, against which sources, and what is pending. */
  readonly verificationNotes: string;
}
