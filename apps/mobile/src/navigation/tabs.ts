import type { ClubModules, MembershipRole } from '@sport-performance/domain';
import { canRecordParticipation } from '../coach-session/model.ts';
import { canSeeStaffBoard } from '../staff/board.ts';
import { canSeeTestDays } from '../test-day/data.ts';

/** The tabs of the signed-in app that not every member sees. */
export interface TabVisibility {
  /** "Mis tests": the player (B-503). */
  readonly tests: boolean;
  /** Gimnasio (B-607): every role while the club has the `gym` module on (issue #215). */
  readonly gym: boolean;
  /** The field test day: who reads test days (`test_session:read`, B-505). */
  readonly testDays: boolean;
  /** The coach's sessions: who records participation (B-509). */
  readonly sessions: boolean;
  /** The quick look before training: the staff who reads the panel (B-510). */
  readonly staff: boolean;
}

/**
 * Which tabs show for a role in a club with these modules (`null` role: no
 * club yet, only the tabs everyone has). A tab that does not show is still
 * a route (`href: null`): its screen says why when a link opens it.
 */
export function tabVisibility(role: MembershipRole | null, modules: ClubModules): TabVisibility {
  return {
    tests: role === 'player',
    gym: modules.gym,
    testDays: role !== null && canSeeTestDays(role),
    sessions: role !== null && canRecordParticipation(role),
    staff: role !== null && canSeeStaffBoard(role),
  };
}
