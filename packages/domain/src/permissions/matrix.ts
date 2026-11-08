import { ROLES, type Role } from '../role.js';
import { PERMISSION_RESOURCES, type ActionOf, type ResourceKind } from './resources.js';
import { allow, deny, type PermissionRule } from './rules.js';

/** Rules of one action, one per role. Every role is explicit, denials included. */
export type RoleRules = Readonly<Record<Role, PermissionRule>>;

/** The whole matrix: resource kind → action → role → rule. */
export type PermissionMatrix = {
  readonly [K in ResourceKind]: Readonly<Record<ActionOf<K>, RoleRules>>;
};

const platform = allow('platform');
const club = allow('club');
const assigned = allow('assigned');
const self = allow('self');
const guardian = allow('guardian');

/** Denied to every role. */
const nobody: RoleRules = {
  player: deny,
  parent: deny,
  coach: deny,
  sc: deny,
  medical: deny,
  admin: deny,
  superadmin: deny,
};

/** Club administration: admin, and superadmin while supporting the club. */
const administration: RoleRules = { ...nobody, admin: club, superadmin: club };

/** Staff in their assignments, administration in the whole club. */
const staffRead: RoleRules = {
  ...administration,
  coach: assigned,
  sc: assigned,
  medical: assigned,
};

/** Staff in their assignments plus the player's own data. */
const ownAndStaffRead: RoleRules = { ...staffRead, player: self };

/**
 * Kiosk mode (B-504, ADR 0086): the staff member signed in on a shared club
 * device loads, for a player who picks themselves there, what the player
 * would load from their own account. The staff who run the training (coach,
 * S&C) in their assignments and the administration in the club; never the
 * medical staff (not their tool) nor the superadmin (support does not load
 * players' data). Always with the player's current `data` consent.
 */
const kioskSubmit: RoleRules = {
  ...nobody,
  coach: allow('assigned', 'data'),
  sc: allow('assigned', 'data'),
  admin: allow('club', 'data'),
};

/**
 * The permission matrix (B-303, ADR 0025): the single source of truth of who
 * sees and does what. The API (before each handler), the web and mobile (to
 * show or hide actions) evaluate it with `can`; the database keeps its own
 * row-level policies (ADR 0006, ADR 0008) as the last barrier.
 *
 * Read it as the role table of CLAUDE.md, cell by cell:
 *
 * - **player**: their own profile, results, load, wellness and RPE (which
 *   they submit with a data consent); own percentiles from M15; rankings with
 *   names never in M13–M16, always their own value against the anonymised
 *   group reference instead; once of age, their own consents and whether
 *   each guardian keeps access (B-311).
 * - **parent**: through a guardian link, the summarised profile, availability
 *   and consents (signed while the player is a minor), parents' heights and
 *   the account of a player without email. Once the player is of age, only
 *   what does not need a minor, and only if the adult kept the link (B-311). Never rankings; of health, only
 *   the record of a minor with a health consent (read only, ADR 0029).
 * - **coach**: assigned categories: panel, roster, sessions, participation;
 *   wellness and RPE for a player on the club's kiosk (B-504), as S&C and admin.
 * - **sc**: assigned categories: test days, results, anthropometry, gym, CMJ
 *   videos (with an image consent), imports, CSV exports; club configuration.
 * - **medical**: health data of assigned players, always audited; the rest
 *   of the staff sees availability only, never the cause. The player reads
 *   their own record with a health consent (ADR 0029).
 * - **admin**: everything of the club except health data and signing
 *   consents for someone else.
 * - **superadmin**: what an admin can, in the club whose context they fix,
 *   always audited; plus the registry of clubs. Never health data, never
 *   consents, never exporting or erasing a player's data.
 *
 * Collecting data of a player (wellness, RPE, external load, results, measurements,
 * participation, parents' heights) needs a current `data` consent; images
 * need `image` to be uploaded or shown; health records need `health`; the
 * position of the pod needs `location`, granted on the current text (B-913).
 */
