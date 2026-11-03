import type {
  AvailabilityStatus,
  CanonicalTestCode,
  ConsentSigner,
  ConsentType,
  DominantSide,
  FixtureVenue,
  GuardianRelationship,
  HeightSource,
  InjuryBodyRegion,
  InjuryContext,
  InjuryMechanism,
  InjuryOnset,
  InjurySide,
  LocalDate,
  MeasurementMethod,
  MembershipRole,
  Parent,
  ParticipationStatus,
  PlayerLeaveReason,
  Sex,
  Sport,
  TestEntryInput,
  TestNotDoneReason,
  TimeZone,
} from '@sport-performance/domain';
import type { TestConditions } from '../../schema/testing.js';

/**
 * The demo dataset (B-307, ADR 0055): what {@link generateDemoDataset}
 * produces and `seedDemoClub` writes. Rows carry their final ids (stable
 * UUIDs of their natural key) and point to the configuration the bootstrap
 * seeds (categories, positions, metrics, tests, consent texts) by natural
 * key, resolved when written.
 */

/** A category of the club by its natural key (the bootstrap creates one per age band and branch). */
export interface DemoCategoryKey {
  readonly sport: Sport;
  readonly sex: Sex;
  readonly ageBandCode: string;
}

export interface DemoClub {
  readonly slug: string;
  readonly name: string;
  readonly shortName: string;
  readonly timeZone: TimeZone;
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly seed: string;
}

export interface DemoUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface DemoMembership {
  readonly id: string;
  readonly clientUuid: string;
  readonly userId: string;
  readonly role: MembershipRole;
  readonly startedAt: Date;
}

export interface DemoStaffAssignment {
  readonly id: string;
  readonly clientUuid: string;
  readonly membershipId: string;
  readonly category: DemoCategoryKey | null;
  readonly sport: Sport | null;
  readonly validFrom: LocalDate;
}

export interface DemoDevice {
  readonly id: string;
  readonly clientUuid: string;
  readonly kind: 'phone' | 'tablet';
  readonly label: string;
  readonly model: string;
  readonly serialNumber: string;
}

export interface DemoSeason {
  readonly id: string;
  readonly clientUuid: string;
  readonly sport: Sport;
  readonly year: number;
  readonly name: string;
  readonly startsOn: LocalDate;
  readonly endsOn: LocalDate;
}

export interface DemoTestWindow {
  readonly id: string;
  readonly clientUuid: string;
  readonly seasonId: string;
  readonly sport: Sport;
  readonly number: 1 | 2 | 3 | 4;
  readonly startsOn: LocalDate;
  readonly endsOn: LocalDate;
}

export interface DemoPlayer {
  readonly id: string;
  readonly clientUuid: string;
  /** Natural key (`rugby:2010:3`), for tests and logs; never stored. */
  readonly key: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate: LocalDate;
  readonly sex: Sex;
  readonly sport: Sport;
  readonly dominantSide: DominantSide;
  readonly joinedOn: LocalDate;
  /** The player's own account (M17/M19 and adults); `null` for younger players. */
  readonly userId: string | null;
  readonly leftOn: LocalDate | null;
  readonly leftReason: PlayerLeaveReason | null;
  readonly archivedAt: Date | null;
  /** Scenario the player was given, for tests and the README; never stored. */
  readonly scenario: DemoScenario;
}

/**
 * What a player is there to show (CLAUDE.md, "Alertas por defecto"): the
 * scenarios recur on a calendar cycle with a different phase per cohort, so
 * on any day some player of the club is in each of them.
 */
export type DemoScenario =
  'none' | 'load_spike' | 'wellness_slump' | 'detraining' | 'cmj_fatigue' | 'injury_prone';

/** A player of an earlier season who finished the oldest band: only their leave. */
export interface DemoDeparture {
  readonly playerId: string;
  readonly leftOn: LocalDate;
  readonly archivedAt: Date;
}

export interface DemoPlayerPosition {
  readonly id: string;
  readonly clientUuid: string;
  readonly playerId: string;
  readonly sport: Sport;
  readonly positionCode: string;
  readonly sortOrder: number;
}

