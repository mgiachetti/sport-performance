import type { ConsentType } from '../consent.js';
import { memberGuard, memberParser } from '../enum.js';

/**
 * The pod fleet and its assignment to players (B-912, ADR 0106).
 *
 * - A **pod device** is the physical unit, global to the platform: a serial
 *   number unique in the whole system (printed, and in the QR on the pod),
 *   the chip id (FICR `DEVICEID`, from which the keys are derived) and the
 *   hardware revision. Only the superadmin and the programming station
 *   register them; the device names the club that owns it.
 * - A **pod** is a club's view of a device: the short id in the club's LoRa
 *   network, the number painted on the pod and the vest, its status and the
 *   last health the base reported. A device lent to another club gets a pod
 *   in that club for the loan (`pod_loan`), and the owner's one is `lent`.
 * - A **pod assignment** says which player wears a pod and when: a half-open
 *   range `[startsAt, endsAt)` (`endsAt` `null` while it is worn). Never two
 *   at once for the same pod nor for the same player. Only for players with
 *   their `data` and `location` consents (the latter granted on the current
 *   text, B-913) and in the categories with pods enabled (M19 and the first
 *   team by default).
 */

// ─── Devices ─────────────────────────────────────────────────────────────────────────

/**
 * Where a device is in its life: `unprovisioned` from the factory until the
 * programming station loads its firmware and identity, `provisioned` while
 * in use, `decommissioned` once it is out of the fleet for good.
 */
export const POD_PROVISIONING_STATES = ['unprovisioned', 'provisioned', 'decommissioned'] as const;
export type PodProvisioningState = (typeof POD_PROVISIONING_STATES)[number];
export const isPodProvisioningState = memberGuard(POD_PROVISIONING_STATES);

/**
 * Serial number printed on the pod and in its QR: 4 to 32 characters,
 * uppercase letters, digits and inner dashes (`SPP-0001`). Unique in the
 * platform. The database checks the same pattern (`pod_device_serial_format`).
 */
export const POD_SERIAL_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,30}[A-Z0-9]$/;

/** The chip id: FICR `DEVICEID[0..1]` in memory order, 8 bytes as 16 lowercase hex digits. */
export const POD_CHIP_ID_PATTERN = /^[0-9a-f]{16}$/;

/** Hardware revision of the board (`v0`, `v1.2`, `rev-b`). */
export const POD_HARDWARE_REVISION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,15}$/;

/** Normalizes what the QR or the staff typed into a serial number (trimmed, uppercase). */
export function normalizePodSerial(value: string): string {
  return value.trim().toUpperCase();
}

/** Whether `value` is a well-formed serial number (already normalized). */
export function isPodSerial(value: string): boolean {
  return POD_SERIAL_PATTERN.test(value);
}

// ─── Pods of a club ──────────────────────────────────────────────────────────────────

/**
 * Status of a pod in a club:
 * - `active`: in the fleet, can be assigned;
 * - `lent`: the club's own pod, lent to another club for now (`pod_loan`);
 * - `lost` / `stolen`: missing; its keys are revoked and the fleet staff sees
 *   its last known position;
 * - `retired`: out of the club's fleet for good (also the pod a club had for a
 *   loan, once the loan ends). A retired pod frees its number and short id.
 */
export const POD_STATUSES = ['active', 'lent', 'lost', 'stolen', 'retired'] as const;
export type PodStatus = (typeof POD_STATUSES)[number];
export const isPodStatus = memberGuard(POD_STATUSES);
export const parsePodStatus = memberParser(POD_STATUSES, 'invalid_argument', 'pod status');

/** The two ways a pod goes missing. */
export const POD_MISSING_STATUSES = ['lost', 'stolen'] as const satisfies readonly PodStatus[];
export type PodMissingStatus = (typeof POD_MISSING_STATUSES)[number];

