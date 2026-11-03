import type { MembershipSummary } from '@sport-performance/contracts';

/**
 * Which club the app acts in (ADR 0007, ADR 0028):
 * - `active`: the stored choice is still an active membership, or the user
 *   has exactly one (the API implies it too).
 * - `choose`: more than one and no valid choice: the club selector.
 * - `none`: no memberships: the user has to accept an invitation first.
 */
export type MembershipResolution =
  | { readonly kind: 'active'; readonly membership: MembershipSummary }
  | { readonly kind: 'choose' }
  | { readonly kind: 'none' };

export function resolveMembership(
  memberships: readonly MembershipSummary[],
  storedId: string | null,
): MembershipResolution {
  if (memberships.length === 0) return { kind: 'none' };
  const stored = storedId === null ? undefined : memberships.find((m) => m.id === storedId);
  if (stored !== undefined) return { kind: 'active', membership: stored };
  const [only] = memberships;
  if (memberships.length === 1 && only !== undefined) return { kind: 'active', membership: only };
  return { kind: 'choose' };
}

/** Selector order: by club name, then role, as the API lists them but stable on the device. */
export function sortMemberships(memberships: readonly MembershipSummary[]): MembershipSummary[] {
  return [...memberships].sort(
    (a, b) =>
      a.club.name.localeCompare(b.club.name, 'es-AR') || a.role.localeCompare(b.role, 'es-AR'),
  );
}