export const PERMISSION_MATRIX: PermissionMatrix = {
  club_registry: {
    read: { ...nobody, superadmin: platform },
    create: { ...nobody, superadmin: platform },
    update: { ...nobody, superadmin: platform },
  },
  club: {
    read: {
      player: club,
      parent: club,
      coach: club,
      sc: club,
      medical: club,
      admin: club,
      superadmin: club,
    },
    update: administration,
  },
  // The club sees who supported it; the superadmin, what an admin sees.
  support_access: {
    read: administration,
  },
  // Adoption of the club (B-707): the administration, and the superadmin supporting the
  // pilot. Never the staff: the counts of who uses what are about the staff themselves.
  usage_metrics: {
    read: administration,
  },
  membership: {
    read: administration,
    invite: administration,
    update: administration,
    revoke: administration,
  },
  staff_assignment: {
    read: administration,
    manage: administration,
  },
  category: {
    read: staffRead,
    manage: administration,
  },
  season: {
    // The calendar frame is no personal data: every member of the club reads it.
    read: {
      player: club,
      parent: club,
      coach: club,
      sc: club,
      medical: club,
      admin: club,
      superadmin: club,
    },
    manage: administration,
    plan_windows: { ...administration, sc: club },
  },
  metric_catalog: {
    read: {
      player: club,
      parent: club,
      coach: club,
      sc: club,
      medical: club,
      admin: club,
      superadmin: club,
    },
  },
  configuration: {
    read: { ...administration, coach: club, sc: club, medical: club },
    update: { ...administration, sc: club },
  },
  device: {
    read: { ...administration, coach: club, sc: club, medical: club },
    manage: { ...administration, sc: club },
  },
  data_import: {
    run: { ...administration, sc: assigned },
  },
  change_history: {
    read: staffRead,
  },
  player_profile: {
    read: ownAndStaffRead,
    create: administration,
    update: { ...administration, coach: assigned, sc: assigned },
    archive: administration,
  },
  player_summary: {
    read: { ...ownAndStaffRead, parent: guardian },
  },
  guardian_link: {
    read: { ...administration, player: self, parent: guardian },
    manage: administration,
    // Only the adult decides on their guardians' access (B-311): never the administration.
    review: { ...nobody, player: allow('self', 'adult') },
  },
  player_account: {
    invite: { ...administration, parent: allow('guardian', 'minor') },
  },
  consent: {
    read: { ...ownAndStaffRead, parent: guardian },
    sign: { ...nobody, player: allow('self', 'adult'), parent: allow('guardian', 'minor') },
    revoke: { ...nobody, player: allow('self', 'adult'), parent: allow('guardian', 'minor') },
  },
  parent_height: {
    read: { ...administration, parent: guardian, sc: assigned },
    report: {
      ...nobody,
      // Only while the player is a minor: an adult keeps the guardian's read access only.
      parent: allow('guardian', 'data', 'minor'),
      sc: allow('assigned', 'data'),
      admin: allow('club', 'data'),
      superadmin: allow('club', 'data'),
    },
  },
  wellness: {
    read: ownAndStaffRead,
    submit: { ...nobody, player: allow('self', 'data') },
    kiosk_submit: kioskSubmit,
  },
  rpe: {
    read: ownAndStaffRead,
    submit: { ...nobody, player: allow('self', 'data') },
    kiosk_submit: kioskSubmit,
  },
  // Only the player knows it; the staff reads it next to the club's load (B-511).
  external_load: {
    read: ownAndStaffRead,
    report: { ...nobody, player: allow('self', 'data') },
  },
  training_session: {
    read: staffRead,
    manage: { ...administration, coach: assigned },
  },
  participation: {
    read: ownAndStaffRead,
    record: {
      ...nobody,
      coach: allow('assigned', 'data'),
      admin: allow('club', 'data'),
      superadmin: allow('club', 'data'),
    },
  },
  test_session: {
    read: staffRead,
    manage: { ...administration, sc: assigned },
  },
  test_result: {
    read: ownAndStaffRead,
    record: {
      ...nobody,
      sc: allow('assigned', 'data'),
      admin: allow('club', 'data'),
      superadmin: allow('club', 'data'),
    },
    correct: {
      ...nobody,
      sc: allow('assigned', 'data'),
      admin: allow('club', 'data'),
      superadmin: allow('club', 'data'),
    },
  },
  anthropometry: {
    read: ownAndStaffRead,
    record: {
      ...nobody,
      sc: allow('assigned', 'data'),
      admin: allow('club', 'data'),
      superadmin: allow('club', 'data'),
    },
  },
  gym_program: {
    read: { ...administration, player: self, coach: assigned, sc: assigned },
    manage: { ...administration, sc: assigned },
  },
  // The player logs their own sets (principle 5) and the S&C staff theirs; the coach reads
  // them. The technique score is the staff's: the endpoint refuses it from the player.
  gym_set: {
    read: { ...administration, player: self, coach: assigned, sc: assigned },
    log: {
      ...nobody,
      player: allow('self', 'data'),
      sc: allow('assigned', 'data'),
      admin: allow('club', 'data'),
      superadmin: allow('club', 'data'),
    },
    correct: {
      ...nobody,
      player: allow('self', 'data'),
      sc: allow('assigned', 'data'),
      admin: allow('club', 'data'),
      superadmin: allow('club', 'data'),
    },
  },
  load_metrics: {
    read: ownAndStaffRead,
  },
  alert: {
    read: staffRead,
    acknowledge: staffRead,
  },
  percentile: {
    read: { ...staffRead, player: allow('self', 'own_percentiles') },
  },
  // The player cell is `self`, but the ranking shows the other players of the
  // group: the endpoint must take the group from the viewer's own player and
  // never accept an arbitrary player id (see the resource kind).
  // The player cell is `self`, but the ranking shows the other players of the
  // group: the endpoint must take the group from the viewer's own player and
  // never accept an arbitrary player id (see the resource kind).
  named_ranking: {
    read: { ...staffRead, player: allow('self', 'named_rankings') },
  },
  group_reference: {
    read: ownAndStaffRead,
  },
  media: {
    read: {
      ...nobody,
      player: allow('self', 'image'),
      coach: allow('assigned', 'image'),
      sc: allow('assigned', 'image'),
      admin: allow('club', 'image'),
      superadmin: allow('club', 'image'),
    },
    upload: {
      ...nobody,
      sc: allow('assigned', 'image'),
      admin: allow('club', 'image'),
      superadmin: allow('club', 'image'),
    },
    delete: { ...administration, sc: assigned },
  },
  availability: {
    read: { ...ownAndStaffRead, parent: guardian },
  },
  medical_record: {
    // The holder's right of access (Ley 25.326, art. 14; ADR 0029): the player and the
    // guardian of a minor read their own record, with a current health consent.
    read: {
      ...nobody,
      player: allow('self', 'health'),
      parent: allow('guardian', 'health', 'minor'),
      medical: assigned,
    },
    record: { ...nobody, medical: allow('assigned', 'health') },
    update: { ...nobody, medical: allow('assigned', 'health') },
  },
  medical_block: {
    read: { ...nobody, medical: assigned },
    set: { ...nobody, medical: assigned },
    lift: { ...nobody, medical: assigned },
  },
  // Health data the player gives (B-609, ADR 0078): only with a data and a health consent,
  // read like the medical record (the medical staff and the holder) and never by the rest of
  // the staff, who keep seeing the wellness without any trace of it.
  pain_report: {
    read: {
      ...nobody,
      player: allow('self', 'health'),
      parent: allow('guardian', 'health', 'minor'),
      medical: assigned,
    },
    submit: { ...nobody, player: allow('self', 'data', 'health') },
    review: { ...nobody, medical: assigned },
  },
  // Menarche (B-805, ADR 0089): health data of a girl, told by herself, her guardian while
  // she is a minor or the medical staff, and read only by them. Everyone needs a current
  // health consent, the medical staff too: revoking it hides the record from all of them.
  menarche: {
    read: {
      ...nobody,
      player: allow('self', 'health'),
      parent: allow('guardian', 'health', 'minor'),
      medical: allow('assigned', 'health'),
    },
    report: {
      ...nobody,
      player: allow('self', 'data', 'health'),
      parent: allow('guardian', 'data', 'health', 'minor'),
      medical: allow('assigned', 'health'),
    },
  },
  // Menstrual cycle tracking (B-806, ADR 0092): only the player writes it, with the three
  // consents; she reads all of it; the staff reads it only when she authorized that member
  // (the database checks the authorization). The coach, the administration, the superadmin
  // and the guardian never read it: the guardian consents for a minor and may revoke.
  menstrual_cycle: {
    read: {
      ...nobody,
      player: self,
      sc: allow('assigned', 'data', 'health', 'menstrual_cycle'),
      medical: allow('assigned', 'data', 'health', 'menstrual_cycle'),
    },
    enroll: { ...nobody, player: allow('self', 'data', 'health', 'menstrual_cycle') },
    log: { ...nobody, player: allow('self', 'data', 'health', 'menstrual_cycle') },
    share: { ...nobody, player: allow('self', 'data', 'health', 'menstrual_cycle') },
    withdraw: { ...nobody, player: self },
  },
  // The pod (B-912, B-913, ADR 0106). The fleet is run by S&C and the administration; the
  // staff of the category assigns pods, opens the live screen and reads the traces. Every
  // position of a player needs their `location` consent, which counts only while granted
  // (never on an older text): the database's `app.current_consent_types` leaves it out of
  // the facts otherwise. The player reads their own traces; the guardian never sees a
  // position, and neither do the medical staff nor the superadmin's support access.
  pod: {
    read: { ...administration, coach: club, sc: club },
    manage: { ...administration, sc: club },
    locate: { ...nobody, sc: club, admin: club },
  },
  pod_assignment: {
    read: { ...administration, player: self, coach: assigned, sc: assigned },
    assign: {
      ...nobody,
      coach: allow('assigned', 'data', 'location'),
      sc: allow('assigned', 'data', 'location'),
      admin: allow('club', 'data', 'location'),
    },
  },
  pod_live: {
    read: { ...nobody, coach: assigned, sc: assigned, admin: club },
  },
  position_trace: {
    read: {
      ...nobody,
      player: self,
      coach: allow('assigned', 'location'),
      sc: allow('assigned', 'location'),
      admin: allow('club', 'location'),
    },
  },
  data_export: {
    export: {
      ...nobody,
      player: allow('self', 'adult'),
      parent: allow('guardian', 'minor'),
      admin: allow('club', 'data'),
    },
  },
  // The report of a window is for the player and their family (B-602, ADR 0071): its
  // content is decided when the staff asks for it (the player's own values, anonymous
  // averages of a minimum size, the first team's references), never names of other players,
  // percentiles or health data. The test staff and the administration ask for it.
  player_report: {
    read: { ...ownAndStaffRead, parent: guardian },
    generate: { ...administration, sc: assigned },
  },
  // The report of a category for a window (B-603, ADR 0073): aggregates of the group only
  // (no names, ids or values of one player, nothing medical), for the staff of the category
  // and, through the club, its sub-committee. Asked for by the test staff, like the player's.
  category_report: {
    read: staffRead,
    generate: { ...administration, sc: assigned },
  },
  // The club's data as CSV (B-608, ADR 0072): the administration, the whole club; the S&C
  // staff, their assigned categories (the analysts of the tests and the load). Each player
  // in it needs a current data consent, like any export of their data. Never the superadmin:
  // support does not take a club's data out.
  club_data_export: {
    run: { ...nobody, sc: allow('assigned', 'data'), admin: allow('club', 'data') },
    read: { ...nobody, sc: assigned, admin: club },
  },
  // The holder asks for the erasure (the player once of age, the guardian of a minor), and
  // so may the administration on a request received otherwise; only the administration
  // erases. Never the superadmin: support does not erase a club's players.
  data_erasure: {
    read: {
      ...nobody,
      player: allow('self', 'adult'),
      parent: allow('guardian', 'minor'),
      admin: club,
    },
    request: {
      ...nobody,
      player: allow('self', 'adult'),
      parent: allow('guardian', 'minor'),
      admin: club,
    },
    execute: { ...nobody, admin: club },
  },
};