export interface DemoParentHeight {
  readonly id: string;
  readonly clientUuid: string;
  readonly playerId: string;
  readonly parent: Parent;
  readonly heightCm: number;
  readonly source: HeightSource;
}

export interface DemoPlayerCategory {
  readonly id: string;
  readonly clientUuid: string;
  readonly playerId: string;
  readonly category: DemoCategoryKey;
  readonly seasonId: string;
  readonly validFrom: LocalDate;
  readonly validTo: LocalDate | null;
}

export interface DemoGuardian {
  readonly id: string;
  readonly clientUuid: string;
  readonly playerId: string;
  readonly userId: string;
  readonly relationship: GuardianRelationship;
  readonly validFrom: LocalDate;
}

export interface DemoConsent {
  readonly id: string;
  readonly clientUuid: string;
  readonly playerId: string;
  readonly type: ConsentType;
  readonly signerKind: ConsentSigner;
  readonly signedBy: string;
  readonly signedAt: Date;
}

export interface DemoFixture {
  readonly id: string;
  readonly clientUuid: string;
  readonly category: DemoCategoryKey;
  readonly opponent: string;
  readonly venue: FixtureVenue;
  readonly competition: string;
  readonly matchDate: LocalDate;
  /** `HH:MM:SS`, the club's wall clock. */
  readonly kickoffTime: string;
  readonly location: string;
}

export interface DemoTrainingSession {
  readonly id: string;
  readonly clientUuid: string;
  readonly sport: Sport;
  readonly kind: 'training' | 'match';
  readonly category: DemoCategoryKey;
  readonly title: string;
  readonly startsAt: Date;
  readonly localDate: LocalDate;
  readonly plannedDurationMin: number;
  readonly location: string;
  readonly opponent: string | null;
}

export interface DemoParticipation {
  readonly id: string;
  readonly clientUuid: string;
  readonly trainingSessionId: string;
  readonly playerId: string;
  readonly status: ParticipationStatus;
  readonly minutes: number | null;
  readonly contactsN: number | null;
  readonly rpe: number | null;
  readonly rpeReportedAt: Date | null;
  /** Club day of the session, for tests (never stored here). */
  readonly localDate: LocalDate;
}

/**
 * A field metric of a session (B-408): the total of one Catapult export row,
 * as the importer (B-601) will write it (`drill_id` empty, `external_ref` of
 * the activity and player).
 */
export interface DemoExternalMetric {
  readonly id: string;
  readonly clientUuid: string;
  readonly trainingSessionId: string;
  readonly playerId: string;
  readonly metricCode: string;
  readonly localDate: LocalDate;
  readonly value: number;
  readonly source: 'catapult';
  readonly externalRef: string;
}

export interface DemoWellness {
  readonly id: string;
  readonly clientUuid: string;
  readonly playerId: string;
  readonly localDate: LocalDate;
  readonly itemCount: 3 | 5;
  readonly sleep: number;
  readonly fatigue: number;
  readonly soreness: number;
  readonly stress: number | null;
  readonly mood: number | null;
  readonly submittedAt: Date;
}

export interface DemoTestSession {
  readonly id: string;
  readonly clientUuid: string;
  readonly sport: Sport;
  readonly testWindowId: string | null;
  readonly category: DemoCategoryKey;
  readonly scheduledOn: LocalDate;
  readonly status: 'scheduled' | 'completed';
  readonly location: string;
  readonly conditions: TestConditions;
  readonly notes: string | null;
  readonly evaluatorId: string;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
}

export interface DemoTestResult {
  readonly id: string;
  readonly clientUuid: string;
  readonly playerId: string;
  readonly testCode: CanonicalTestCode;
  readonly testSessionId: string;
  readonly measuredOn: LocalDate;
  readonly status: 'done' | 'not_done';
  readonly notDoneReason: TestNotDoneReason | null;
  readonly method: MeasurementMethod | null;
  readonly evaluatorId: string;
  readonly deviceId: string | null;
  readonly exercise: string | null;
  readonly conditions: TestConditions;
}