/** Whether a pod in `status` is missing (lost or stolen). */
export function isPodMissing(status: PodStatus): status is PodMissingStatus {
  return (POD_MISSING_STATUSES as readonly PodStatus[]).includes(status);
}

/**
 * Short id of the pod in the club's network (the `podShortId` of the LoRa
 * protocol, 2 bytes): 1 to 65534; 0 and 0xFFFF are reserved. Unique among the
 * club's pods that are not retired.
 */
export const POD_SHORT_ID_MIN = 1;
export const POD_SHORT_ID_MAX = 0xfffe;

/** Number painted on the pod and on its vest: 1 to 999, unique among the club's pods that are not retired. */
export const POD_NUMBER_MIN = 1;
export const POD_NUMBER_MAX = 999;

/** Longest free label of a pod ("Repuesto", "Chaleco talle S"). */
export const POD_LABEL_MAX_LENGTH = 60;

/**
 * The lowest short id not in `taken`, or `null` when the network is full.
 * A new pod (or a lent one, in the club that receives it) takes it unless
 * the staff chose one.
 */
export function nextPodShortId(taken: Iterable<number>): number | null {
  const used = new Set(taken);
  for (let id = POD_SHORT_ID_MIN; id <= POD_SHORT_ID_MAX; id += 1) {
    if (!used.has(id)) return id;
  }
  return null;
}

/** Statuses the fleet staff may move a pod to from each one (`lent` only by a loan). */
const POD_TRANSITIONS: Readonly<Record<PodStatus, readonly PodStatus[]>> = {
  active: ['lost', 'stolen', 'retired'],
  lent: [],
  lost: ['active', 'stolen', 'retired'],
  stolen: ['active', 'lost', 'retired'],
  retired: [],
};

/** Whether the fleet staff may move a pod from `from` to `to`. */
export function canChangePodStatus(from: PodStatus, to: PodStatus): boolean {
  return POD_TRANSITIONS[from].includes(to);
}

// ─── Assignments ─────────────────────────────────────────────────────────────────────

/** Consents a player needs to be assigned a pod (`location` only when granted, B-913). */
export const POD_ASSIGNMENT_CONSENTS = [
  'data',
  'location',
] as const satisfies readonly ConsentType[];

/** Longest note of an assignment ("cambió de chaleco en el entretiempo"). */
export const POD_ASSIGNMENT_NOTE_MAX_LENGTH = 200;

/**
 * Longest closed assignment, in hours: a pod is worn for a session, a match
 * day or a tour; one longer is a typing mistake.
 */
export const POD_ASSIGNMENT_MAX_HOURS = 24 * 14;

/**
 * Default categories with pods (ADR 0106): M19. The first team (adults) joins
 * with its age band (B-920). Data, not a rule: the club turns pods on or off
 * per category (`category.pods_enabled`).
 */
export const DEFAULT_POD_AGE_BAND_CODES: readonly string[] = ['m19'];

/** Whether a category of `ageBandCode` has pods by default. */
export function podsEnabledByDefault(ageBandCode: string): boolean {
  return DEFAULT_POD_AGE_BAND_CODES.includes(ageBandCode);
}

/** A time range of an assignment: `[startsAt, endsAt)`, open while `endsAt` is `null`. */
export interface PodAssignmentRange {
  readonly startsAt: Date;
  readonly endsAt: Date | null;
}

/** Whether two half-open ranges share an instant (an open end runs forever). */
export function podAssignmentRangesOverlap(a: PodAssignmentRange, b: PodAssignmentRange): boolean {
  const aEnd = a.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = b.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return a.startsAt.getTime() < bEnd && b.startsAt.getTime() < aEnd;
}

/** Problems with the range itself. */
export type PodAssignmentRangeProblem = 'ends_before_start' | 'too_long';

/**
 * Checks a range: the end after the start and, when closed, at most
 * {@link POD_ASSIGNMENT_MAX_HOURS} long. `null` when it is fine.
 */