/** One cell of the matrix, flattened. */
export interface PermissionCell {
  readonly kind: ResourceKind;
  readonly action: string;
  readonly role: Role;
  readonly rule: PermissionRule;
}

/** The rule of one cell. */
export function ruleFor<K extends ResourceKind>(
  kind: K,
  action: ActionOf<K>,
  role: Role,
): PermissionRule {
  // Unreachable for typed callers; fail closed for untyped ones: an unknown
  // kind, an action that is not an own key (`constructor`, `toString`) or an
  // unknown role is a denial, never a crash.
  if (!Object.hasOwn(PERMISSION_MATRIX, kind)) return deny;
  const actions = PERMISSION_MATRIX[kind] as Readonly<Record<string, RoleRules>>;
  if (!Object.hasOwn(actions, action)) return deny;
  const rules = actions[action] as Readonly<Record<string, PermissionRule>>;
  if (!Object.hasOwn(rules, role)) return deny;
  return rules[role] ?? deny;
}

/** Every cell, in resource, action and role order (for tests, docs and audits). */
export function permissionCells(): readonly PermissionCell[] {
  const cells: PermissionCell[] = [];
  for (const kind of Object.keys(PERMISSION_RESOURCES) as ResourceKind[]) {
    for (const action of PERMISSION_RESOURCES[kind].actions) {
      for (const role of ROLES) {
        cells.push({
          kind,
          action,
          role,
          rule: ruleFor(kind, action, role),
        });
      }
    }
  }
  return cells;
}