export interface DemoTestValue {
  readonly id: string;
  readonly clientUuid: string;
  readonly testResultId: string;
  readonly metricCode: string;
  readonly attemptNumber: number | null;
  readonly entryId: string;
  /** What the evaluator typed (`null` for a value typed as is), as the API stores it. */
  readonly inputs: Readonly<Record<string, unknown>> | null;
  readonly value: number;
  readonly recordedAt: Date;
}

export interface DemoAnthro {
  readonly id: string;
  readonly clientUuid: string;
  readonly playerId: string;
  readonly measuredOn: LocalDate;
  readonly heightCm: number;
  readonly sittingHeightCm: number;
  readonly weightKg: number;
  readonly skinfoldsSumMm: number | null;
  readonly evaluatorId: string;
}

export interface DemoReferenceValue {
  readonly id: string;
  readonly clientUuid: string;
  readonly metricCode: string;
  readonly sport: Sport;
  readonly sex: Sex;
  readonly lineCode: string | null;
  readonly value: number;
  readonly method: MeasurementMethod;
  readonly validFrom: LocalDate;
  readonly source: string;
}

export interface DemoInjury {
  readonly id: string;
  readonly clientUuid: string;
  readonly playerId: string;
  readonly onsetOn: LocalDate;
  readonly context: InjuryContext;
  readonly bodyRegion: InjuryBodyRegion;
  readonly side: InjurySide;
  readonly onset: InjuryOnset;
  readonly mechanism: InjuryMechanism;
  readonly diagnosis: string;
  readonly expectedReturnOn: LocalDate;
  /** Set once the return day has passed (`asOf` after it). */
  readonly returnedOn: LocalDate | null;
}

export interface DemoHold {
  readonly id: string;
  readonly clientUuid: string;
  readonly playerId: string;
  readonly injuryId: string;
  readonly training: AvailabilityStatus;
  readonly match: AvailabilityStatus;
  readonly validFrom: LocalDate;
  readonly validTo: LocalDate;
  readonly staffNote: string;
}

export interface DemoDataset {
  readonly club: DemoClub;
  readonly asOf: LocalDate;
  readonly branches: readonly { readonly sport: Sport; readonly sex: Sex }[];
  readonly users: readonly DemoUser[];
  readonly memberships: readonly DemoMembership[];
  readonly staffAssignments: readonly DemoStaffAssignment[];
  readonly devices: readonly DemoDevice[];
  readonly seasons: readonly DemoSeason[];
  readonly testWindows: readonly DemoTestWindow[];
  readonly players: readonly DemoPlayer[];
  /** Leaves of players of earlier seasons, out of the window (applied if the player exists). */
  readonly departures: readonly DemoDeparture[];
  readonly playerPositions: readonly DemoPlayerPosition[];
  readonly parentHeights: readonly DemoParentHeight[];
  readonly playerCategories: readonly DemoPlayerCategory[];
  readonly guardians: readonly DemoGuardian[];
  readonly consents: readonly DemoConsent[];
  readonly fixtures: readonly DemoFixture[];
  readonly trainingSessions: readonly DemoTrainingSession[];
  readonly participations: readonly DemoParticipation[];
  /** Catapult totals of the M17 and M19 rugby sessions (field session view, B-408). */
  readonly externalMetrics: readonly DemoExternalMetric[];
  readonly wellness: readonly DemoWellness[];
  readonly testSessions: readonly DemoTestSession[];
  readonly testResults: readonly DemoTestResult[];
  readonly testValues: readonly DemoTestValue[];
  readonly anthropometry: readonly DemoAnthro[];
  readonly referenceValues: readonly DemoReferenceValue[];
  readonly injuries: readonly DemoInjury[];
  readonly holds: readonly DemoHold[];
}

/** One raw entry of a generated result, before scoring. */
export interface DemoEntry {
  readonly attemptNumber: number | null;
  readonly entry: TestEntryInput;
}