export function podAssignmentRangeProblem(
  range: PodAssignmentRange,
): PodAssignmentRangeProblem | null {
  if (range.endsAt === null) return null;
  const ms = range.endsAt.getTime() - range.startsAt.getTime();
  if (ms <= 0) return 'ends_before_start';
  if (ms > POD_ASSIGNMENT_MAX_HOURS * 3_600_000) return 'too_long';
  return null;
}

/** An existing assignment, as the rules compare it. */
export interface ExistingPodAssignment extends PodAssignmentRange {
  readonly id: string;
  readonly podId: string;
  readonly playerId: string;
}

/** What is needed to decide whether a pod may be assigned to a player. */
export interface PodAssignmentCandidate extends PodAssignmentRange {
  readonly podId: string;
  readonly playerId: string;
  readonly podStatus: PodStatus;
  /** Whether the category the assignment is for (the session's, else a current one of the player) has pods. */
  readonly categoryPodsEnabled: boolean;
  /** The player's consents that count (`app.current_consent_types`). */
  readonly consents: readonly ConsentType[];
  /** The live (not voided) assignments of the same pod or the same player. */
  readonly existing: readonly ExistingPodAssignment[];
  /** The assignment being corrected, left out of the overlap check. */
  readonly ignoreId?: string;
}

/**
 * Why a pod cannot be assigned, in the order the API checks and answers
 * them: the range, the pod, the category, the consents and the overlaps.
 */
export type PodAssignmentProblem =
  | { readonly code: PodAssignmentRangeProblem }
  | { readonly code: 'pod_not_active'; readonly status: PodStatus }
  | { readonly code: 'category_not_enabled' }
  | { readonly code: 'consent_required'; readonly missing: readonly ConsentType[] }
  | { readonly code: 'pod_overlap'; readonly assignmentId: string }
  | { readonly code: 'player_overlap'; readonly assignmentId: string };

/** The first problem of an assignment, or `null` when it may be made. */
export function podAssignmentProblem(
  candidate: PodAssignmentCandidate,
): PodAssignmentProblem | null {
  const range = podAssignmentRangeProblem(candidate);
  if (range !== null) return { code: range };
  if (candidate.podStatus !== 'active') {
    return { code: 'pod_not_active', status: candidate.podStatus };
  }
  if (!candidate.categoryPodsEnabled) return { code: 'category_not_enabled' };
  const missing = POD_ASSIGNMENT_CONSENTS.filter((type) => !candidate.consents.includes(type));
  if (missing.length > 0) return { code: 'consent_required', missing };
  const clashes = candidate.existing.filter(
    (other) => other.id !== candidate.ignoreId && podAssignmentRangesOverlap(candidate, other),
  );
  // The pod first: the vest is what the staff is handing out.
  const pod = clashes.find((other) => other.podId === candidate.podId);
  if (pod !== undefined) return { code: 'pod_overlap', assignmentId: pod.id };
  const player = clashes.find((other) => other.playerId === candidate.playerId);
  if (player !== undefined) return { code: 'player_overlap', assignmentId: player.id };
  return null;
}

/**
 * Whether an assignment covers `at` (the live screen and the ingestion ask
 * which player wore a pod at an instant).
 */
export function podAssignmentCovers(range: PodAssignmentRange, at: Date): boolean {
  const t = at.getTime();
  return range.startsAt.getTime() <= t && (range.endsAt === null || t < range.endsAt.getTime());
}

/**
 * Whether a correction changes what the pod's data belongs to (the range):
 * then the worker reprocesses the affected sessions while the raw data is
 * still pending (ADR 0106), and the assignment is flagged for it.
 */
export function podAssignmentNeedsReprocess(
  before: PodAssignmentRange,
  after: PodAssignmentRange,
): boolean {
  return (
    before.startsAt.getTime() !== after.startsAt.getTime() ||
    (before.endsAt?.getTime() ?? null) !== (after.endsAt?.getTime() ?? null)
  );
}
